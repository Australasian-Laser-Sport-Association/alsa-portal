import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const DEFAULT_CONTENT = `ALSA Under 18 Parental Consent Form

This form must be completed by the parent or legal guardian of any participant under the age of 18 at the time of the ZLTAC event.

1. CONSENT
By submitting this form, I give consent for the named participant to take part in all ZLTAC competition activities, including main event and any selected side events.

2. MEDICAL AUTHORITY
In the event of an emergency, I authorise ALSA officials to seek appropriate medical assistance for the participant if I cannot be contacted.

3. CODE OF CONDUCT
I confirm that I have discussed the ALSA Code of Conduct with the participant and that they understand and agree to abide by it.

4. SUPERVISION
I understand that ALSA and ZLTAC officials are not responsible for the supervision of under 18 participants outside of official event activities.

5. PHOTOGRAPHY & MEDIA
I acknowledge that the participant may be photographed or filmed during the event for ALSA promotional purposes, subject to the participant's own media release preference.

Parent/Guardian signature confirms acceptance of all above terms.`

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

export default function AdminUnder18Form() {
  const { user } = useAuth()
  const [versions, setVersions] = useState([])
  const [current, setCurrent] = useState(null)
  const [draftText, setDraftText] = useState(DEFAULT_CONTENT)
  const [activeTab, setActiveTab] = useState('edit')
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [msg, setMsg] = useState(null)
  const [submissionCount, setSubmissionCount] = useState(null)

  useEffect(() => { loadVersions(); loadStats() }, [])

  async function loadVersions() {
    const { data } = await supabase
      .from('under18_form_versions')
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
    const { count } = await supabase
      .from('under18_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('event_year', ev.year)
    setSubmissionCount(count ?? 0)
  }

  async function saveDraft() {
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('under18_form_versions').insert({
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
    await supabase.from('under18_form_versions').update({ is_published: false }).eq('is_published', true)
    const { error } = await supabase.from('under18_form_versions').insert({
      content: draftText,
      is_published: true,
      created_by: user.id,
      version_note: `Published ${new Date().toLocaleDateString('en-AU')}`,
    })
    setPublishing(false)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'ok', text: 'Published. Players will see the updated form.' }); loadVersions() }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white">Under 18 Consent Form</h1>
        <p className="text-[#e5e5e5]/40 text-sm mt-1">Edit and publish the Under 18 parental consent form</p>
      </div>

      {submissionCount !== null && (
        <div className="bg-surface border border-line rounded-xl px-4 py-3 mb-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-yellow-400/10 flex items-center justify-center flex-shrink-0">
            <span className="text-yellow-400 text-xs font-black">{submissionCount}</span>
          </div>
          <p className="text-[#e5e5e5]/50 text-sm">
            Under 18 consent forms submitted for the current event
          </p>
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
              Currently published: <span className="text-brand">{current.version_note}</span> on {new Date(current.created_at).toLocaleDateString('en-AU')}
            </div>
          )}
          <textarea
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            rows={28}
            className="w-full bg-base border border-line rounded-xl px-4 py-4 text-sm text-[#e5e5e5]/80 font-mono focus:outline-none focus:border-brand transition-colors resize-none"
            placeholder="Write your Under 18 form content…"
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
          <p className="text-xs text-[#e5e5e5]/25 mt-3">
            Note: publishing a new version does not invalidate existing submissions — parents do not need to re-sign.
          </p>
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
                  {new Date(v.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
