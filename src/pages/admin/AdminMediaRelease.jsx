import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/dateFormat'

const DEFAULT_CONTENT = `ALSA Media Release Form

The Australasian Laser Sport Association (ALSA) may photograph and/or film participants during ZLTAC events for promotional, archival, and media purposes. This content may be used on ALSA's website, social media channels, printed materials, and other official communications.

Please indicate your consent preference below.

OPTION A — Consent
I consent to photos and/or video footage in which I appear being used by ALSA and ZLTAC for promotional and archival purposes. I understand that such content may be published on ALSA's website, social media, or other official channels.

OPTION B — Decline
I do not consent to my image being used in any ALSA or ZLTAC promotional or archival materials. I understand that ALSA officials will take reasonable steps to ensure that I am not identifiable in published content.

Your choice does not affect your participation in any ZLTAC event.`

function simpleMarkdown(md) {
  return md
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold text-white mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold text-brand mt-6 mb-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-black text-white mb-4">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^(.+)$/gm, (line) => {
      if (line.startsWith('<h') || line.trim() === '') return line
      return `<p class="text-[#e5e5e5]/70 text-sm leading-relaxed mb-2">${line}</p>`
    })
}

export default function AdminMediaRelease() {
  const { user } = useAuth()
  const [versions, setVersions] = useState([])
  const [current, setCurrent] = useState(null)
  const [draftText, setDraftText] = useState(DEFAULT_CONTENT)
  const [activeTab, setActiveTab] = useState('edit')
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [msg, setMsg] = useState(null)
  const [stats, setStats] = useState(null) // { total, consented, declined }

  useEffect(() => { loadVersions(); loadStats() }, [])

  async function loadVersions() {
    const { data } = await supabase
      .from('media_release_versions')
      .select('*')
      .order('created_at', { ascending: false })
    setVersions(data ?? [])
    const published = (data ?? []).find(v => v.is_published)
    if (published) {
      setCurrent(published)
      setDraftText(published.content)
    }
  }

  async function loadStats() {
    const { data: ev } = await supabase
      .from('zltac_events')
      .select('year')
      .in('status', ['open', 'closed'])
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!ev) return
    const { data } = await supabase
      .from('media_release_submissions')
      .select('consents')
      .eq('event_year', ev.year)
    if (data) {
      setStats({
        total: data.length,
        consented: data.filter(d => d.consents).length,
        declined: data.filter(d => !d.consents).length,
      })
    }
  }

  async function saveDraft() {
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('media_release_versions').insert({
      content: draftText,
      is_published: false,
      created_by: user.id,
      version_note: 'Draft',
    })
    setSaving(false)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'ok', text: 'Draft saved.' }); loadVersions() }
  }

  async function publishVersion() {
    setPublishing(true); setMsg(null)
    await supabase.from('media_release_versions').update({ is_published: false }).eq('is_published', true)
    const { error } = await supabase.from('media_release_versions').insert({
      content: draftText,
      is_published: true,
      created_by: user.id,
      version_note: `Published ${formatDate(new Date(), 'numeric')}`,
    })
    setPublishing(false)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'ok', text: 'Published. Players will see the updated form.' }); loadVersions() }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white">Media Release Form</h1>
        <p className="text-[#e5e5e5]/40 text-sm mt-1">Edit and publish the media release consent form</p>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Total submissions', value: stats.total, colour: 'text-white' },
            { label: 'Consented', value: stats.consented, colour: 'text-brand' },
            { label: 'Declined', value: stats.declined, colour: 'text-red-400' },
          ].map(({ label, value, colour }) => (
            <div key={label} className="bg-surface border border-line rounded-xl px-4 py-3 text-center">
              <p className={`text-2xl font-black ${colour}`}>{value}</p>
              <p className="text-[#e5e5e5]/40 text-xs mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-line mb-6">
        {[
          { key: 'edit', label: 'Editor' },
          { key: 'preview', label: 'Preview' },
          { key: 'history', label: `History (${versions.length})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              activeTab === t.key ? 'border-brand text-brand' : 'border-transparent text-[#e5e5e5]/40 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'edit' && (
        <div>
          {current && (
            <div className="mb-3 text-xs text-[#e5e5e5]/40">
              Currently published: <span className="text-brand">{current.version_note}</span> on {formatDate(current.created_at, 'numeric')}
            </div>
          )}
          <textarea
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            rows={28}
            className="w-full bg-base border border-line rounded-xl px-4 py-4 text-sm text-[#e5e5e5]/80 font-mono focus:outline-none focus:border-brand transition-colors resize-none"
            placeholder="Write your media release form content…"
          />
          <div className="flex items-center gap-3 mt-4">
            <button onClick={publishVersion} disabled={publishing} className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all">
              {publishing ? 'Publishing…' : 'Publish New Version'}
            </button>
            <button onClick={saveDraft} disabled={saving} className="border border-line hover:border-[#374056] text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Save as Draft'}
            </button>
            {msg && <span className={`text-sm ml-2 ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</span>}
          </div>
        </div>
      )}

      {activeTab === 'preview' && (
        <div className="bg-surface border border-line rounded-xl p-6 max-w-3xl">
          <div className="prose-sm" dangerouslySetInnerHTML={{ __html: simpleMarkdown(draftText) }} />
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-3">
          {versions.length === 0 ? (
            <p className="text-center py-12 text-[#e5e5e5]/30 text-sm">No versions published yet</p>
          ) : versions.map(v => (
            <div key={v.id} className="bg-surface border border-line rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-white">{v.version_note}</span>
                  {v.is_published && <span className="text-xs bg-brand/10 text-brand border border-brand/20 px-2 py-0.5 rounded font-bold">Live</span>}
                </div>
                <p className="text-xs text-[#e5e5e5]/40">
                  {formatDate(v.created_at, 'longWithTime')}
                </p>
              </div>
              <button onClick={() => { setDraftText(v.content); setActiveTab('edit') }} className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/70 hover:text-white font-semibold px-4 py-2 rounded-lg transition-colors">
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
