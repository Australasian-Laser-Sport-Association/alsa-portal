import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/dateFormat'
import { maskStorageUrl } from '../../lib/assetUrl'
import Dialog from '../../components/Dialog'

const inputClass = 'w-full bg-[#191919] border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand/50 transition-colors'
const labelClass = 'block text-xs font-medium text-[#e5e5e5]/50 uppercase tracking-wider mb-1.5'

// Icons reuse the existing inline-SVG (heroicons-outline) set already used across
// the admin panel — no new icon library.
const ICONS = {
  shield: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  document: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  user: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
}

const DOC_TYPES = [
  { key: 'code_of_conduct', label: 'Code of Conduct', icon: ICONS.shield },
  { key: 'media_release',   label: 'Media Release',   icon: ICONS.document },
  { key: 'under_18_form',   label: 'Under 18 Form',   icon: ICONS.user },
]

const MAX_BYTES = 10 * 1024 * 1024
// Storage bucket name is part of the data model and is intentionally unchanged
// by the "Legal Documents" → "Required Documents" UI rename.
const BUCKET = 'legal-documents'

function slugifyPdf(filename) {
  const base = (filename ?? '').replace(/\.pdf$/i, '')
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '') || 'document'
  return `${slug}.pdf`
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function uploaderName(p) {
  if (!p) return null
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.alias || null
}

function publicUrl(filePath) {
  return maskStorageUrl(supabase.storage.from(BUCKET).getPublicUrl(filePath).data.publicUrl)
}

// ---------------------------------------------------------------------------

export default function AdminRequiredDocuments() {
  useOutletContext()
  const [selected, setSelected] = useState('code_of_conduct')
  const [summary, setSummary] = useState({}) // { [document_type]: activeRow }
  const [toast, setToast] = useState(null)

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Lightweight read of the active version per type, so the left-rail cards can
  // show upload status without each card mounting its own DocumentTab.
  async function loadSummary() {
    const { data } = await supabase
      .from('legal_documents')
      .select('document_type, original_filename, uploaded_at')
      .eq('is_active', true)
    const map = {}
    for (const row of data ?? []) map[row.document_type] = row
    setSummary(map)
  }

  useEffect(() => { loadSummary() }, [])

  const activeLabel = DOC_TYPES.find(t => t.key === selected)?.label ?? ''

  return (
    <div>
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl border ${
          toast.type === 'error'
            ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'bg-brand/10 border-brand/30 text-brand'
        }`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-lg font-black text-white">Required Documents</h1>
        <p className="text-xs text-[#e5e5e5]/40 mt-1">PDF versions of the three player-acknowledged documents.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 md:items-start">
        {/* Left rail — document selectors */}
        <div className="md:w-[300px] md:flex-shrink-0">
          <p className="text-xs text-[#e5e5e5]/40 mb-3 leading-relaxed">
            Select a document to upload the master file players will download and sign.
          </p>
          <div className="space-y-3">
            {DOC_TYPES.map(t => (
              <SelectorCard
                key={t.key}
                docType={t}
                active={selected === t.key}
                doc={summary[t.key] ?? null}
                onSelect={() => setSelected(t.key)}
              />
            ))}
          </div>
        </div>

        {/* Right column — upload panel for the selected document */}
        <div className="flex-1 min-w-0">
          <DocumentTab
            key={selected}
            documentType={selected}
            label={activeLabel}
            showToast={showToast}
            onDataChanged={loadSummary}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SelectorCard — left-rail navigation card for one document type
// ---------------------------------------------------------------------------

function SelectorCard({ docType, active, doc, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`w-full text-left flex items-start gap-3 p-4 rounded-2xl border transition-all ${
        active
          ? 'bg-brand/10 border-brand/40 shadow-lg shadow-brand/5'
          : 'bg-surface border-line hover:bg-line/30 hover:border-line'
      }`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
        active ? 'bg-brand/15 border-brand/30 text-brand' : 'bg-[#191919] border-line text-[#e5e5e5]/50'
      }`}>
        {docType.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`font-bold text-sm ${active ? 'text-white' : 'text-white/90'}`}>{docType.label}</p>
        {doc ? (
          <div className="mt-1">
            <p className="text-xs text-[#e5e5e5]/60 truncate">Uploaded — {doc.original_filename}</p>
            <p className="text-[11px] text-[#e5e5e5]/40 mt-0.5">{formatDate(doc.uploaded_at)}</p>
          </div>
        ) : (
          <p className="text-xs text-amber-400/80 mt-1">No file uploaded yet</p>
        )}
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// DocumentTab — one document type's panel (current + upload + history)
// ---------------------------------------------------------------------------

function DocumentTab({ documentType, label, showToast, onDataChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null) // { type: 'deactivate'|'reactivate', id, label }
  const [busy, setBusy] = useState(false)

  useEffect(() => { load() }, [documentType])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('legal_documents')
      .select('id, document_type, version, file_path, original_filename, effective_date, uploaded_by, uploaded_at, is_active, requires_reacceptance, notes, uploader:profiles!uploaded_by(first_name, last_name, alias)')
      .eq('document_type', documentType)
      .order('version', { ascending: false })
    if (error) {
      showToast(`Load failed: ${error.message}`, 'error')
      setRows([])
    } else {
      setRows(data ?? [])
    }
    setLoading(false)
    onDataChanged?.()
  }

  const active = rows.find(r => r.is_active) ?? null
  const history = rows.filter(r => !r.is_active)

  async function deactivate(id) {
    setBusy(true)
    const { error } = await supabase.from('legal_documents').update({ is_active: false }).eq('id', id)
    setBusy(false)
    setConfirmAction(null)
    if (error) {
      showToast(`Deactivate failed: ${error.message}`, 'error')
      return
    }
    showToast('Version deactivated.')
    load()
  }

  async function reactivate(id) {
    setBusy(true)
    // Deactivate any current active rows for this type, then activate the chosen one.
    const updateAllOff = await supabase
      .from('legal_documents')
      .update({ is_active: false })
      .eq('document_type', documentType)
      .neq('id', id)
    if (updateAllOff.error) {
      setBusy(false)
      setConfirmAction(null)
      showToast(`Reactivate failed: ${updateAllOff.error.message}`, 'error')
      return
    }
    const activate = await supabase.from('legal_documents').update({ is_active: true }).eq('id', id)
    setBusy(false)
    setConfirmAction(null)
    if (activate.error) {
      showToast(`Activate step failed: ${activate.error.message}`, 'error')
      return
    }
    showToast('Version reactivated.')
    load()
  }

  return (
    <div className="space-y-8">

      {/* Panel heading */}
      <div>
        <h2 className="text-base font-bold text-white">{label} — Master File</h2>
        <p className="text-xs text-[#e5e5e5]/40 mt-1 leading-relaxed">
          This is the file players will download from their player hub. Replacing it does not invalidate existing player signatures.
        </p>
      </div>

      {/* Current active version */}
      <section>
        <h2 className="text-xs font-bold text-brand uppercase tracking-widest mb-3">Current active version</h2>
        {loading ? (
          <div className="bg-surface border border-line rounded-2xl p-6 flex justify-center">
            <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : active ? (
          <ActiveVersionCard
            row={active}
            onDeactivate={() => setConfirmAction({ type: 'deactivate', id: active.id, label: active.original_filename })}
          />
        ) : (
          <div className="bg-surface border border-line rounded-2xl p-6 text-center text-sm text-[#e5e5e5]/40">
            No active version. Upload one below.
          </div>
        )}
      </section>

      {/* Upload */}
      <section>
        <h2 className="text-xs font-bold text-brand uppercase tracking-widest mb-3">Upload new version</h2>
        <UploadForm
          documentType={documentType}
          highestVersion={rows[0]?.version ?? 0}
          onUploaded={() => { load(); showToast('Uploaded and activated.') }}
          showToast={showToast}
        />
      </section>

      {/* History */}
      <section>
        <button
          type="button"
          onClick={() => setHistoryOpen(v => !v)}
          className="flex items-center justify-between w-full mb-3 group"
        >
          <h2 className="text-xs font-bold text-brand uppercase tracking-widest group-hover:text-brand-hover">
            Historical versions {history.length > 0 && <span className="text-[#e5e5e5]/40 font-medium normal-case tracking-normal">({history.length})</span>}
          </h2>
          <svg className={`w-4 h-4 text-[#e5e5e5]/40 transition-transform ${historyOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {historyOpen && (
          loading ? null
          : history.length === 0 ? (
            <p className="text-sm text-[#e5e5e5]/30 text-center py-6 bg-surface border border-line rounded-2xl">No older versions yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map(r => (
                <HistoryRow
                  key={r.id}
                  row={r}
                  onReactivate={() => setConfirmAction({ type: 'reactivate', id: r.id, label: r.original_filename })}
                />
              ))}
            </div>
          )
        )}
      </section>

      {/* Confirm dialog */}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.type === 'deactivate' ? 'Deactivate this version?' : 'Reactivate this version?'}
          body={confirmAction.type === 'deactivate'
            ? `Players will see no active document for this type until a new version is uploaded or another is reactivated.`
            : `“${confirmAction.label}” will become the active version and any other active version will be deactivated.`}
          confirmLabel={confirmAction.type === 'deactivate' ? 'Yes, deactivate' : 'Yes, reactivate'}
          busy={busy}
          onConfirm={() => confirmAction.type === 'deactivate' ? deactivate(confirmAction.id) : reactivate(confirmAction.id)}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function ActiveVersionCard({ row, onDeactivate }) {
  return (
    <div className="bg-surface border border-brand/30 rounded-2xl p-5 flex flex-col gap-4 xl:flex-row xl:items-center">
      <div className="flex items-center gap-4 xl:flex-1 xl:min-w-0">
        <div className="w-12 h-12 bg-brand/10 border border-brand/30 rounded-xl flex items-center justify-center flex-shrink-0">
          <svg className="w-6 h-6 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white font-bold truncate">{row.original_filename}</p>
          <p className="text-xs text-[#e5e5e5]/50 mt-0.5">
            v{row.version} · Effective {formatDate(row.effective_date)} · Uploaded {formatDate(row.uploaded_at)}
            {row.uploader && ` by ${uploaderName(row.uploader)}`}
          </p>
          {row.requires_reacceptance && (
            <p className="text-[10px] uppercase tracking-wider text-amber-400/80 mt-1.5 font-bold">Requires re-acceptance</p>
          )}
          {row.notes && <p className="text-xs text-[#e5e5e5]/50 mt-2 italic">{row.notes}</p>}
        </div>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <a
          href={publicUrl(row.file_path)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 px-3 py-2 rounded-lg font-medium transition-colors"
        >
          View PDF ↗
        </a>
        <button
          onClick={onDeactivate}
          className="text-xs bg-[#191919] hover:bg-line text-[#e5e5e5]/60 hover:text-white border border-line px-3 py-2 rounded-lg font-medium transition-colors"
        >
          Deactivate
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function HistoryRow({ row, onReactivate }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3 xl:flex-row xl:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-white font-bold text-sm">v{row.version}</span>
          <span className="text-sm text-[#e5e5e5]/70 truncate">{row.original_filename}</span>
        </div>
        <p className="text-xs text-[#e5e5e5]/40 mt-0.5">
          Effective {formatDate(row.effective_date)} · Uploaded {formatDate(row.uploaded_at)}
          {row.uploader && ` by ${uploaderName(row.uploader)}`}
        </p>
        {row.notes && <p className="text-xs text-[#e5e5e5]/40 mt-1.5 italic">{row.notes}</p>}
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <a
          href={publicUrl(row.file_path)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-brand/80 hover:text-brand font-medium px-3 py-1.5 rounded-lg hover:bg-brand/5"
        >
          View ↗
        </a>
        <button
          onClick={onReactivate}
          className="text-xs bg-[#191919] hover:bg-line text-[#e5e5e5]/60 hover:text-white border border-line px-3 py-1.5 rounded-lg font-medium transition-colors"
        >
          Reactivate
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload form
// ---------------------------------------------------------------------------

function UploadForm({ documentType, highestVersion, onUploaded, showToast }) {
  const fileRef = useRef()
  const [file, setFile] = useState(null)
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [requiresReacceptance, setRequiresReacceptance] = useState(true)
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [fileError, setFileError] = useState(null)
  const [progress, setProgress] = useState(0)

  function onFileChange(e) {
    setFileError(null)
    const f = e.target.files?.[0]
    if (!f) { setFile(null); return }
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setFileError('Must be a PDF.')
      setFile(null)
      return
    }
    if (f.size > MAX_BYTES) {
      setFileError(`File is ${humanSize(f.size)} — max ${humanSize(MAX_BYTES)}.`)
      setFile(null)
      return
    }
    setFile(f)
  }

  async function submit() {
    if (!file) { setFileError('Choose a PDF first.'); return }
    if (!effectiveDate) { showToast('Effective date is required.', 'error'); return }

    setUploading(true)
    setProgress(10)

    const nextVersion = (highestVersion ?? 0) + 1
    const slug = slugifyPdf(file.name)
    const filePath = `${documentType}/v${nextVersion}/${slug}`

    // 1. Upload to storage
    setProgress(25)
    const up = await supabase.storage.from(BUCKET).upload(filePath, file, {
      upsert: false,
      contentType: 'application/pdf',
    })
    if (up.error) {
      setUploading(false)
      setProgress(0)
      showToast(`Upload failed: ${up.error.message}`, 'error')
      return
    }

    // 2. Insert the new active row
    setProgress(60)
    const { data: { user } } = await supabase.auth.getUser()
    const insert = await supabase.from('legal_documents').insert({
      document_type: documentType,
      version: nextVersion,
      file_path: filePath,
      original_filename: file.name,
      effective_date: effectiveDate,
      uploaded_by: user?.id ?? null,
      is_active: true,
      requires_reacceptance: requiresReacceptance,
      notes: notes.trim() || null,
    }).select('id').single()
    if (insert.error) {
      setUploading(false)
      setProgress(0)
      // Roll back the storage upload best-effort
      await supabase.storage.from(BUCKET).remove([filePath]).catch(() => {})
      showToast(`Database insert failed: ${insert.error.message}`, 'error')
      return
    }

    // 3. Deactivate every other row for this document_type
    setProgress(85)
    const deact = await supabase
      .from('legal_documents')
      .update({ is_active: false })
      .eq('document_type', documentType)
      .neq('id', insert.data.id)
    if (deact.error) {
      setUploading(false)
      setProgress(0)
      showToast(`Uploaded, but couldn't deactivate older versions: ${deact.error.message}. Use the Reactivate buttons to fix.`, 'error')
      return
    }

    // Reset form
    setProgress(100)
    setFile(null)
    setNotes('')
    setEffectiveDate(new Date().toISOString().slice(0, 10))
    setRequiresReacceptance(true)
    if (fileRef.current) fileRef.current.value = ''
    setUploading(false)
    setProgress(0)
    onUploaded()
  }

  return (
    <div className="bg-surface border border-line rounded-2xl p-5 space-y-5">
      {/* File picker row */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        <div className="xl:flex-1 xl:min-w-0">
          <label className={labelClass}>PDF file *</label>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={onFileChange}
            disabled={uploading}
            className="block w-full text-sm text-[#e5e5e5]/70 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border file:border-line file:bg-[#191919] file:text-[#e5e5e5]/80 file:text-xs file:font-medium hover:file:bg-line file:cursor-pointer"
          />
          {file && (
            <p className="text-xs text-[#e5e5e5]/50 mt-1.5">
              {file.name} · {humanSize(file.size)} · will save as <code className="text-brand/70">{`${documentType}/v${(highestVersion ?? 0) + 1}/${slugifyPdf(file.name)}`}</code>
            </p>
          )}
          {fileError && <p className="text-xs text-red-400 mt-1.5">{fileError}</p>}
        </div>
        <div className="xl:w-48">
          <label className={labelClass}>Effective date *</label>
          <input
            type="date"
            className={inputClass}
            value={effectiveDate}
            onChange={e => setEffectiveDate(e.target.value)}
            disabled={uploading}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Notes</label>
        <textarea
          className={`${inputClass} resize-y`}
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          disabled={uploading}
          placeholder="What changed in this version?"
        />
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={requiresReacceptance}
            onChange={e => setRequiresReacceptance(e.target.checked)}
            disabled={uploading}
            className="w-4 h-4 accent-brand"
          />
          <span className="text-sm text-white">Requires re-acceptance from all players</span>
        </label>
        <div className="flex items-center gap-3">
          {uploading && progress > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-32 h-1.5 bg-[#191919] rounded-full overflow-hidden">
                <div className="h-full bg-brand transition-all duration-200" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs text-[#e5e5e5]/50 tabular-nums">{progress}%</span>
            </div>
          )}
          <button
            onClick={submit}
            disabled={uploading || !file}
            className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all"
          >
            {uploading ? 'Uploading…' : 'Upload and activate'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ConfirmDialog({ title, body, confirmLabel, busy, onConfirm, onCancel }) {
  return (
    <Dialog open onClose={onCancel} variant="center" size="sm" closeOnBackdrop className="p-6">
        <Dialog.Title as="h3" className="text-white font-bold mb-3">{title}</Dialog.Title>
        <p className="text-sm text-[#e5e5e5]/60 leading-relaxed mb-5">{body}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="text-sm text-[#e5e5e5]/60 hover:text-white px-3 py-2">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-5 py-2 rounded-lg text-sm"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
    </Dialog>
  )
}
