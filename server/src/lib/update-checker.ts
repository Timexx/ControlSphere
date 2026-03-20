/**
 * Server Update Checker
 *
 * Periodically checks the GitHub repository for new commits on main.
 * Caches the result in memory with a configurable TTL (default 6h).
 * Uses the global singleton pattern to survive hot reloading.
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { realtimeEvents } from './realtime-events'

// ── Types ──────────────────────────────────────────────────────────────

export interface CommitInfo {
  sha: string
  message: string
  date: string
  author: string
}

export interface UpdateInfo {
  available: boolean
  currentVersion: string
  currentSha: string
  latestSha: string
  aheadBy: number
  commits: CommitInfo[]
  checkedAt: string
  lastLogPath: string | null
}

// ── Constants ──────────────────────────────────────────────────────────

const GITHUB_REPO = 'Timexx/ControlSphere'
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}`
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
const MAX_COMMITS_DISPLAY = 20
const MAX_LOG_FILES = 10

// ── Implementation ─────────────────────────────────────────────────────

class UpdateChecker {
  private cache: UpdateInfo | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private previousLatestSha: string | null = null

  get currentVersion(): string {
    return process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0'
  }

  private resolvedSha: string | null = null

  get currentSha(): string {
    const envSha = process.env.NEXT_PUBLIC_BUILD_SHA || 'dev'
    if (envSha !== 'dev') return envSha

    // Build SHA missing — resolve from git at runtime (once)
    if (this.resolvedSha) return this.resolvedSha
    try {
      this.resolvedSha = execSync('git rev-parse --short HEAD', {
        cwd: this.installDir,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim()
      return this.resolvedSha
    } catch {
      return 'dev'
    }
  }

  get installDir(): string {
    // server/ is the cwd, install dir is one level up
    return path.resolve(process.cwd(), '..')
  }

  get logsDir(): string {
    return path.join(this.installDir, 'logs')
  }

  /** Find the most recent update log file */
  getLastLogPath(): string | null {
    try {
      if (!fs.existsSync(this.logsDir)) return null
      const files = fs.readdirSync(this.logsDir)
        .filter(f => f.startsWith('update-') && f.endsWith('.log'))
        .sort()
        .reverse()
      if (files.length === 0) return null
      return path.join(this.logsDir, files[0])
    } catch {
      return null
    }
  }

  /** Clean old log files, keeping only the last MAX_LOG_FILES */
  cleanOldLogs(): void {
    try {
      if (!fs.existsSync(this.logsDir)) return
      const files = fs.readdirSync(this.logsDir)
        .filter(f => f.startsWith('update-') && f.endsWith('.log'))
        .sort()
      if (files.length <= MAX_LOG_FILES) return
      const toDelete = files.slice(0, files.length - MAX_LOG_FILES)
      for (const f of toDelete) {
        fs.unlinkSync(path.join(this.logsDir, f))
      }
    } catch {
      // non-critical
    }
  }

  /** Check GitHub for updates */
  async checkForUpdates(force = false): Promise<UpdateInfo> {
    // Return cache if fresh
    if (!force && this.cache) {
      const age = Date.now() - new Date(this.cache.checkedAt).getTime()
      if (age < CHECK_INTERVAL_MS) return this.cache
    }

    const sha = this.currentSha
    if (sha === 'dev') {
      // Neither build SHA nor git available — cannot compare
      this.cache = {
        available: false,
        currentVersion: this.currentVersion,
        currentSha: sha,
        latestSha: sha,
        aheadBy: 0,
        commits: [],
        checkedAt: new Date().toISOString(),
        lastLogPath: this.getLastLogPath(),
      }
      return this.cache
    }

    try {
      // Use compare endpoint to get commit diff
      const res = await fetch(`${GITHUB_API}/compare/${sha}...main`, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'ControlSphere-UpdateChecker',
        },
      })

      if (!res.ok) {
        // SHA might not exist (e.g. force-pushed). Fall back to latest commits.
        if (res.status === 404) {
          return await this.fallbackCheck()
        }
        throw new Error(`GitHub API returned ${res.status}`)
      }

      const data = await res.json()
      const aheadBy: number = data.ahead_by ?? 0
      const latestSha: string = data.commits?.length > 0
        ? data.commits[data.commits.length - 1].sha?.slice(0, 7) ?? sha
        : sha

      const commits: CommitInfo[] = (data.commits ?? [])
        .slice(-MAX_COMMITS_DISPLAY)
        .reverse()
        .map((c: { sha: string; commit: { message: string; author: { date: string; name: string } } }) => ({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split('\n')[0],
          date: c.commit.author.date,
          author: c.commit.author.name,
        }))

      this.cache = {
        available: aheadBy > 0,
        currentVersion: this.currentVersion,
        currentSha: sha,
        latestSha,
        aheadBy,
        commits,
        checkedAt: new Date().toISOString(),
        lastLogPath: this.getLastLogPath(),
      }

      // Broadcast if new update detected
      if (aheadBy > 0 && latestSha !== this.previousLatestSha) {
        this.previousLatestSha = latestSha
        realtimeEvents.emitUpdateAvailable({ latestSha, aheadBy })
      }

      return this.cache
    } catch (err) {
      console.error('[UpdateChecker] GitHub check failed:', err)
      // Return stale cache or empty result
      if (this.cache) return this.cache
      return {
        available: false,
        currentVersion: this.currentVersion,
        currentSha: sha,
        latestSha: sha,
        aheadBy: 0,
        commits: [],
        checkedAt: new Date().toISOString(),
        lastLogPath: this.getLastLogPath(),
      }
    }
  }

  /** Fallback when SHA is not found in compare (e.g. after force push) */
  private async fallbackCheck(): Promise<UpdateInfo> {
    const res = await fetch(`${GITHUB_API}/commits?per_page=1&sha=main`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'ControlSphere-UpdateChecker',
      },
    })

    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)
    const commits = await res.json()
    const latestSha = commits[0]?.sha?.slice(0, 7) ?? this.currentSha
    const available = latestSha !== this.currentSha

    this.cache = {
      available,
      currentVersion: this.currentVersion,
      currentSha: this.currentSha,
      latestSha,
      aheadBy: available ? -1 : 0, // -1 = unknown count
      commits: available ? [{
        sha: latestSha,
        message: commits[0]?.commit?.message?.split('\n')[0] ?? '',
        date: commits[0]?.commit?.author?.date ?? '',
        author: commits[0]?.commit?.author?.name ?? '',
      }] : [],
      checkedAt: new Date().toISOString(),
      lastLogPath: this.getLastLogPath(),
    }

    if (available && latestSha !== this.previousLatestSha) {
      this.previousLatestSha = latestSha
      realtimeEvents.emitUpdateAvailable({ latestSha, aheadBy: -1 })
    }

    return this.cache
  }

  /** Get cached result without fetching */
  getUpdateInfo(): UpdateInfo | null {
    return this.cache
  }

  /** Start periodic background checks */
  startPeriodicCheck(): void {
    if (this.timer) return
    // Initial check after 30s (let server finish booting)
    setTimeout(() => {
      this.checkForUpdates().catch(() => {})
    }, 30_000)
    // Then every 6 hours
    this.timer = setInterval(() => {
      this.checkForUpdates().catch(() => {})
    }, CHECK_INTERVAL_MS)
  }

  /** Stop periodic checks */
  stopPeriodicCheck(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

// ── Global singleton ───────────────────────────────────────────────────

const globalForUpdate = globalThis as typeof globalThis & {
  __updateChecker?: UpdateChecker
}

if (!globalForUpdate.__updateChecker) {
  globalForUpdate.__updateChecker = new UpdateChecker()
}

export const updateChecker: UpdateChecker = globalForUpdate.__updateChecker
