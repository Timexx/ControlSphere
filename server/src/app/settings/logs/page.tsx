'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import {
  FileText,
  RefreshCw,
  Download,
  Copy,
  Check,
  Search,
  X,
  FolderOpen,
  ChevronRight,
  AlertCircle,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

interface LogFile {
  name: string
  size: number
  modifiedAt: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function LogsPage() {
  const t = useTranslations('settings.logs')

  const [files, setFiles] = useState<LogFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [filesError, setFilesError] = useState<string | null>(null)

  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [loadingContent, setLoadingContent] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)

  const [filter, setFilter] = useState('')
  const [copied, setCopied] = useState(false)
  const [refreshingFile, setRefreshingFile] = useState(false)

  const viewerRef = useRef<HTMLPreElement>(null)

  // ── Fetch file list ──────────────────────────────────────────────────────
  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true)
    setFilesError(null)
    try {
      const res = await fetch('/api/admin/logs')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setFiles(data.files ?? [])
    } catch (err: any) {
      setFilesError(err.message)
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  useEffect(() => { fetchFiles() }, [fetchFiles])

  // ── Fetch file content ───────────────────────────────────────────────────
  const fetchContent = useCallback(async (filename: string, silent = false) => {
    if (!silent) setLoadingContent(true)
    else setRefreshingFile(true)
    setContentError(null)
    try {
      const res = await fetch(`/api/admin/logs/${encodeURIComponent(filename)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const text = await res.text()
      setContent(text)
      // Scroll to bottom on fresh load
      if (!silent) {
        setTimeout(() => {
          viewerRef.current?.scrollTo({ top: viewerRef.current.scrollHeight })
        }, 50)
      }
    } catch (err: any) {
      setContentError(err.message)
    } finally {
      setLoadingContent(false)
      setRefreshingFile(false)
    }
  }, [])

  const handleSelectFile = (name: string) => {
    setSelectedFile(name)
    setFilter('')
    setContent('')
    fetchContent(name)
  }

  // ── Filter logic ─────────────────────────────────────────────────────────
  const filteredLines = content
    ? content
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => !filter || line.toLowerCase().includes(filter.toLowerCase()))
    : []

  const displayedContent = filter
    ? filteredLines.map(({ line }) => line).join('\n')
    : content

  // ── Copy ─────────────────────────────────────────────────────────────────
  const handleCopy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(displayedContent)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = displayedContent
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  // ── Download ─────────────────────────────────────────────────────────────
  const handleDownload = () => {
    if (!selectedFile) return
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = selectedFile
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
              <FolderOpen className="h-4 w-4 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-500 font-mono">{t('eyebrow')}</p>
              <h3 className="text-sm font-semibold text-white">{t('title')}</h3>
            </div>
          </div>
          <button
            onClick={fetchFiles}
            disabled={loadingFiles}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loadingFiles && 'animate-spin')} />
            {t('refresh')}
          </button>
        </div>

        {/* Main split layout */}
        <div className="flex" style={{ minHeight: '500px' }}>

          {/* ── Left: File list ────────────────────────────── */}
          <div className="w-64 shrink-0 border-r border-slate-800 overflow-y-auto">
            {loadingFiles ? (
              <div className="flex flex-col gap-2 p-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-10 rounded-lg bg-slate-800/60 animate-pulse" />
                ))}
              </div>
            ) : filesError ? (
              <div className="p-4 flex items-start gap-2 text-red-400 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {filesError}
              </div>
            ) : files.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                {t('noFiles')}
              </div>
            ) : (
              <ul className="p-2 space-y-0.5">
                {files.map((f) => (
                  <li key={f.name}>
                    <button
                      onClick={() => handleSelectFile(f.name)}
                      className={cn(
                        'w-full text-left rounded-lg px-3 py-2.5 transition-colors group',
                        selectedFile === f.name
                          ? 'bg-cyan-500/10 border border-cyan-500/30'
                          : 'hover:bg-slate-800/60 border border-transparent'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <FileText className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          selectedFile === f.name ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'
                        )} />
                        <span className={cn(
                          'text-xs font-mono truncate',
                          selectedFile === f.name ? 'text-cyan-300' : 'text-slate-300'
                        )}>
                          {f.name}
                        </span>
                        {selectedFile === f.name && (
                          <ChevronRight className="h-3 w-3 text-cyan-400 ml-auto shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 pl-5">
                        <span className="text-[10px] text-slate-500">{formatBytes(f.size)}</span>
                        <span className="text-[10px] text-slate-600">·</span>
                        <span className="text-[10px] text-slate-500">{formatRelativeTime(f.modifiedAt)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Right: Viewer ──────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0">
            {!selectedFile ? (
              <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
                <div className="text-center">
                  <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  {t('selectFile')}
                </div>
              </div>
            ) : (
              <>
                {/* Viewer toolbar */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-800 bg-slate-950/40">
                  <span className="text-xs font-mono text-slate-400 truncate mr-auto">{selectedFile}</span>

                  {/* Filter */}
                  <div className="flex items-center gap-1.5 bg-slate-800 rounded-md px-2 py-1">
                    <Search className="h-3 w-3 text-slate-500 shrink-0" />
                    <input
                      type="text"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder={t('filter')}
                      className="bg-transparent text-xs text-slate-300 placeholder:text-slate-600 outline-none w-32"
                    />
                    {filter && (
                      <button onClick={() => setFilter('')} className="text-slate-500 hover:text-white">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {/* Refresh file */}
                  <button
                    onClick={() => fetchContent(selectedFile, true)}
                    disabled={refreshingFile}
                    title={t('refreshFile')}
                    className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', refreshingFile && 'animate-spin')} />
                  </button>

                  {/* Copy */}
                  <button
                    onClick={handleCopy}
                    disabled={!content}
                    title={t('copy')}
                    className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>

                  {/* Download */}
                  <button
                    onClick={handleDownload}
                    disabled={!content}
                    title={t('download')}
                    className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Match count when filtering */}
                {filter && !loadingContent && (
                  <div className="px-4 py-1.5 text-[10px] text-slate-500 border-b border-slate-800 bg-slate-950/20">
                    {filteredLines.length === 0
                      ? t('noMatches')
                      : t('matchCount', { count: filteredLines.length })}
                  </div>
                )}

                {/* Content area */}
                {loadingContent ? (
                  <div className="flex-1 flex items-center justify-center">
                    <RefreshCw className="h-5 w-5 text-slate-600 animate-spin" />
                  </div>
                ) : contentError ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="flex items-center gap-2 text-red-400 text-sm">
                      <AlertCircle className="h-4 w-4" />
                      {contentError}
                    </div>
                  </div>
                ) : (
                  <pre
                    ref={viewerRef}
                    className="flex-1 overflow-auto p-4 text-[11px] leading-5 font-mono text-slate-300 whitespace-pre-wrap break-all"
                    style={{ maxHeight: '600px' }}
                  >
                    {displayedContent || <span className="text-slate-600 italic">{t('emptyFile')}</span>}
                  </pre>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
