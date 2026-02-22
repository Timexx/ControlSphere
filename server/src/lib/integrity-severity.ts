/**
 * Smart severity classification for file integrity events.
 *
 * Instead of marking every file change as "high", this module classifies
 * the severity based on the path:
 *
 *   HIGH   - System-critical paths (/etc, /root/.ssh, /usr/bin, /boot)
 *   MEDIUM - Application paths (/opt, /srv, /var/www, /home)
 *   LOW    - Logs, temp files, caches, Docker overlay ephemeral data
 *
 * ISO 27001 A.12.4.1: Event logging - prioritize by criticality.
 */

// ─── HIGH: System-critical paths ─────────────────────────────────────────────
const HIGH_PATTERNS: RegExp[] = [
  /^\/etc\//i,
  /^\/root\/.ssh\//i,
  /^\/root\/\.bashrc$/i,
  /^\/root\/\.profile$/i,
  /^\/usr\/bin\//i,
  /^\/usr\/sbin\//i,
  /^\/usr\/local\/bin\//i,
  /^\/usr\/local\/sbin\//i,
  /^\/usr\/lib\//i,
  /^\/lib\//i,
  /^\/lib64\//i,
  /^\/sbin\//i,
  /^\/bin\//i,
  /^\/boot\//i,
  /^\/var\/spool\/cron/i,
]

// ─── LOW: Noise paths (logs, temp, caches, Docker ephemeral) ─────────────────
const LOW_PATTERNS: RegExp[] = [
  // Log files (anywhere)
  /\.log(\.\d+)?$/i,
  /\.log\.gz$/i,
  /\.log\.old$/i,
  /\.journal$/i,

  // Log directories
  /^\/var\/log\//i,
  /\/logs?\//i,

  // Temp & cache
  /^\/tmp\//i,
  /^\/var\/tmp\//i,
  /^\/var\/cache\//i,

  // Docker overlay filesystem (ephemeral container layers)
  /^\/var\/lib\/docker\/overlay2\//i,
  /^\/var\/lib\/docker\/containers\//i,

  // Package manager caches / lock files
  /^\/var\/lib\/apt\//i,
  /^\/var\/lib\/dpkg\//i,
  /^\/var\/cache\/apt\//i,

  // PM2 runtime data
  /\/\.pm2\/logs\//i,
  /\/\.pm2\/pids\//i,

  // Swap, editor temp files
  /\.swp$/i,
  /\.swx$/i,
  /~$/,

  // letsencrypt/certbot logs & renewal working files
  /letsencrypt-log\//i,
  /\/certbot\//i,
]

/**
 * Classify the severity of a file integrity finding based on its path.
 *
 * Returns 'high', 'medium', or 'low'.  The caller should use this
 * instead of the agent-supplied severity for integrity events.
 */
export function classifyIntegritySeverity(path: string | undefined): 'low' | 'medium' | 'high' {
  if (!path) return 'high' // unknown path → treat as critical

  // Check LOW first (most common noise case → early exit)
  if (LOW_PATTERNS.some((re) => re.test(path))) return 'low'

  // Check HIGH (system-critical)
  if (HIGH_PATTERNS.some((re) => re.test(path))) return 'high'

  // Everything else is MEDIUM (application-level changes)
  return 'medium'
}
