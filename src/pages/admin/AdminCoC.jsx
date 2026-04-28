import { useState, useEffect } from 'react'
import { useAuth } from '../../lib/useAuth'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/dateFormat'

const DEFAULT_COC = `# ALSA Code of Conduct

## 1. Respect and Sportsmanship
All participants are expected to treat fellow competitors, officials, and spectators with respect and courtesy at all times.

## 2. Fair Play
Participants must compete fairly and honestly. Any form of cheating, including manipulation of equipment or falsification of results, is strictly prohibited.

## 3. Safety
All participants must adhere to laser sport safety guidelines. Equipment must be used responsibly and only in designated play areas.

## 4. Equipment
All equipment must comply with ALSA specifications. Any modifications that provide an unfair advantage are prohibited.

## 5. Disputes
Disputes must be raised through official channels. Any aggressive or abusive behaviour during dispute resolution will result in disqualification.

## 6. Social Media
Participants must not post content that brings ALSA or the sport into disrepute.

## 7. Alcohol and Substances
Participants must not compete under the influence of alcohol or prohibited substances.

## 8. Consequences
Breaches of this Code of Conduct may result in warnings, disqualification, or banning from future events.`

export default function AdminCoC() {
  const { user } = useAuth()
  const [versions, setVersions] = useState([])
  const [current, setCurrent] = useState(null)
  const [draftText, setDraftText] = useState(DEFAULT_COC)
  const [activeTab, setActiveTab] = useState('edit') // edit | preview | history
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { loadVersions() }, [])

  async function loadVersions() {
    const { data } = await supabase
      .from('code_of_conduct_versions')
      .select('*')
      .order('created_at', { ascending: false })
    setVersions(data ?? [])
    const published = (data ?? []).find(v => v.is_published)
    if (published) {
      setCurrent(published)
      setDraftText(published.content)
    }
  }

  async function saveDraft() {
    setSaving(true)
    setMsg(null)
    const { error } = await supabase.from('code_of_conduct_versions').insert({
      content: draftText,
      is_published: false,
      created_by: user.id,
      version_note: 'Draft',
    })
    setSaving(false)
    if (error) setMsg({ type: 'error', text: error.message })
    else {
      setMsg({ type: 'ok', text: 'Draft saved.' })
      loadVersions()
    }
  }

  async function publishVersion() {
    setPublishing(true)
    setMsg(null)
    // INSERT the new published row first; capture id so we can leave it alone when unpublishing the rest.
    // Avoids the previous flow's UPDATE-then-INSERT race that could leave 0 published rows on partial failure.
    const { data: newRow, error: insertErr } = await supabase
      .from('code_of_conduct_versions')
      .insert({
        content: draftText,
        is_published: true,
        created_by: user.id,
        version_note: `Published ${formatDate(new Date(), 'numeric')}`,
      })
      .select('id')
      .single()
    if (insertErr) {
      setPublishing(false)
      setMsg({ type: 'error', text: insertErr.message })
      return
    }
    // Unpublish all OTHER previously-published rows.
    const { error: unpublishErr } = await supabase
      .from('code_of_conduct_versions')
      .update({ is_published: false })
      .eq('is_published', true)
      .neq('id', newRow.id)
    if (unpublishErr) {
      setPublishing(false)
      setMsg({ type: 'error', text: `Published, but couldn't unpublish older rows: ${unpublishErr.message}` })
      return
    }
    setPublishing(false)
    setMsg({ type: 'ok', text: 'Published. Players will be prompted to re-sign.' })
    loadVersions()
  }

  function simpleMarkdown(md) {
    return md
      .replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold text-white mt-4 mb-2">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold text-brand mt-6 mb-3">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-black text-white mb-4">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^(.+)$/gm, (line) => {
        if (line.startsWith('<h') || line.trim() === '') return line
        return `<p class="text-[#e5e5e5]/70 text-sm leading-relaxed mb-2">${line}</p>`
      })
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white">Code of Conduct</h1>
        <p className="text-[#e5e5e5]/40 text-sm mt-1">Edit and publish the ALSA Code of Conduct</p>
      </div>

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
            rows={30}
            className="w-full bg-base border border-line rounded-xl px-4 py-4 text-sm text-[#e5e5e5]/80 font-mono focus:outline-none focus:border-brand transition-colors resize-none"
            placeholder="Write your Code of Conduct in Markdown…"
          />
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={publishVersion}
              disabled={publishing}
              className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all"
            >
              {publishing ? 'Publishing…' : 'Publish New Version'}
            </button>
            <button
              onClick={saveDraft}
              disabled={saving}
              className="border border-line hover:border-[#374056] text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save as Draft'}
            </button>
            {msg && (
              <span className={`text-sm ml-2 ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</span>
            )}
          </div>
        </div>
      )}

      {activeTab === 'preview' && (
        <div className="bg-surface border border-line rounded-xl p-6 max-w-3xl">
          <div
            className="prose-sm"
            dangerouslySetInnerHTML={{ __html: simpleMarkdown(draftText) }}
          />
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
                  {v.is_published && (
                    <span className="text-xs bg-brand/10 text-brand border border-brand/20 px-2 py-0.5 rounded font-bold">Live</span>
                  )}
                </div>
                <p className="text-xs text-[#e5e5e5]/40">
                  {formatDate(v.created_at, 'longWithTime')}
                </p>
              </div>
              <button
                onClick={() => { setDraftText(v.content); setActiveTab('edit') }}
                className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/70 hover:text-white font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
