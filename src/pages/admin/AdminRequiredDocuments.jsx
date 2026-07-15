import { useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { apiFetch } from '../../lib/apiFetch.js'
import { formatDate } from '../../lib/dateFormat'

const MAX_BYTES = 4 * 1024 * 1024
const inputClass = 'w-full bg-[#191919] border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand/50 transition-colors'
const labelClass = 'block text-xs font-medium text-[#e5e5e5]/60 uppercase tracking-wider mb-1.5'

const ICONS = {
  shield: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  document: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
  { key: 'media_release', label: 'Media Release', icon: ICONS.document },
  { key: 'under_18_form', label: 'Under 18 Form', icon: ICONS.user },
]

function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return 'Unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function uploaderName(profile) {
  if (!profile) return null
  return [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.alias || null
}

function shortDigest(digest) {
  return digest ? `${digest.slice(0, 12)}...${digest.slice(-8)}` : null
}

export default function AdminRequiredDocuments() {
  useOutletContext()
  const [selected, setSelected] = useState('code_of_conduct')
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const result = await apiFetch('/api/admin/event?resource=required-documents')
        if (!cancelled) setDocuments(result.documents ?? [])
      } catch (err) {
        if (!cancelled) {
          setDocuments([])
          setError(err?.message || 'Required documents could not be loaded.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [reloadKey])

  function showToast(message, type = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  const selectedType = DOC_TYPES.find(type => type.key === selected)
  const selectedRows = documents
    .filter(document => document.document_type === selected)
    .sort((a, b) => b.version - a.version)
  const active = selectedRows.find(document => document.is_active && document.published_at) ?? null
  const history = selectedRows.filter(document => document.id !== active?.id)

  return (
    <div>
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl border ${
          toast.type === 'error'
            ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'bg-brand/10 border-brand/30 text-brand'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-lg font-black text-white">Required Documents</h1>
        <p className="text-xs text-[#e5e5e5]/60 mt-1">
          Publish immutable PDF versions used for player acceptance evidence.
        </p>
      </div>

      {error && (
        <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/5 p-4" role="alert">
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => setReloadKey(key => key + 1)}
            className="mt-3 text-xs font-bold text-brand hover:text-brand-hover"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-6 md:items-start">
        <div className="md:w-[300px] md:flex-shrink-0">
          <p className="text-xs text-[#e5e5e5]/60 mb-3 leading-relaxed">
            Publishing a new version replaces the active version. Published file content and evidence cannot be edited.
          </p>
          <div className="space-y-3">
            {DOC_TYPES.map(type => {
              const current = documents.find(document =>
                document.document_type === type.key
                && document.is_active
                && document.published_at
              )
              return (
                <SelectorCard
                  key={type.key}
                  type={type}
                  active={selected === type.key}
                  document={current}
                  onSelect={() => setSelected(type.key)}
                />
              )
            })}
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-8">
          <section>
            <h2 className="text-base font-bold text-white">{selectedType?.label} - active publication</h2>
            <p className="text-xs text-[#e5e5e5]/60 mt-1">
              Public links resolve through the branded portal and are available only while this version is active.
            </p>
            <div className="mt-3">
              {loading ? (
                <div className="bg-surface border border-line rounded-2xl p-6 flex justify-center">
                  <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                </div>
              ) : active ? (
                <DocumentCard document={active} active />
              ) : (
                <div className="bg-surface border border-line rounded-2xl p-6 text-center text-sm text-[#e5e5e5]/60">
                  No verified publication is active. Publish a PDF below.
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-xs font-bold text-brand uppercase tracking-widest mb-3">Publish new immutable version</h2>
            <UploadForm
              documentType={selected}
              onPublished={() => {
                setReloadKey(key => key + 1)
                showToast('The verified PDF was published and activated.')
              }}
              showToast={showToast}
            />
          </section>

          <section>
            <h2 className="text-xs font-bold text-brand uppercase tracking-widest mb-3">
              Historical and legacy versions {history.length > 0 ? `(${history.length})` : ''}
            </h2>
            {history.length === 0 ? (
              <p className="text-sm text-[#e5e5e5]/60 text-center py-6 bg-surface border border-line rounded-2xl">
                No older versions yet.
              </p>
            ) : (
              <div className="space-y-2">
                {history.map(document => <DocumentCard key={document.id} document={document} />)}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function SelectorCard({ type, active, document, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`w-full text-left flex items-start gap-3 p-4 rounded-2xl border transition-all ${
        active
          ? 'bg-brand/10 border-brand/40 shadow-lg shadow-brand/5'
          : 'bg-surface border-line hover:bg-line/30'
      }`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
        active ? 'bg-brand/15 border-brand/30 text-brand' : 'bg-[#191919] border-line text-[#e5e5e5]/60'
      }`}>
        {type.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-sm text-white">{type.label}</p>
        {document ? (
          <>
            <p className="text-xs text-[#e5e5e5]/60 truncate mt-1">v{document.version} - {document.original_filename}</p>
            <p className="text-[11px] text-brand/70 mt-0.5">Verified and active</p>
          </>
        ) : (
          <p className="text-xs text-amber-400/80 mt-1">No verified publication</p>
        )}
      </div>
    </button>
  )
}

function DocumentCard({ document, active = false }) {
  const uploader = uploaderName(document.uploader)
  const verified = Boolean(document.published_at && document.content_sha256 && document.object_size)
  return (
    <div className={`bg-surface border rounded-2xl p-5 ${active ? 'border-brand/30' : 'border-line'}`}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-white font-bold truncate">v{document.version} - {document.original_filename}</p>
            <span className={`text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 font-bold ${
              verified
                ? 'border-brand/30 bg-brand/10 text-brand'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}>
              {verified ? 'Integrity verified' : 'Legacy unverified'}
            </span>
          </div>
          <p className="text-xs text-[#e5e5e5]/60 mt-1">
            Effective {formatDate(document.effective_date)}
            {document.published_at ? ` - Published ${formatDate(document.published_at)}` : ` - Uploaded ${formatDate(document.uploaded_at)}`}
            {uploader ? ` by ${uploader}` : ''}
          </p>
          {verified && (
            <p className="text-[11px] text-[#e5e5e5]/50 font-mono mt-2 break-all">
              SHA-256 {shortDigest(document.content_sha256)} - {humanSize(document.object_size)}
            </p>
          )}
          {document.requires_reacceptance && (
            <p className="text-[10px] uppercase tracking-wider text-amber-400/80 mt-2 font-bold">Requires re-acceptance</p>
          )}
          {document.notes && <p className="text-xs text-[#e5e5e5]/60 mt-2 italic">{document.notes}</p>}
        </div>
        {document.url && (
          <a
            href={document.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 px-3 py-2 rounded-lg font-medium transition-colors"
          >
            View PDF
          </a>
        )}
      </div>
    </div>
  )
}

function UploadForm({ documentType, onPublished, showToast }) {
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [requiresReacceptance, setRequiresReacceptance] = useState(true)
  const [notes, setNotes] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [fileError, setFileError] = useState('')

  function chooseFile(event) {
    setFileError('')
    const selected = event.target.files?.[0] ?? null
    if (!selected) {
      setFile(null)
      return
    }
    if (!selected.name.toLowerCase().endsWith('.pdf') || (selected.type && selected.type !== 'application/pdf')) {
      setFile(null)
      setFileError('Choose a PDF file.')
      return
    }
    if (selected.size > MAX_BYTES) {
      setFile(null)
      setFileError(`The PDF exceeds the ${MAX_BYTES / 1024 / 1024} MB limit.`)
      return
    }
    setFile(selected)
  }

  async function publish() {
    if (!file) {
      setFileError('Choose a PDF file first.')
      return
    }
    if (!effectiveDate) {
      showToast('An effective date is required.', 'error')
      return
    }

    setPublishing(true)
    setFileError('')
    try {
      await apiFetch('/api/admin/event?resource=required-documents&action=publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Content-Type': file.type || 'application/pdf',
          'X-Legal-Document-Type': documentType,
          'X-Legal-Original-Filename': encodeURIComponent(file.name),
          'X-Legal-Effective-Date': effectiveDate,
          'X-Legal-Requires-Reacceptance': String(requiresReacceptance),
          'X-Legal-Notes': encodeURIComponent(notes.trim()),
        },
        body: file,
      })
      setFile(null)
      setNotes('')
      setEffectiveDate(new Date().toISOString().slice(0, 10))
      setRequiresReacceptance(true)
      if (fileRef.current) fileRef.current.value = ''
      onPublished()
    } catch (err) {
      showToast(err?.message || 'The PDF could not be published.', 'error')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="bg-surface border border-line rounded-2xl p-5 space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1fr_12rem]">
        <div>
          <label className={labelClass}>PDF file *</label>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={chooseFile}
            disabled={publishing}
            className="block w-full text-sm text-[#e5e5e5]/70 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border file:border-line file:bg-[#191919] file:text-[#e5e5e5]/80 file:text-xs file:font-medium hover:file:bg-line file:cursor-pointer"
          />
          {file && <p className="text-xs text-[#e5e5e5]/60 mt-1.5">{file.name} - {humanSize(file.size)}</p>}
          {fileError && <p className="text-xs text-red-400 mt-1.5" role="alert">{fileError}</p>}
        </div>
        <div>
          <label className={labelClass}>Effective date *</label>
          <input
            type="date"
            className={inputClass}
            value={effectiveDate}
            onChange={event => setEffectiveDate(event.target.value)}
            disabled={publishing}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Publication notes</label>
        <textarea
          className={`${inputClass} resize-y`}
          rows={2}
          maxLength={500}
          value={notes}
          onChange={event => setNotes(event.target.value)}
          disabled={publishing}
          placeholder="What changed in this version?"
        />
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={requiresReacceptance}
            onChange={event => setRequiresReacceptance(event.target.checked)}
            disabled={publishing}
            className="w-4 h-4 accent-brand"
          />
          <span className="text-sm text-white">Require players to accept this version</span>
        </label>
        <button
          type="button"
          onClick={publish}
          disabled={publishing || !file}
          className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all"
        >
          {publishing ? 'Validating and publishing...' : 'Publish verified PDF'}
        </button>
      </div>
    </div>
  )
}
