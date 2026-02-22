'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Users, Plus, Shield, Eye, UserX, Trash2, KeyRound,
  CheckCircle2, AlertCircle, Search, X, Copy, Check,
  ChevronRight, Server, AlertTriangle,
} from 'lucide-react'
import AppShell from '@/components/AppShell'
import AddAgentModal from '@/components/AddAgentModal'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserItem {
  id: string
  username: string
  role: string
  active: boolean
  language: string | null
  lastLoginAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  _count: { machineAccess: number }
}

interface MachineItem {
  id: string
  hostname: string
  ip: string
  status: string
  osInfo: string | null
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function UserManagementPage() {
  const t = useTranslations('userManagement')
  const tShell = useTranslations('appShell')

  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState<{ username: string; password: string } | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState<UserItem | null>(null)
  const [showMachinesModal, setShowMachinesModal] = useState<UserItem | null>(null)
  const [showEditModal, setShowEditModal] = useState<UserItem | null>(null)
  const [showResetModal, setShowResetModal] = useState<UserItem | null>(null)

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/users')
      if (!res.ok) throw new Error('Failed to load users')
      const data = await res.json()
      setUsers(data.users)
      setError(null)
    } catch {
      setError(t('errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadUsers()
    fetch('/api/auth/session-time')
      .then((r) => r.json())
      .then((d) => { if (d.userId) setCurrentUserId(d.userId) })
      .catch(() => {})
  }, [loadUsers])

  return (
    <AppShell onAddAgent={() => setShowAddModal(true)}>
      <div className="space-y-6 max-w-5xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <a href="/settings" className="hover:text-white transition-colors">{t('breadcrumb.settings')}</a>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-white">{t('breadcrumb.users')}</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70 font-mono mb-1">
              {t('eyebrow')}
            </p>
            <h2 className="text-2xl font-semibold text-white">{t('title')}</h2>
            <p className="text-sm text-slate-400 mt-1">{t('subtitle')}</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-500 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('create.button')}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* User Table */}
        <div className="rounded-xl border border-slate-800 bg-[#0B1118]/70 shadow-[0_0_30px_rgba(0,243,255,0.06)] overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
            <div className="h-8 w-8 rounded-lg border border-cyan-500/30 bg-cyan-500/10 flex items-center justify-center">
              <Users className="h-4 w-4 text-cyan-300" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-mono">
                {t('eyebrow')}
              </p>
              <h3 className="text-white font-semibold text-base leading-tight">
                {t('title')}
              </h3>
            </div>
            <div className="ml-auto text-xs text-slate-500">
              {users.length} {users.length === 1 ? 'user' : 'users'}
            </div>
          </div>

          {loading ? (
            <div className="px-5 py-12 text-center text-slate-400 text-sm">
              Loading users...
            </div>
          ) : users.length === 0 ? (
            <div className="px-5 py-12 text-center text-slate-400 text-sm">
              {t('table.noUsers')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    <th className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">{t('table.username')}</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">{t('table.role')}</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">{t('table.status')}</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">{t('table.machines')}</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">{t('table.lastLogin')}</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">{t('table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                      <td className="px-5 py-3">
                        <span className="text-white font-medium">{user.username}</span>
                      </td>
                      <td className="px-5 py-3">
                        <RoleBadge role={user.role} />
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => handleToggleActive(user)}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                            user.active
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"
                              : "bg-slate-500/10 text-slate-400 border border-slate-500/30 hover:bg-slate-500/20"
                          )}
                          title={user.active ? t('toggleActive.deactivate') : t('toggleActive.activate')}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", user.active ? "bg-emerald-400" : "bg-slate-500")} />
                          {user.active ? t('table.active') : t('table.inactive')}
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        {user.role === 'admin' ? (
                          <span className="text-slate-500 text-xs italic">{t('table.allMachines')}</span>
                        ) : (
                          <button
                            onClick={() => setShowMachinesModal(user)}
                            className="text-slate-300 hover:text-cyan-300 transition-colors"
                          >
                            {user._count.machineAccess}
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleString()
                          : t('table.never')}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => setShowEditModal(user)}
                            title={t('edit.title')}
                            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                          >
                            <Shield className="h-3.5 w-3.5" />
                          </button>
                          {user.role !== 'admin' && (
                            <button
                              onClick={() => setShowMachinesModal(user)}
                              title={t('machines.title')}
                              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                            >
                              <Server className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => setShowResetModal(user)}
                            title={t('resetPassword.button')}
                            className="p-1.5 rounded-md text-slate-400 hover:text-amber-400 hover:bg-slate-700 transition-colors"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          {user.id !== currentUserId && (
                            <button
                              onClick={() => setShowDeleteModal(user)}
                              title={t('deleteUser.button')}
                              className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-700 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Role Legend */}
        <div className="rounded-xl border border-slate-800 bg-[#0B1118]/70 px-5 py-4">
          <p className="text-xs text-slate-400 font-medium mb-3 uppercase tracking-wider">Roles</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(['admin', 'user', 'viewer'] as const).map((role) => (
              <div key={role} className="flex items-start gap-3">
                <RoleBadge role={role} />
                <p className="text-xs text-slate-400">{t(`roleDescriptions.${role}`)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}

      {showAddModal && <AddAgentModal onClose={() => setShowAddModal(false)} />}

      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(username, password) => {
            setShowCreateModal(false)
            setShowPasswordModal({ username, password })
            loadUsers()
          }}
        />
      )}

      {showPasswordModal && (
        <PasswordDisplayModal
          username={showPasswordModal.username}
          password={showPasswordModal.password}
          onClose={() => setShowPasswordModal(null)}
        />
      )}

      {showEditModal && (
        <EditUserModal
          user={showEditModal}
          onClose={() => setShowEditModal(null)}
          onSaved={() => {
            setShowEditModal(null)
            loadUsers()
          }}
        />
      )}

      {showMachinesModal && (
        <MachineAccessModal
          user={showMachinesModal}
          onClose={() => setShowMachinesModal(null)}
          onSaved={() => {
            setShowMachinesModal(null)
            loadUsers()
          }}
        />
      )}

      {showResetModal && (
        <ResetPasswordModal
          user={showResetModal}
          onClose={() => setShowResetModal(null)}
          onReset={(password) => {
            setShowResetModal(null)
            setShowPasswordModal({ username: showResetModal.username, password })
          }}
        />
      )}

      {showDeleteModal && (
        <DeleteUserModal
          user={showDeleteModal}
          onClose={() => setShowDeleteModal(null)}
          onDeleted={() => {
            setShowDeleteModal(null)
            loadUsers()
          }}
        />
      )}
    </AppShell>
  )

  // ─── Inline handlers ────────────────────────────────────────────────────────

  async function handleToggleActive(user: UserItem) {
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !user.active }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || t('errors.updateFailed'))
        return
      }
      loadUsers()
    } catch {
      setError(t('errors.updateFailed'))
    }
  }
}

// ─── Role Badge Component ────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const t = useTranslations('userManagement')
  const config = {
    admin: { icon: Shield, color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
    user: { icon: Users, color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
    viewer: { icon: Eye, color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' },
  }[role] || { icon: Users, color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' }

  const Icon = config.icon
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", config.color)}>
      <Icon className="h-3 w-3" />
      {t(`roles.${role}` as any)}
    </span>
  )
}

// ─── Create User Modal ───────────────────────────────────────────────────────

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (username: string, password: string) => void
}) {
  const t = useTranslations('userManagement')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<string>('user')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (username.trim().length < 2) {
      setError(t('errors.usernameTooShort'))
      return
    }
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), role }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t('errors.createFailed'))
        return
      }
      onCreated(data.user.username, data.generatedPassword)
    } catch {
      setError(t('errors.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-white">{t('create.title')}</h3>
          <p className="text-sm text-slate-400 mt-1">{t('create.subtitle')}</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">{t('create.username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('create.usernamePlaceholder')}
              className="w-full rounded-lg border border-slate-700 bg-[#070b11] px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500/60 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">{t('create.role')}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['admin', 'user', 'viewer'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "px-3 py-2 rounded-lg border text-sm font-medium transition-all text-center",
                    role === r
                      ? "border-cyan-500/70 bg-cyan-500/10 text-cyan-100"
                      : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white"
                  )}
                >
                  {t(`roles.${r}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1.5">{t(`roleDescriptions.${role}` as any)}</p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-rose-400 text-xs">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-all text-sm">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || username.trim().length < 2}
            className="flex-1 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? t('create.creating') : t('create.submit')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ─── Password Display Modal (shown once after create/reset) ──────────────────

function PasswordDisplayModal({
  username,
  password,
  onClose,
}: {
  username: string
  password: string
  onClose: () => void
}) {
  const t = useTranslations('userManagement')
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(password)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="space-y-5">
        <div className="text-center">
          <div className="h-12 w-12 rounded-full border border-emerald-500/50 bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">{t('created.title')}</h3>
          <p className="text-sm text-slate-400 mt-1">{t('created.subtitle')}</p>
        </div>

        {/* Warning */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-300">{t('created.warning')}</p>
          </div>
        </div>

        {/* Username */}
        <div>
          <label className="text-xs text-slate-400 font-medium block mb-1">{t('table.username')}</label>
          <div className="rounded-lg border border-slate-700 bg-[#070b11] px-3 py-2 text-sm font-mono text-white">
            {username}
          </div>
        </div>

        {/* Password with copy */}
        <div>
          <label className="text-xs text-slate-400 font-medium block mb-1">{t('created.password')}</label>
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-[#070b11] px-3 py-2">
            <code className="flex-1 text-sm font-mono text-emerald-300 select-all break-all">
              {password}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 p-1 rounded-md text-slate-400 hover:text-white transition-colors"
              title={t('created.copy')}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          {copied && (
            <p className="text-xs text-emerald-400 mt-1">{t('created.copied')}</p>
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-500 transition-colors"
        >
          {t('created.done')}
        </button>
      </div>
    </ModalOverlay>
  )
}

// ─── Edit User Modal ─────────────────────────────────────────────────────────

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserItem
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('userManagement')
  const [role, setRole] = useState(user.role)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || t('errors.updateFailed'))
        return
      }
      onSaved()
    } catch {
      setError(t('errors.updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-white">{t('edit.title')}</h3>
          <p className="text-sm text-slate-400 mt-1">{user.username}</p>
        </div>

        <div>
          <label className="text-xs text-slate-400 font-medium block mb-1.5">{t('edit.role')}</label>
          <div className="grid grid-cols-3 gap-2">
            {(['admin', 'user', 'viewer'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={cn(
                  "px-3 py-2 rounded-lg border text-sm font-medium transition-all text-center",
                  role === r
                    ? "border-cyan-500/70 bg-cyan-500/10 text-cyan-100"
                    : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white"
                )}
              >
                {t(`roles.${r}`)}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-1.5">{t(`roleDescriptions.${role}` as any)}</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-rose-400 text-xs">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-all text-sm">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || role === user.role}
            className="flex-1 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? t('edit.saving') : t('edit.save')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ─── Machine Access Modal ────────────────────────────────────────────────────

function MachineAccessModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserItem
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('userManagement')
  const [allMachines, setAllMachines] = useState<MachineItem[]>([])
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        // Fetch all machines (as admin) and user's current assignments
        const [machinesRes, accessRes] = await Promise.all([
          fetch('/api/machines'),
          fetch(`/api/admin/users/${user.id}/machines`),
        ])
        const machinesData = await machinesRes.json()
        const accessData = await accessRes.json()

        setAllMachines(machinesData.machines || [])
        setAssignedIds(new Set(accessData.machineIds || []))
      } catch {
        setError(t('errors.machinesFailed'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user.id, t])

  function toggleMachine(id: string) {
    setAssignedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSuccess(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/machines`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineIds: Array.from(assignedIds) }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || t('errors.machinesFailed'))
        return
      }
      setSuccess(true)
      setTimeout(() => onSaved(), 1000)
    } catch {
      setError(t('errors.machinesFailed'))
    } finally {
      setSaving(false)
    }
  }

  const filtered = allMachines.filter(
    (m) =>
      m.hostname.toLowerCase().includes(search.toLowerCase()) ||
      m.ip.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <ModalOverlay onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{t('machines.title')}</h3>
          <p className="text-sm text-slate-400 mt-1">
            {t('machines.subtitle')} — <span className="text-white font-medium">{user.username}</span>
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('machines.search')}
            className="w-full rounded-lg border border-slate-700 bg-[#070b11] pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500/60 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          />
        </div>

        {/* Machine list */}
        {loading ? (
          <div className="text-center text-slate-400 text-sm py-8">Loading...</div>
        ) : allMachines.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-8">{t('machines.noMachines')}</div>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1 border border-slate-800 rounded-lg p-2">
            {filtered.map((machine) => {
              const assigned = assignedIds.has(machine.id)
              return (
                <button
                  key={machine.id}
                  onClick={() => toggleMachine(machine.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left",
                    assigned
                      ? "border-cyan-500/50 bg-cyan-500/10 text-white"
                      : "border-transparent hover:border-slate-700 hover:bg-slate-800/50 text-slate-300"
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                    assigned ? "border-cyan-500 bg-cyan-500" : "border-slate-600"
                  )}>
                    {assigned && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{machine.hostname}</div>
                    <div className="text-xs text-slate-400">{machine.ip}</div>
                  </div>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full",
                    machine.status === 'online'
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-slate-500/10 text-slate-500"
                  )}>
                    {machine.status}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="text-xs text-slate-500">
          {assignedIds.size} / {allMachines.length} machines assigned
        </div>

        {error && (
          <div className="flex items-center gap-2 text-rose-400 text-xs">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 text-emerald-400 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('machines.saved')}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-all text-sm">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? t('machines.saving') : t('machines.save')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ─── Reset Password Modal ────────────────────────────────────────────────────

function ResetPasswordModal({
  user,
  onClose,
  onReset,
}: {
  user: UserItem
  onClose: () => void
  onReset: (password: string) => void
}) {
  const t = useTranslations('userManagement')
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleReset() {
    setResetting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t('errors.resetFailed'))
        return
      }
      onReset(data.generatedPassword)
    } catch {
      setError(t('errors.resetFailed'))
    } finally {
      setResetting(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="space-y-5">
        <div className="text-center">
          <div className="h-12 w-12 rounded-full border border-amber-500/50 bg-amber-500/10 flex items-center justify-center mx-auto mb-3">
            <KeyRound className="h-6 w-6 text-amber-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">{t('resetPassword.title')}</h3>
          <p className="text-sm text-slate-400 mt-1">{user.username}</p>
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-xs text-amber-300">{t('resetPassword.confirm')}</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-rose-400 text-xs">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-all text-sm">
            Cancel
          </button>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="flex-1 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {resetting ? t('resetPassword.resetting') : t('resetPassword.submit')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ─── Delete User Modal ───────────────────────────────────────────────────────

function DeleteUserModal({
  user,
  onClose,
  onDeleted,
}: {
  user: UserItem
  onClose: () => void
  onDeleted: () => void
}) {
  const t = useTranslations('userManagement')
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || t('errors.deleteFailed'))
        return
      }
      onDeleted()
    } catch {
      setError(t('errors.deleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="space-y-5">
        <div className="text-center">
          <div className="h-12 w-12 rounded-full border border-rose-500/50 bg-rose-500/10 flex items-center justify-center mx-auto mb-3">
            <Trash2 className="h-6 w-6 text-rose-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">{t('deleteUser.title')}</h3>
          <p className="text-sm text-slate-400 mt-2">
            {t('deleteUser.confirm', { username: user.username })}
          </p>
        </div>

        <div>
          <label className="text-xs text-slate-400 font-medium block mb-1.5">{t('deleteUser.confirmLabel')}</label>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={user.username}
            className="w-full rounded-lg border border-slate-700 bg-[#070b11] px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-rose-500/60 focus:outline-none focus:ring-1 focus:ring-rose-500/30"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-rose-400 text-xs">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-all text-sm">
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting || confirmName !== user.username}
            className="flex-1 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {deleting ? t('deleteUser.deleting') : t('deleteUser.submit')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ─── Reusable Modal Overlay ──────────────────────────────────────────────────

function ModalOverlay({
  children,
  onClose,
  wide = false,
}: {
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4">
      <div className={cn(
        "relative w-full rounded-xl border border-slate-700 bg-[#0d141b] p-6 shadow-lg",
        wide ? "max-w-2xl" : "max-w-md"
      )}>
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  )
}
