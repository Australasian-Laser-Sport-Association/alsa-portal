import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/apiFetch.js'
import { relativeTime } from '../../lib/relativeTime.js'

// Admin → Backups page. Configures the backup_settings row (frequency,
// weekly_day, recipient_emails) and surfaces the last-run status from the
// row itself. "Run backup now" calls the same /api/admin/event?resource=
// backup-run endpoint the cron uses, with enforceSchedule = false so the
// backend always sends regardless of today's day-of-week.
//
// last_backup_at / last_backup_status are NEVER set optimistically from
// the client — every action refetches settings from the server so the UI
// shows the authoritative values the backend wrote.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const DAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

export default function AdminBackups() {
  const [settings, setSettings] = useState(null) // server row; null = loading
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  // Form state — initialised from the loaded row. Dirty checks compare
  // back to `settings` so the Save button knows when there is anything to
  // persist.
  const [frequency, setFrequency] = useState('weekly')
  const [weeklyDay, setWeeklyDay] = useState(0)
  const [emailsText, setEmailsText] = useState('')

  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState(null) // { text, type: 'success' | 'error' }

  function showToast(text, type = 'success') {
    setToast({ text, type })
    setTimeout(() => setToast(null), 5000)
  }

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await apiFetch('/api/admin/event?resource=backup-settings')
      setSettings(data)
      setFrequency(data?.frequency ?? 'weekly')
      setWeeklyDay(data?.weekly_day ?? 0)
      setEmailsText((data?.recipient_emails ?? []).join(', '))
    } catch (err) {
      setLoadError(err.message || 'Could not load backup settings.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Parses the comma-separated text into a clean array. Returns
  // { emails, invalid } — invalid is the first malformed address, or null.
  function parseEmails(raw) {
    const list = raw.split(',').map(e => e.trim()).filter(Boolean)
    for (const e of list) {
      if (!EMAIL_RE.test(e)) return { emails: list, invalid: e }
    }
    return { emails: list, invalid: null }
  }

  async function save() {
    const { emails, invalid } = parseEmails(emailsText)
    if (invalid) {
      showToast(`Invalid email address: ${invalid}`, 'error')
      return
    }
    setSaving(true)
    try {
      const updated = await apiFetch('/api/admin/event?resource=backup-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          frequency,
          weekly_day: weeklyDay,
          recipient_emails: emails,
        }),
      })
      setSettings(updated)
      setEmailsText((updated.recipient_emails ?? []).join(', '))
      showToast('Settings saved.', 'success')
    } catch (err) {
      showToast(err.message || 'Could not save settings.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function runNow() {
    setRunning(true)
    try {
      const result = await apiFetch('/api/admin/event?resource=backup-run', {
        method: 'POST',
      })
      // The handler always returns 200 — distinguish success/failure by
      // the `sent` flag. On either outcome, refetch settings so the
      // last_backup_at / last_backup_status block shows what the backend
      // actually wrote (not what we'd guess from the client clock).
      if (result?.sent === true) {
        showToast(`Backup sent to ${result.recipients} recipient${result.recipients === 1 ? '' : 's'}.`, 'success')
      } else {
        const errMsg = result?.error ? `: ${result.error}` : ''
        showToast(`Backup did not send${errMsg}`, 'error')
      }
      await load()
    } catch (err) {
      showToast(err.message || 'Could not run backup.', 'error')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white">Backups</h1>
        </div>
        <div className="bg-surface border border-line rounded-2xl p-6">
          <p className="text-white font-bold mb-2">Could not load backup settings</p>
          <p className="text-white text-sm opacity-70">{loadError}</p>
        </div>
      </div>
    )
  }

  const lastRunDisplay = settings?.last_backup_at ? relativeTime(settings.last_backup_at) : 'Never'
  const lastRunFull = settings?.last_backup_at
    ? new Date(settings.last_backup_at).toLocaleString('en-AU')
    : null
  const statusText = settings?.last_backup_status ?? (settings?.last_backup_at ? '' : 'No backup has run yet.')

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 text-sm font-bold px-5 py-3 rounded-xl shadow-lg ${
            toast.type === 'error'
              ? 'bg-red-500 text-white'
              : 'bg-brand text-black'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-black text-white">Backups</h1>
        <p className="text-white opacity-50 text-sm mt-1">
          Configure the automatic CSV backup schedule and run a manual backup.
        </p>
      </div>

      {/* Status block */}
      <div className="bg-surface border border-line rounded-2xl p-5 mb-6">
        <p className="text-white text-xs font-bold uppercase tracking-wider opacity-50 mb-2">Last backup</p>
        <div className="flex items-baseline gap-3 flex-wrap">
          <p className="text-white text-xl font-black" title={lastRunFull ?? ''}>{lastRunDisplay}</p>
          {statusText && (
            <p className="text-white text-sm opacity-70">{statusText}</p>
          )}
        </div>
      </div>

      {/* Settings form */}
      <div className="bg-surface border border-line rounded-2xl p-5 mb-6 space-y-5">
        <p className="text-white text-xs font-bold uppercase tracking-wider opacity-70">Schedule</p>

        <div>
          <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Frequency</label>
          <select
            value={frequency}
            onChange={e => setFrequency(e.target.value)}
            className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
          >
            <option value="off">Off</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <p className="text-white text-[11px] opacity-50 mt-1.5">
            The Vercel cron fires daily; this setting decides whether a backup actually sends.
          </p>
        </div>

        {frequency === 'weekly' && (
          <div>
            <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Day of week</label>
            <select
              value={weeklyDay}
              onChange={e => setWeeklyDay(Number(e.target.value))}
              className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
            >
              {DAYS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <p className="text-white text-[11px] opacity-50 mt-1.5">
              Day is checked in the Australia/Sydney timezone.
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Recipient emails</label>
          <textarea
            value={emailsText}
            onChange={e => setEmailsText(e.target.value)}
            rows={3}
            placeholder="committee.alsa@gmail.com, another@example.org"
            className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand resize-none"
          />
          <p className="text-white text-[11px] opacity-50 mt-1.5">
            Comma-separated. The backup attaches three CSVs (registrations, payments, events).
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-all"
          >
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        </div>
      </div>

      {/* Manual run */}
      <div className="bg-surface border border-line rounded-2xl p-5">
        <p className="text-white text-xs font-bold uppercase tracking-wider opacity-70 mb-2">Run a backup now</p>
        <p className="text-white text-sm opacity-70 mb-4">
          Sends all three CSVs to the recipients above immediately. Bypasses the frequency setting.
        </p>
        <button
          type="button"
          onClick={runNow}
          disabled={running}
          className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-all"
        >
          {running ? 'Running...' : 'Run backup now'}
        </button>
      </div>
    </div>
  )
}
