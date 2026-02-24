/**
 * Centralized file integrity event filtering
 * 
 * These patterns filter out normal operational file changes that create noise
 * in security event monitoring (e.g., database WAL files, build artifacts, logs).
 * 
 * Events matching these patterns are suppressed server-side and never persisted
 * to the database, reducing log spam while maintaining visibility into critical
 * system file changes.
 */

export const INTEGRITY_IGNORE_PATTERNS = [
  // === Linux: Package Management ===
  /^\/var\/cache\/apt\/.*/i,
  /^\/var\/lib\/apt\/.*/i,
  /^\/var\/lib\/dpkg\/.*/i,
  
  // === Linux: Docker & Containers ===
  /^\/var\/log\/journal\/.*/i,
  /^\/var\/lib\/docker\/containers\/.*/i,
  /^\/var\/lib\/docker\/overlay2\/.*/i,
  
  // === Linux: PostgreSQL ===
  /^\/var\/lib\/postgresql\/.*\/pg_wal\/.*/i,
  /^\/var\/lib\/postgresql\/.*\/pg_xact\/.*/i,
  /^\/var\/lib\/postgresql\/.*\/pg_subtrans\/.*/i,
  /^\/var\/lib\/postgresql\/.*\/pg_multixact\/.*/i,
  /^\/var\/lib\/postgresql\/.*\/base\/.*/i,
  /^\/var\/lib\/postgresql\/.*\/global\/pg_control$/i,
  /^\/var\/lib\/postgresql\/.*\/pg_stat_tmp\/.*/i,
  
  // === Linux: MySQL/MariaDB ===
  /^\/var\/lib\/mysql\/.*\/ib_logfile.*/i,
  /^\/var\/lib\/mysql\/.*\.ibd$/i,
  /^\/var\/lib\/mysql\/.*\/ibdata.*/i,
  
  // === Linux: Redis ===
  /^\/var\/lib\/redis\/.*/i,
  
  // === Linux: Logs & Temp ===
  /^\/var\/log\/.*/i,
  /^\/var\/tmp\/.*/i,
  /^\/tmp\/.*/i,
  
  // === Node.js & Next.js Build Artifacts ===
  /.*\/\.next\/static\/.*/i,
  /.*\/\.next\/cache\/.*/i,
  /.*\/\.next\/server\/.*/i,
  /.*\/\.next\/trace$/i,
  /.*\/node_modules\/\.cache\/.*/i,
  /.*\/\.npm\/.*/i,
  /.*\/\.yarn\/.*/i,
  
  // === Application Logs ===
  /.*\/\.pm2\/logs\/.*/i,
  /.*\/\.npm\/_logs\/.*/i,
  /.*\.log$/i,
  
  // === Windows: System Maintenance ===
  /^[A-Z]:\\Windows\\WinSxS\\.*/i,
  /^[A-Z]:\\Windows\\SoftwareDistribution\\.*/i,
  /^[A-Z]:\\Windows\\Temp\\.*/i,
  /^[A-Z]:\\\$Recycle\.Bin\\.*/i,
  /^[A-Z]:\\System Volume Information\\.*/i,
  /^[A-Z]:\\Windows\\Prefetch\\.*/i,
  /^[A-Z]:\\Windows\\Logs\\.*/i,
  
  // === Windows: Application Data ===
  /^[A-Z]:\\Users\\.*\\AppData\\Local\\Temp\\.*/i,
]

/**
 * Extract file path from integrity event message
 * Parses messages like "File modified: /etc/passwd" or "File changed: C:\Windows\config"
 */
export function extractPathFromMessage(message: string | undefined): string | undefined {
  if (!message) return undefined
  const match = message.match(/File (?:modified|changed|removed):\s*(\S+)/i)
  return match?.[1]
}

/**
 * Check if an integrity event should be ignored based on file path
 * Returns true if the path matches any ignore pattern
 */
export function shouldIgnoreIntegrityEvent(path?: string): boolean {
  if (!path) return false
  return INTEGRITY_IGNORE_PATTERNS.some((re) => re.test(path))
}
