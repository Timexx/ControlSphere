type ScanProgress = {
  progress: number
  phase: string
  etaSeconds: number | null
  startedAt: string
  updatedAt: string
}

const TTL_MS = 2 * 60 * 60 * 1000 // 2 hours – keep state across page revisits during long scans

const globalStore = globalThis as typeof globalThis & { __scanProgress?: Map<string, ScanProgress> }

if (!globalStore.__scanProgress) {
  globalStore.__scanProgress = new Map()
}

const store = globalStore.__scanProgress

export function setScanProgress(machineId: string, data: Omit<ScanProgress, 'updatedAt'>) {
  store.set(machineId, {
    ...data,
    updatedAt: new Date().toISOString()
  })
}

export function clearScanProgress(machineId: string) {
  store.delete(machineId)
}

export function getScanProgress(machineId: string): ScanProgress | null {
  const value = store.get(machineId)
  if (!value) return null

  // Expire old progress entries
  const updated = new Date(value.updatedAt).getTime()
  if (Date.now() - updated > TTL_MS) {
    store.delete(machineId)
    return null
  }
  return value
}
