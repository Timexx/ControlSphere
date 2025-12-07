'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import AppShell from '@/components/AppShell'
import AddAgentModal from '@/components/AddAgentModal'
import {
  FileText, 
  Filter, 
  Download, 
  RefreshCw, 
  Search,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Info,
  AlertCircle,
  XCircle,
  CheckCircle,
  Calendar,
  User,
  Server,
  Activity,
  TerminalSquare
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useLocale, useTranslations } from 'next-intl'

type AuditLog = {
  id: string
  machineId: string | null
  userId: string | null
  action: string
  eventType: string | null
  details: string | null
  severity: string
  createdAt: string
  machine?: {
    hostname: string
    ip: string
  } | null
  user?: {
    username: string
  } | null
}

const SEVERITY_CONFIG = {
  info: { labelKey: 'info', icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  warn: { labelKey: 'warn', icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  critical: { labelKey: 'critical', icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
}

const ACTION_LABEL_KEYS: Record<string, string> = {
  LOGIN: 'LOGIN',
  COMMAND_EXEC: 'COMMAND_EXEC',
  SHELL_OPEN: 'SHELL_OPEN',
  SHELL_CLOSE: 'SHELL_CLOSE',
  AGENT_EVENT: 'AGENT_EVENT',
  SESSION_CREATED: 'SESSION_CREATED',
  SESSION_ENDED: 'SESSION_ENDED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  REPLAY_DETECTED: 'REPLAY_DETECTED',
  HMAC_FAILED: 'HMAC_FAILED',
}

export default function AuditLogsPage() {
  const t = useTranslations('auditLogs')
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const locale = useLocale()
  const dateLocale = locale === 'de' ? de : enUS
  const dateFormatter = useCallback(
    (value: string) => new Date(value).toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US'),
    [locale]
  )
  const dateTimeFormatter = useCallback(
    (value: string) => new Date(value).toLocaleString(locale === 'de' ? 'de-DE' : 'en-US'),
    [locale]
  )
  
  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSeverity, setFilterSeverity] = useState<string>('')
  const [filterAction, setFilterAction] = useState<string>('')
  const [filterDateFrom, setFilterDateFrom] = useState<string>('')
  const [filterDateTo, setFilterDateTo] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)

  const fetchLogs = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const params = new URLSearchParams()
      if (filterSeverity) params.set('severity', filterSeverity)
      if (filterAction) params.set('action', filterAction)
      if (filterDateFrom) params.set('from', new Date(filterDateFrom).toISOString())
      if (filterDateTo) params.set('to', new Date(filterDateTo).toISOString())
      params.set('limit', '100')

      const res = await fetch(`/api/audit-logs?${params}`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs || [])
      }
    } catch (error) {
      console.error('Failed to fetch audit logs:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [filterSeverity, filterAction, filterDateFrom, filterDateTo])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  // Search & filter logic
  const filteredLogs = useMemo(() => {
    let result = logs
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(log => 
        log.action.toLowerCase().includes(q) ||
        log.eventType?.toLowerCase().includes(q) ||
        log.details?.toLowerCase().includes(q) ||
        log.userId?.toLowerCase().includes(q) ||
        log.machineId?.toLowerCase().includes(q)
      )
    }
    return result
  }, [logs, searchQuery])

  // Unique actions for filter dropdown
  const uniqueActions = useMemo(() => {
    const actions = new Set(logs.map(l => l.action))
    return Array.from(actions).sort()
  }, [logs])

  const handleDownloadCSV = () => {
    const headers = [t('details.timestamp'), t('details.severity'), t('details.action'), t('details.eventType'), t('details.user'), t('details.machine'), t('details.details')]
    const rows = filteredLogs.map(log => [
      log.createdAt,
      log.severity,
      log.action,
      log.eventType || '',
      log.userId || '',
      log.machineId || '',
      log.details || ''
    ])
    
    // Escape CSV values properly
    const escapeCSV = (value: string | number) => {
      const strValue = String(value)
      if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
        return `"${strValue.replace(/"/g, '""')}"`
      }
      return strValue
    }
    
    const csv = [
      headers.map(escapeCSV).join(','),
      ...rows.map(r => r.map(escapeCSV).join(','))
    ].join('\n')
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-logs-${new Date().toISOString()}.csv`
    a.click()
  }

  return (
    <AppShell onAddAgent={() => setShowAddAgent(true)}>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <FileText className="h-8 w-8 text-cyan-400" />
              {t('header.title')}
            </h1>
            <p className="text-slate-400 mt-2">
              {t('header.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchLogs(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-all disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              {refreshing ? t('buttons.refreshing') : t('buttons.refresh')}
            </button>
            <button
              onClick={handleDownloadCSV}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-all"
            >
              <Download className="h-4 w-4" />
              {t('buttons.export')}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <Activity className="h-4 w-4" />
              {t('stats.total')}
            </div>
            <div className="text-2xl font-bold text-white">{filteredLogs.length}</div>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-blue-400 text-sm mb-1">
              <Info className="h-4 w-4" />
              {t('stats.info')}
            </div>
            <div className="text-2xl font-bold text-white">
              {filteredLogs.filter(l => l.severity === 'info').length}
            </div>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-yellow-400 text-sm mb-1">
              <AlertTriangle className="h-4 w-4" />
              {t('stats.warnings')}
            </div>
            <div className="text-2xl font-bold text-white">
              {filteredLogs.filter(l => l.severity === 'warn').length}
            </div>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-400 text-sm mb-1">
              <AlertCircle className="h-4 w-4" />
              {t('stats.critical')}
            </div>
            <div className="text-2xl font-bold text-white">
              {filteredLogs.filter(l => l.severity === 'critical').length}
            </div>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300">
              <Filter className="h-4 w-4" />
              <span className="font-medium">{t('filterSection.title')}</span>
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="text-sm text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1"
            >
              {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showFilters ? t('filterSection.showLess') : t('filterSection.showMore')}
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            />
          </div>

          {/* Advanced Filters */}
          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('filterLabels.severity')}</label>
                <select
                  value={filterSeverity}
                  onChange={(e) => setFilterSeverity(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                >
                  <option value="">{t('filterLabels.all')}</option>
                  <option value="info">{t('severity.info')}</option>
                  <option value="warn">{t('severity.warn')}</option>
                  <option value="critical">{t('severity.critical')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('filterLabels.action')}</label>
                <select
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                >
                  <option value="">{t('filterLabels.all')}</option>
                  {uniqueActions.map(action => (
                    <option key={action} value={action}>{t(`actions.${action}`) || action}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('filterLabels.from')}</label>
                <input
                  type="datetime-local"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('filterLabels.to')}</label>
                <input
                  type="datetime-local"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
            </div>
          )}

          {/* Active Filters */}
          {(filterSeverity || filterAction || filterDateFrom || filterDateTo) && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              <span className="text-xs text-slate-400">{t('activeFilters')}</span>
              {filterSeverity && (
                <span className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 flex items-center gap-1">
                  {t('filterTags.severity')} {t(`severity.${filterSeverity}`)}
                  <button onClick={() => setFilterSeverity('')} className="hover:text-white">
                    <XCircle className="h-3 w-3" />
                  </button>
                </span>
              )}
              {filterAction && (
                <span className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 flex items-center gap-1">
                  {t('filterTags.action')} {t(`actions.${filterAction}`) || filterAction}
                  <button onClick={() => setFilterAction('')} className="hover:text-white">
                    <XCircle className="h-3 w-3" />
                  </button>
                </span>
              )}
              {filterDateFrom && (
                <span className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 flex items-center gap-1">
                  {t('filterTags.from')} {dateFormatter(filterDateFrom)}
                  <button onClick={() => setFilterDateFrom('')} className="hover:text-white">
                    <XCircle className="h-3 w-3" />
                  </button>
                </span>
              )}
              {filterDateTo && (
                <span className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 flex items-center gap-1">
                  {t('filterTags.to')} {dateFormatter(filterDateTo)}
                  <button onClick={() => setFilterDateTo('')} className="hover:text-white">
                    <XCircle className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Logs List */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
              {t('loading')}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">{t('empty.title')}</p>
              <p className="text-sm mt-1">{t('empty.subtitle')}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {filteredLogs.map((log) => {
                const severityConfig = SEVERITY_CONFIG[log.severity as keyof typeof SEVERITY_CONFIG] || SEVERITY_CONFIG.info
                const SeverityIcon = severityConfig.icon
                
                return (
                  <div
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="p-4 hover:bg-slate-800/30 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <div className={cn(
                          "p-2 rounded-lg border",
                          severityConfig.bg,
                          severityConfig.border
                        )}>
                          <SeverityIcon className={cn("h-4 w-4", severityConfig.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-white">
                              {t(`actions.${log.action}`) || log.action}
                            </span>
                            {log.eventType && (
                              <span className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300">
                                {log.eventType}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true, locale: dateLocale })}
                            </span>
                            {log.userId && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {log.user?.username || log.userId.slice(0, 8)}...
                              </span>
                            )}
                            {log.machineId && (
                              <span className="flex items-center gap-1">
                                <Server className="h-3 w-3" />
                                {log.machine?.hostname || `${log.machineId.slice(0, 8)}...`}
                              </span>
                            )}
                          </div>
                          {log.details && (
                            <p className="text-sm text-slate-400 mt-2 truncate">
                              {log.details.length > 100 ? log.details.slice(0, 100) + '...' : log.details}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className={cn(
                        "px-2 py-1 rounded text-xs font-medium border whitespace-nowrap",
                        severityConfig.bg,
                        severityConfig.color,
                        severityConfig.border
                      )}>
                        {t(`severity.${severityConfig.labelKey}`)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Details Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-slate-900 border-b border-slate-800 p-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">{t('details.title')}</h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1 hover:bg-slate-800 rounded transition-colors"
              >
                <XCircle className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Command/Code Highlight Box */}
              {selectedLog.details && (() => {
                try {
                  const parsed = JSON.parse(selectedLog.details)
                  const command = parsed.command || parsed.cmd || parsed.code
                  if (command) {
                    return (
                      <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <TerminalSquare className="h-4 w-4 text-cyan-400" />
                          <label className="text-xs text-cyan-300 uppercase tracking-wider font-semibold">
                            {t('details.code')}
                          </label>
                        </div>
                        <pre className="text-sm text-white font-mono bg-slate-900/50 rounded p-3 overflow-auto">
                          {command}
                        </pre>
                      </div>
                    )
                  }
                } catch (e) {
                  // Not JSON or no command field
                }
                return null
              })()}

              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider">{t('details.id')}</label>
                <p className="text-sm text-white font-mono mt-1">{selectedLog.id}</p>
              </div>
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider">{t('details.action')}</label>
                <p className="text-sm text-white mt-1">{t(`actions.${selectedLog.action}`) || selectedLog.action}</p>
              </div>
              {selectedLog.eventType && (
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider">{t('details.eventType')}</label>
                  <p className="text-sm text-white mt-1">{selectedLog.eventType}</p>
                </div>
              )}
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider">{t('details.severity')}</label>
                <p className="text-sm text-white mt-1">{t(`severity.${selectedLog.severity}`)}</p>
              </div>
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider">{t('details.timestamp')}</label>
                <p className="text-sm text-white mt-1">
                  {dateTimeFormatter(selectedLog.createdAt)} 
                  <span className="text-slate-400 ml-2">
                    ({formatDistanceToNow(new Date(selectedLog.createdAt), { addSuffix: true, locale: dateLocale })})
                  </span>
                </p>
              </div>
              {selectedLog.userId && (
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider">{t('details.user')}</label>
                  <p className="text-sm text-white mt-1">
                    {selectedLog.user?.username && (
                      <span className="font-medium">{selectedLog.user.username}</span>
                    )}
                    {selectedLog.user?.username && ' • '}
                    <span className="font-mono text-slate-400">{selectedLog.userId}</span>
                  </p>
                </div>
              )}
              {selectedLog.machineId && (
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider">{t('details.machine')}</label>
                  <p className="text-sm text-white mt-1">
                    {selectedLog.machine?.hostname && (
                      <span className="font-medium">{selectedLog.machine.hostname}</span>
                    )}
                    {selectedLog.machine?.hostname && selectedLog.machine?.ip && ' • '}
                    {selectedLog.machine?.ip && (
                      <span className="text-slate-400">{selectedLog.machine.ip}</span>
                    )}
                    {!selectedLog.machine && (
                      <span className="font-mono">{selectedLog.machineId}</span>
                    )}
                  </p>
                </div>
              )}
              {selectedLog.details && (
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider">{t('details.details')}</label>
                  <pre className="text-sm text-white mt-1 bg-slate-800/50 border border-slate-700 rounded p-3 overflow-auto max-h-60">
                    {selectedLog.details}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAddAgent && <AddAgentModal onClose={() => setShowAddAgent(false)} />}
    </AppShell>
  )
}
