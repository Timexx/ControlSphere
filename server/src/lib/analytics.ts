/**
 * analytics.ts
 * Deterministic time-series analytics for CPU / RAM / Disk metrics.
 *
 * Algorithms:
 *  - Weighted OLS linear regression (exponential decay, halflife = 1/3 of timespan)
 *  - R² goodness-of-fit
 *  - Adaptive SMA window (scales with range)
 *  - Bollinger bands (SMA ± 2σ)
 *  - Windowed rate-of-change (mini-regression on last 10 % of points)
 *  - Exponential regression for disk via log transform
 *  - Anchor-correct threshold forecast (uses current value, not intercept)
 *  - Composite health score (Disk 40 %, RAM 30 %, CPU 30 %)
 */

export type UsageKey = 'cpuUsage' | 'ramUsage' | 'diskUsage'

export interface HistoricalMetric {
  timestamp: string
  cpuUsage: number
  ramUsage: number
  diskUsage: number
}

export interface RegressionResult {
  slopePerHour: number
  /** y-intercept at origin (hours = 0) */
  intercept: number
  /** unix-ms of the first data point (time axis origin) */
  origin: number
  /** weighted R² goodness-of-fit in [0, 1] */
  r2: number
}

export interface ForecastResult {
  eta: Date
  hoursRemaining: number
  threshold: number
  slopePerHour: number
  /** true when data span is shorter than 24 h → forecast is speculative */
  insufficientData: boolean
}

export interface BollingerPoint {
  upper: number | null
  lower: number | null
}

export type ConfidenceLabel = 'high' | 'medium' | 'low'

export type TrendDirection = 'rising' | 'falling' | 'stable'

// ---------------------------------------------------------------------------
// Data span helper — how many hours does our dataset cover?
// ---------------------------------------------------------------------------
export function dataSpanHours(points: HistoricalMetric[]): number {
  if (points.length < 2) return 0
  const first = new Date(points[0].timestamp).getTime()
  const last = new Date(points[points.length - 1].timestamp).getTime()
  return (last - first) / 3_600_000
}

// Minimum 6 h of data before showing any forecast at all.
const MIN_FORECAST_SPAN_HOURS = 6
// Below 24 h the forecast is flagged as "insufficientData".
const CONFIDENT_SPAN_HOURS = 24

// ---------------------------------------------------------------------------
// Weighted OLS linear regression
// Exponential decay weights so recent points matter more.
// halflife = (total timespan) / 3
// ---------------------------------------------------------------------------
export function calculateWeightedRegression(
  points: HistoricalMetric[],
  key: UsageKey,
): RegressionResult | null {
  if (points.length < 3) return null

  const timestamps = points.map((p) => new Date(p.timestamp).getTime())
  const origin = timestamps[0]
  const xs = timestamps.map((t) => (t - origin) / 3_600_000) // hours
  const ys = points.map((p) => p[key] as number)
  const n = xs.length

  // Exponential decay weights
  const span = xs[n - 1] - xs[0] || 1
  const halflife = span / 3
  const ws = xs.map((x) => Math.exp((x - xs[n - 1]) / halflife))
  const sumW = ws.reduce((a, b) => a + b, 0)

  const xBar = ws.reduce((acc, w, i) => acc + w * xs[i], 0) / sumW
  const yBar = ws.reduce((acc, w, i) => acc + w * ys[i], 0) / sumW

  let Sxy = 0
  let Sxx = 0
  let SStot = 0

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xBar
    const dy = ys[i] - yBar
    Sxy += ws[i] * dx * dy
    Sxx += ws[i] * dx * dx
    SStot += ws[i] * dy * dy
  }

  if (Sxx === 0) return null

  const slopePerHour = Sxy / Sxx
  const intercept = yBar - slopePerHour * xBar

  // Weighted R²
  let SSres = 0
  for (let i = 0; i < n; i++) {
    const residual = ys[i] - (slopePerHour * xs[i] + intercept)
    SSres += ws[i] * residual * residual
  }
  const r2 = SStot > 0 ? Math.max(0, Math.min(1, 1 - SSres / SStot)) : 0

  return { slopePerHour, intercept, origin, r2 }
}

// ---------------------------------------------------------------------------
// Exponential regression: y = a * e^(b*x)  →  ln(y) = ln(a) + b*x
// Useful for disk usage which often grows exponentially. Falls back to linear
// if the log-transform produces invalid values.
// ---------------------------------------------------------------------------
export function calculateExpRegression(
  points: HistoricalMetric[],
  key: UsageKey,
): RegressionResult | null {
  // Only attempt if all values > 0
  if (points.some((p) => (p[key] as number) <= 0)) {
    return calculateWeightedRegression(points, key)
  }

  const logPoints: HistoricalMetric[] = points.map((p) => ({
    ...p,
    [key]: Math.log(p[key] as number),
  }))

  const logReg = calculateWeightedRegression(logPoints, key)
  if (!logReg) return calculateWeightedRegression(points, key)

  // slopePerHour is now b (growth rate per hour)
  // intercept is ln(a), but we keep the same interface.
  // Expose slopePerHour in %/h units by multiplying by the mean value
  const meanY = points.reduce((acc, p) => acc + (p[key] as number), 0) / points.length
  const effectiveSlope = logReg.slopePerHour * meanY

  return { ...logReg, slopePerHour: effectiveSlope }
}

// ---------------------------------------------------------------------------
// Adaptive SMA window
// ---------------------------------------------------------------------------
export function computeSMAWindow(rangeHours: number, pointCount: number): number {
  if (pointCount < 12) return Math.max(2, Math.ceil(pointCount / 4))
  if (rangeHours <= 24) return 12
  if (rangeHours <= 7 * 24) return 24
  if (rangeHours <= 30 * 24) return 48
  return 72
}

export function calculateSMA(
  points: HistoricalMetric[],
  key: UsageKey,
  windowSize: number,
): Array<number | null> {
  if (!points.length) return []
  const result: Array<number | null> = Array(points.length).fill(null)
  let windowSum = 0
  for (let i = 0; i < points.length; i++) {
    windowSum += points[i][key] as number
    if (i >= windowSize) windowSum -= points[i - windowSize][key] as number
    if (i >= windowSize - 1) result[i] = windowSum / windowSize
  }
  return result
}

// ---------------------------------------------------------------------------
// Bollinger bands: SMA ± 2σ
// Returns arrays aligned with points. Values clamped to [0, 110].
// ---------------------------------------------------------------------------
export function calculateBollinger(
  points: HistoricalMetric[],
  key: UsageKey,
  windowSize: number,
): BollingerPoint[] {
  const sma = calculateSMA(points, key, windowSize)
  return points.map((_, i) => {
    if (sma[i] === null) return { upper: null, lower: null }
    const start = Math.max(0, i - windowSize + 1)
    const slice = points.slice(start, i + 1).map((p) => p[key] as number)
    const mean = sma[i] as number
    const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / slice.length
    const sigma = Math.sqrt(variance)
    return {
      upper: Math.min(110, mean + 2 * sigma),
      lower: Math.max(0, mean - 2 * sigma),
    }
  })
}

// ---------------------------------------------------------------------------
// Windowed rate-of-change
// Uses a mini-regression on the last max(4, ceil(n * 0.10)) points (≤ 24)
// instead of the volatile 2-point difference.
// ---------------------------------------------------------------------------
export function calculateWindowedRoC(
  points: HistoricalMetric[],
  key: UsageKey,
): number {
  if (points.length < 2) return 0
  const w = Math.min(Math.max(4, Math.ceil(points.length * 0.1)), 24)
  const window = points.slice(-w)
  const reg = calculateWeightedRegression(window, key)
  return reg?.slopePerHour ?? 0
}

// ---------------------------------------------------------------------------
// Threshold forecast
// Anchored to the current (latest) value rather than the regression intercept.
//
// Guards:
//  1. Need at least MIN_FORECAST_SPAN_HOURS (6 h) of data → otherwise null.
//  2. Forecast horizon capped at 10× data span → avoids absurd extrapolation.
//  3. insufficientData flag when span < CONFIDENT_SPAN_HOURS (24 h).
// ---------------------------------------------------------------------------
export function forecastThreshold(
  points: HistoricalMetric[],
  key: UsageKey,
  threshold: number,
): ForecastResult | null {
  if (!points.length) return null

  const span = dataSpanHours(points)
  if (span < MIN_FORECAST_SPAN_HOURS) return null // not enough data

  const regression = calculateWeightedRegression(points, key)
  if (!regression || regression.slopePerHour <= 0) return null

  const latest = points[points.length - 1]
  const latestValue = latest[key] as number
  if (latestValue === undefined || latestValue >= threshold) return null

  // Remaining headroom from the current value (not the OLS intercept)
  const hoursFromLatest = (threshold - latestValue) / regression.slopePerHour
  const latestMs = new Date(latest.timestamp).getTime()
  const etaMs = latestMs + hoursFromLatest * 3_600_000

  if (!isFinite(hoursFromLatest) || etaMs < Date.now()) return null

  // Cap forecast horizon at 10× data span
  const maxHorizon = span * 10
  if (hoursFromLatest > maxHorizon) return null

  return {
    eta: new Date(etaMs),
    hoursRemaining: hoursFromLatest,
    threshold,
    slopePerHour: regression.slopePerHour,
    insufficientData: span < CONFIDENT_SPAN_HOURS,
  }
}

// ---------------------------------------------------------------------------
// Percentile (nearest-rank)
// ---------------------------------------------------------------------------
export function calculatePercentile(
  points: HistoricalMetric[],
  key: UsageKey,
  percentile: number,
): number | null {
  if (!points.length) return null
  const values = (points.map((p) => p[key]) as number[]).sort((a, b) => a - b)
  const index = Math.min(values.length - 1, Math.floor(percentile * (values.length - 1)))
  return values[index]
}

// ---------------------------------------------------------------------------
// Composite health score
// Disk 40 %, RAM 30 %, CPU 30 %  (P95 as proxy for peak load)
// Returns 0–100 (higher = higher resource pressure / worse health)
// ---------------------------------------------------------------------------
export function calculateHealthScore(
  pctCpu: number | null,
  pctRam: number | null,
  pctDisk: number | null,
): number | null {
  const scores: number[] = []
  const weights: number[] = []
  if (pctCpu !== null) {
    scores.push(pctCpu)
    weights.push(0.3)
  }
  if (pctRam !== null) {
    scores.push(pctRam)
    weights.push(0.3)
  }
  if (pctDisk !== null) {
    scores.push(pctDisk)
    weights.push(0.4)
  }
  if (!scores.length) return null
  const sumW = weights.reduce((a, b) => a + b, 0)
  const weighted = scores.reduce((acc, v, i) => acc + v * weights[i], 0) / sumW
  return Math.round(weighted)
}

// ---------------------------------------------------------------------------
// Confidence label from R²
// ---------------------------------------------------------------------------
export function confidenceLabel(r2: number): ConfidenceLabel {
  if (r2 >= 0.7) return 'high'
  if (r2 >= 0.35) return 'medium'
  return 'low'
}

// ---------------------------------------------------------------------------
// Trend extrapolation data
// Appends extrapolated points to chart data for a 20 % time-horizon ahead.
// Returns { timestamps[], values[] } aligned with the regression line.
// ---------------------------------------------------------------------------
export function buildTrendLine(
  points: HistoricalMetric[],
  regression: RegressionResult,
  extrapolationFraction = 0.2,
): Array<{ timestamp: number; trendValue: number }> {
  if (points.length < 2) return []

  const first = new Date(points[0].timestamp).getTime()
  const last = new Date(points[points.length - 1].timestamp).getTime()
  const horizonMs = (last - first) * extrapolationFraction
  const extendTo = last + horizonMs

  // One point per existing interval, plus endpoint
  const step = (last - first) / Math.max(points.length - 1, 1)
  const result: Array<{ timestamp: number; trendValue: number }> = []

  for (let t = first; t <= extendTo + step; t += step) {
    const tClamped = Math.min(t, extendTo)
    const xHours = (tClamped - regression.origin) / 3_600_000
    result.push({
      timestamp: tClamped,
      trendValue: Math.max(0, regression.slopePerHour * xHours + regression.intercept),
    })
    if (tClamped >= extendTo) break
  }

  return result
}

// ---------------------------------------------------------------------------
// Trend direction (human-readable)
// Uses the windowed RoC (per-hour slope) and converts to per-day.
// Thresholds:
//   |slope| < 0.5 %/day → stable
//   slope ≥ 0.5 %/day   → rising
//   slope ≤ -0.5 %/day  → falling
// ---------------------------------------------------------------------------
export function describeTrend(slopePerHour: number): TrendDirection {
  const perDay = slopePerHour * 24
  if (Math.abs(perDay) < 0.5) return 'stable'
  return perDay > 0 ? 'rising' : 'falling'
}

// ---------------------------------------------------------------------------
// Mean utilization over the entire dataset
// ---------------------------------------------------------------------------
export function meanUsage(points: HistoricalMetric[], key: UsageKey): number | null {
  if (!points.length) return null
  const sum = points.reduce((acc, p) => acc + (p[key] as number), 0)
  return sum / points.length
}
