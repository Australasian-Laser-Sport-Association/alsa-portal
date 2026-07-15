import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { apiFetch } from '../../lib/apiFetch.js'
import { formatDate, formatDateTime } from '../../lib/dateFormat'

const DOC_LABELS = {
  code_of_conduct: 'Code of Conduct',
  media_release: 'Media Release',
}

const SIGNED_DOC_TYPES = Object.keys(DOC_LABELS)

function docLabel(type) {
  return DOC_LABELS[type] ?? type?.replace(/_/g, ' ') ?? 'Document'
}

function profilePrimary(profile) {
  if (!profile) return 'Account removed'
  return profile.alias || [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Unnamed account'
}

function profileSecondary(profile) {
  if (!profile) return 'Profile no longer resolves'
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ')
  if (!fullName || fullName === profile.alias) return ''
  return fullName
}

function profileInitials(profile) {
  if (!profile) return '?'
  const fromName = `${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}`.toUpperCase()
  return fromName || profile.alias?.[0]?.toUpperCase() || '?'
}

function sortVersions(a, b) {
  const typeCompare = docLabel(a.document_type).localeCompare(docLabel(b.document_type))
  if (typeCompare !== 0) return typeCompare
  return (b.version ?? 0) - (a.version ?? 0)
}

export default function AdminSignedDocuments() {
  useOutletContext()
  const [documents, setDocuments] = useState([])
  const [acceptances, setAcceptances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const data = await apiFetch('/api/admin/event?resource=signed-documents')
        if (cancelled) return
        setDocuments((data.documents ?? []).filter(document => SIGNED_DOC_TYPES.includes(document.document_type)))
        setAcceptances(data.acceptances ?? [])
      } catch (loadError) {
        if (cancelled) return
        setDocuments([])
        setAcceptances([])
        setError(loadError.message || 'Player acknowledgements could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const grouped = useMemo(() => {
    const versions = new Map()

    for (const doc of documents) {
      versions.set(doc.id, {
        ...doc,
        signatures: [],
      })
    }

    for (const row of acceptances) {
      const doc = row.document
      const key = row.document_id || doc?.id
      if (!key) continue

      if (!versions.has(key)) {
        versions.set(key, {
          id: key,
          document_type: doc?.document_type ?? 'unknown',
          version: doc?.version ?? null,
          original_filename: doc?.original_filename ?? null,
          effective_date: doc?.effective_date ?? null,
          is_active: false,
          signatures: [],
        })
      }

      versions.get(key).signatures.push(row)
    }

    const byType = new Map()
    for (const version of [...versions.values()].sort(sortVersions)) {
      const type = version.document_type ?? 'unknown'
      if (!byType.has(type)) byType.set(type, [])
      byType.get(type).push(version)
    }

    return [...byType.entries()].map(([type, versionRows]) => ({
      type,
      versions: versionRows,
      signatureCount: versionRows.reduce((sum, row) => sum + row.signatures.length, 0),
    }))
  }, [acceptances, documents])

  const totalSignatures = acceptances.length
  const totalVersions = documents.length

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-lg font-black text-white">Player Acknowledgements</h1>
          <p className="text-xs text-[#e5e5e5]/60 mt-1">
            Code of Conduct agreements and Media Release consents. Under-18 parental consent is tracked separately under approvals.
          </p>
        </div>
        {!loading && (
          <div className="flex gap-2 text-xs">
            <span className="px-3 py-1.5 rounded-lg bg-brand/10 border border-brand/20 text-brand font-bold">
              {totalSignatures} acknowledgement{totalSignatures === 1 ? '' : 's'}
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-surface border border-line text-[#e5e5e5]/70 font-medium">
              {totalVersions} versions
            </span>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && grouped.length === 0 && (
        <div className="bg-surface border border-line rounded-2xl p-8 text-center">
          <p className="text-white font-bold">No document versions found.</p>
            <p className="text-sm text-[#e5e5e5]/60 mt-1">Upload Code of Conduct and Media Release versions before player acknowledgements can appear here.</p>
        </div>
      )}

      {!loading && !error && grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map(group => (
            <section key={group.type} className="bg-surface border border-line rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-white font-black text-base">{docLabel(group.type)}</h2>
                  <p className="text-xs text-[#e5e5e5]/60 mt-0.5">{group.versions.length} versions</p>
                </div>
                <span className="text-xs font-bold text-brand bg-brand/10 border border-brand/20 px-3 py-1.5 rounded-lg">
                  {group.signatureCount} acknowledgement{group.signatureCount === 1 ? '' : 's'}
                </span>
              </div>

              <div className="divide-y divide-line">
                {group.versions.map(version => (
                  <DocumentVersion key={version.id} version={version} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function DocumentVersion({ version }) {
  const signatures = version.signatures ?? []

  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-black uppercase tracking-wider text-black bg-brand px-2 py-1 rounded">
              v{version.version ?? '?'}
            </span>
            {version.is_active && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-brand border border-brand/25 bg-brand/10 px-2 py-1 rounded">
                Active
              </span>
            )}
          </div>
          <p className="text-white font-bold text-sm mt-2 truncate">{version.original_filename || 'Untitled document'}</p>
          <p className="text-xs text-[#e5e5e5]/60 mt-1">
            Effective {formatDate(version.effective_date, 'short') || 'not set'}
          </p>
        </div>
        <span className="text-xs text-[#e5e5e5]/70 bg-base border border-line px-3 py-1.5 rounded-lg">
          {signatures.length} accepted
        </span>
      </div>

      {signatures.length === 0 ? (
        <div className="bg-base border border-line rounded-xl px-4 py-6 text-center">
          <p className="text-sm text-[#e5e5e5]/60">No acknowledgements yet for this version.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-line rounded-xl">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-base text-[#e5e5e5]/50 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left font-bold px-4 py-3">Player</th>
                <th className="text-left font-bold px-4 py-3">Event year</th>
                <th className="text-left font-bold px-4 py-3">Accepted</th>
                <th className="text-left font-bold px-4 py-3">Version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {signatures.map(row => (
                <tr key={row.id} className="bg-surface">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${
                        row.profile ? 'bg-brand/15 text-brand' : 'bg-amber-500/15 text-amber-300'
                      }`}>
                        {profileInitials(row.profile)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-white font-bold truncate">{profilePrimary(row.profile)}</p>
                        {profileSecondary(row.profile) && (
                          <p className="text-xs text-[#e5e5e5]/60 truncate">{profileSecondary(row.profile)}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#e5e5e5]/75 whitespace-nowrap">{row.event_year ?? '-'}</td>
                  <td className="px-4 py-3 text-[#e5e5e5]/75 whitespace-nowrap">{formatDateTime(row.accepted_at)}</td>
                  <td className="px-4 py-3 text-[#e5e5e5]/75 whitespace-nowrap">v{version.version ?? '?'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
