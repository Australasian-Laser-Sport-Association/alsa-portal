import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { ShieldAlert, BookOpen } from 'lucide-react'
import RulesTestRunner from '../../components/RulesTestRunner'
import { maskStorageUrl } from '../../lib/assetUrl'
import { RASTER_IMAGE_TYPES, extensionForMime } from '../../lib/uploadPolicy'

const CATEGORIES = ['Rules', 'Safety', 'Equipment', 'Scoring', 'General']
const DIFFICULTIES = ['easy', 'medium', 'hard']
const OPTS = ['a', 'b', 'c', 'd']
// `section` drives pass logic (Safety = 100% required, General = configurable
// threshold). This is distinct from `category`, which is only an
// organisational/filter tag.
const SECTIONS = [
  { value: 'safety', label: 'Safety' },
  { value: 'general', label: 'General' },
]

// Per-question media (referee-test-media bucket, see migration 20260520060002).
const REFEREE_MEDIA_BUCKET = 'referee-test-media'
const IMAGE_TYPES = RASTER_IMAGE_TYPES
const VIDEO_TYPES = ['video/mp4', 'video/webm']
const MEDIA_MAX_BYTES = 25 * 1024 * 1024 // 25 MB
const EXT_BY_MIME = {
  'video/mp4': 'mp4', 'video/webm': 'webm',
}

const EMPTY_Q = {
  question: '', option_a: '', option_b: '', option_c: '', option_d: '',
  correct_answer: 'a', category: 'Rules', difficulty: 'medium', section: 'general',
  image_url: null, video_url: null, active: true,
}

function DifficultyBadge({ d }) {
  const map = { easy: 'text-brand bg-brand/10', medium: 'text-yellow-400 bg-yellow-400/10', hard: 'text-red-400 bg-red-400/10' }
  return <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${map[d] ?? map.medium}`}>{d}</span>
}

// ── Preview Overlay ────────────────────────────────────────
// Thin wrapper around the shared RulesTestRunner so the admin preview can never
// drift from the player experience. The purple "ADMIN PREVIEW" bar is the only
// admin-specific chrome; everything inside is the real component (isPreview).
function PreviewOverlay({ allQuestions, settings, onClose }) {
  const active = (allQuestions ?? []).filter(q => q.active)
  const pool = {
    safety: active.filter(q => q.section === 'safety'),
    general: active.filter(q => q.section !== 'safety'),
  }
  return (
    <div className="fixed inset-0 z-50 bg-[#0F0F0F] overflow-y-auto">
      {/* Preview banner */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-2.5" style={{ backgroundColor: '#7C3AED' }}>
        <span className="text-white text-xs font-black uppercase tracking-widest">
          ⚠ ADMIN PREVIEW — This is how the test appears to players
        </span>
        <button onClick={onClose} className="text-white/70 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors">
          Exit Preview ✕
        </button>
      </div>
      <RulesTestRunner settings={settings} questionPool={pool} isPreview onExit={onClose} />
    </div>
  )
}

// ── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminRefereeTest() {
  const [questions, setQuestions] = useState([])
  const [settings, setSettings]   = useState({ safety_questions_per_test: 10, safety_pass_score: 100, general_questions_per_test: 20, general_pass_score: 70 })
  const [loading, setLoading]     = useState(true)
  const [adding, setAdding]       = useState(false)
  const [editing, setEditing]     = useState(null)
  const [form, setForm]           = useState(EMPTY_Q)
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [videoUploading, setVideoUploading] = useState(false)
  const [mediaErr, setMediaErr]   = useState('')
  const [filterCategory, setFilterCategory]   = useState('all')
  const [filterDifficulty, setFilterDifficulty] = useState('all')
  const [filterSection, setFilterSection]     = useState('all')
  const [search, setSearch]       = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [preview, setPreview]     = useState(false)
  const csvRef = useRef()

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [{ data: qData }, { data: sData }] = await Promise.all([
      supabase.from('referee_questions').select('*').order('created_at', { ascending: false }),
      supabase.from('referee_test_settings').select('*').limit(1).single(),
    ])
    setQuestions(qData ?? [])
    if (sData) setSettings({
      safety_questions_per_test: sData.safety_questions_per_test ?? 10,
      safety_pass_score: sData.safety_pass_score ?? 100,
      general_questions_per_test: sData.general_questions_per_test ?? 20,
      general_pass_score: sData.general_pass_score ?? 70,
    })
    setLoading(false)
  }

  function startAdd()    { setForm(EMPTY_Q); setEditing(null); setMediaErr(''); setAdding(true) }
  function startEdit(q)  { setForm({ ...q }); setEditing(q.id); setMediaErr(''); setAdding(true) }

  // Upload a per-question image or video to the referee-test-media bucket and
  // stash the public URL on the form. Path is organisational only — RLS lets
  // committee write anywhere in the bucket; unsaved questions go under _new/.
  async function uploadMedia(file, kind) {
    const allowed = kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES
    if (!allowed.includes(file.type)) {
      setMediaErr(`Unsupported ${kind} type — use ${kind === 'image' ? 'PNG, JPEG or WebP' : 'MP4 or WebM'}.`)
      return
    }
    if (file.size > MEDIA_MAX_BYTES) {
      setMediaErr(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB — max 25 MB.`)
      return
    }
    const setBusy = kind === 'image' ? setImageUploading : setVideoUploading
    const field = kind === 'image' ? 'image_url' : 'video_url'
    setBusy(true); setMediaErr('')
    try {
      const ext = extensionForMime(file.type) || EXT_BY_MIME[file.type]
      const path = `questions/${editing || '_new'}/${Date.now()}.${ext}`
      const { data, error } = await supabase.storage
        .from(REFEREE_MEDIA_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type })
      if (error) throw error
      const { data: urlData } = supabase.storage.from(REFEREE_MEDIA_BUCKET).getPublicUrl(data.path)
      setForm(f => ({ ...f, [field]: urlData.publicUrl }))
    } catch (err) {
      setMediaErr(err?.message || 'Upload failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    setSaving(true); setMsg(null)
    const payload = { ...form }; delete payload.id
    // Normalise empty media to NULL rather than '' so text-only questions stay clean.
    payload.image_url = payload.image_url || null
    payload.video_url = payload.video_url || null
    let err
    if (editing) { ;({ error: err } = await supabase.from('referee_questions').update(payload).eq('id', editing)) }
    else         { ;({ error: err } = await supabase.from('referee_questions').insert(payload)) }
    setSaving(false)
    if (err) setMsg({ type: 'error', text: err.message })
    else { setMsg({ type: 'ok', text: editing ? 'Updated.' : 'Question added.' }); loadAll(); setTimeout(() => { setAdding(false); setMsg(null) }, 800) }
  }

  async function deleteQ(id) {
    if (!window.confirm('Delete this question?')) return
    await supabase.from('referee_questions').delete().eq('id', id)
    setQuestions(qs => qs.filter(q => q.id !== id))
  }

  async function toggleActive(q) {
    await supabase.from('referee_questions').update({ active: !q.active }).eq('id', q.id)
    setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, active: !x.active } : x))
  }

  async function saveSettings() {
    setSavingSettings(true)
    await supabase.from('referee_test_settings').upsert({
      id: 1,
      safety_questions_per_test: parseInt(settings.safety_questions_per_test) || 0,
      safety_pass_score: parseInt(settings.safety_pass_score) || 0,
      general_questions_per_test: parseInt(settings.general_questions_per_test) || 0,
      general_pass_score: parseInt(settings.general_pass_score) || 0,
    })
    setSavingSettings(false)
  }

  function handleCSVImport(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const lines = ev.target.result.split('\n').filter(l => l.trim())
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
      const rows = lines.slice(1).map(line => {
        const vals = line.split(',')
        return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim().replace(/^"|"$/g, '')]))
      })
      await supabase.from('referee_questions').insert(rows.map(r => ({
        question: r.question, option_a: r.option_a ?? r.a, option_b: r.option_b ?? r.b,
        option_c: r.option_c ?? r.c, option_d: r.option_d ?? r.d,
        correct_answer: r.correct_answer ?? r.answer ?? 'a',
        category: r.category ?? 'General', difficulty: r.difficulty ?? 'medium',
        section: r.section === 'safety' ? 'safety' : 'general', active: true,
      })))
      loadAll()
    }
    reader.readAsText(file); e.target.value = ''
  }

  const filtered = questions.filter(q => {
    if (filterSection !== 'all' && (q.section ?? 'general') !== filterSection) return false
    if (filterCategory !== 'all' && q.category !== filterCategory) return false
    if (filterDifficulty !== 'all' && q.difficulty !== filterDifficulty) return false
    if (search && !q.question.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const activeCount = questions.filter(q => q.active).length
  const safetyCount = questions.filter(q => (q.section ?? 'general') === 'safety').length
  const generalCount = questions.length - safetyCount
  const activeSafetyCount = questions.filter(q => q.active && (q.section ?? 'general') === 'safety').length
  const activeGeneralCount = questions.filter(q => q.active && (q.section ?? 'general') !== 'safety').length
  const safetyShort = activeSafetyCount < (parseInt(settings.safety_questions_per_test) || 0)
  const generalShort = activeGeneralCount < (parseInt(settings.general_questions_per_test) || 0)

  return (
    <>
      {preview && (
        <PreviewOverlay
          allQuestions={questions}
          settings={settings}
          onClose={() => setPreview(false)}
        />
      )}

      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black text-white">Rules Test</h1>
            <p className="text-[#e5e5e5]/60 text-sm mt-1">Manage questions and test settings</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreview(true)}
              className="text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
              style={{ backgroundColor: '#7C3AED' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              Preview Test
            </button>
            <input ref={csvRef} type="file" accept=".csv" onChange={handleCSVImport} className="hidden" />
            <button onClick={() => csvRef.current.click()}
              className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-lg transition-colors">
              Import CSV
            </button>
            <button onClick={startAdd}
              className="bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all">
              + Add Question
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Questions', value: questions.length },
            { label: 'By Section', value: `${safetyCount} safety / ${generalCount} general` },
            { label: 'Active Questions', value: activeCount },
            { label: 'Pass Rates', value: `Safety ${settings.safety_pass_score}% / General ${settings.general_pass_score}%` },
          ].map(s => (
            <div key={s.label} className="bg-surface border border-line rounded-xl p-4">
              <p className="text-xs text-[#e5e5e5]/60 uppercase tracking-wider font-bold mb-1">{s.label}</p>
              <p className="text-2xl font-black text-brand">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Low question warning — per section. A section with fewer active
            questions than its sample size will just use all available. */}
        {!loading && (safetyShort || generalShort) && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 mb-6">
            <p className="text-yellow-400 text-sm font-semibold">
              ⚠ Warning:{' '}
              {safetyShort && `Safety has ${activeSafetyCount} active question${activeSafetyCount !== 1 ? 's' : ''} but is set to show ${settings.safety_questions_per_test}.`}
              {safetyShort && generalShort && ' '}
              {generalShort && `General has ${activeGeneralCount} active question${activeGeneralCount !== 1 ? 's' : ''} but is set to show ${settings.general_questions_per_test}.`}
              {' '}Add more questions or reduce the per-test count.
            </p>
          </div>
        )}

        {/* Test settings — two per-section blocks */}
        <div className="bg-surface border border-line rounded-xl p-5 mb-6">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Test Settings</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Safety block (yellow accent) */}
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <ShieldAlert className="h-4 w-4 text-yellow-300 flex-shrink-0" />
                <h3 className="text-sm font-bold text-yellow-300">Safety Section Settings</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#e5e5e5]/60 mb-1">Questions per test</label>
                  <input type="number" min={1} value={settings.safety_questions_per_test}
                    onChange={e => setSettings(s => ({ ...s, safety_questions_per_test: e.target.value }))}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500/60" />
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/60 mb-1">Pass rate (%)</label>
                  <input type="number" min={1} max={100} value={settings.safety_pass_score}
                    onChange={e => setSettings(s => ({ ...s, safety_pass_score: e.target.value }))}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500/60" />
                </div>
              </div>
              <p className="text-[10px] text-[#e5e5e5]/60 mt-2">Recommended 100% for safety knowledge</p>
            </div>

            {/* General block (green / brand accent) */}
            <div className="rounded-xl border border-brand/30 bg-brand/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="h-4 w-4 text-brand flex-shrink-0" />
                <h3 className="text-sm font-bold text-brand">General Rules Section Settings</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#e5e5e5]/60 mb-1">Questions per test</label>
                  <input type="number" min={1} value={settings.general_questions_per_test}
                    onChange={e => setSettings(s => ({ ...s, general_questions_per_test: e.target.value }))}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand" />
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/60 mb-1">Pass rate (%)</label>
                  <input type="number" min={1} max={100} value={settings.general_pass_score}
                    onChange={e => setSettings(s => ({ ...s, general_pass_score: e.target.value }))}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand" />
                </div>
              </div>
              <p className="text-[10px] text-[#e5e5e5]/60 mt-2">Typical range 60-80%</p>
            </div>
          </div>

          <button onClick={saveSettings} disabled={savingSettings}
            className="mt-4 text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl transition-all">
            {savingSettings ? 'Saving…' : 'Save Settings'}
          </button>
        </div>

        {/* Add/Edit form */}
        {adding && (
          <div className="bg-surface border border-brand/20 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-bold text-white mb-4">{editing ? 'Edit Question' : 'Add Question'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-[#e5e5e5]/60 mb-1">Question</label>
                <textarea rows={3} value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {OPTS.map(opt => (
                  <div key={opt}>
                    <label className="block text-xs text-[#e5e5e5]/60 mb-1">Option {opt.toUpperCase()}</label>
                    <input type="text" value={form[`option_${opt}`]}
                      onChange={e => setForm(f => ({ ...f, [`option_${opt}`]: e.target.value }))}
                      className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand" />
                  </div>
                ))}
              </div>
              <div className="bg-base/50 border border-line rounded-lg p-3">
                <label className="block text-xs font-bold text-white mb-1">
                  Test Section <span className="text-[#e5e5e5]/60 font-normal">— determines pass logic</span>
                </label>
                <select value={form.section ?? 'general'} onChange={e => setForm(f => ({ ...f, section: e.target.value }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand">
                  {SECTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <p className="text-[10px] text-[#e5e5e5]/60 mt-1.5">
                  <span className="text-yellow-300/80">Safety</span> → must be answered 100% correctly to pass.
                  <span className="text-[#e5e5e5]/60"> General</span> → counts toward the configurable pass score.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[#e5e5e5]/60 mb-1">Correct Answer</label>
                  <select value={form.correct_answer} onChange={e => setForm(f => ({ ...f, correct_answer: e.target.value }))}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand">
                    {OPTS.map(o => <option key={o} value={o}>{o.toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/60 mb-1">Category <span className="text-[#e5e5e5]/60">(tag)</span></label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/60 mb-1">Difficulty</label>
                  <select value={form.difficulty} onChange={e => setForm(f => ({ ...f, difficulty: e.target.value }))}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand">
                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              {/* Media (optional) — image and/or video, both independent */}
              <div>
                <label className="block text-xs text-[#e5e5e5]/60 mb-2">Media <span className="text-[#e5e5e5]/60">(optional — image and/or video)</span></label>
                <div className="grid grid-cols-2 gap-3">
                  {/* Image */}
                  <div className="bg-base border border-line rounded-lg p-3">
                    <p className="text-xs font-bold text-white mb-2">Image</p>
                    {form.image_url && (
                      <div className="mb-2">
                        <div className="h-40 w-full rounded border border-line bg-[#1a1a1a] overflow-hidden">
                          <img src={maskStorageUrl(form.image_url)} alt="" className="w-full h-full object-contain" />
                        </div>
                        <button type="button" onClick={() => setForm(f => ({ ...f, image_url: null }))}
                          className="mt-1 text-[11px] text-red-400/70 hover:text-red-400 transition-colors">Remove image</button>
                      </div>
                    )}
                    <input type="file" accept="image/png,image/jpeg,image/webp" disabled={imageUploading}
                      onChange={e => { const fl = e.target.files?.[0]; if (fl) uploadMedia(fl, 'image'); e.target.value = '' }}
                      className="block w-full text-xs text-[#e5e5e5]/60 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-line file:text-[#e5e5e5]/70 file:text-xs hover:file:bg-[#374056] disabled:opacity-50" />
                    {imageUploading && <p className="text-brand text-[11px] mt-1">Uploading image…</p>}
                    <p className="text-[10px] text-[#e5e5e5]/60 mt-1">PNG, JPEG or WebP · max 25 MB</p>
                  </div>
                  {/* Video */}
                  <div className="bg-base border border-line rounded-lg p-3">
                    <p className="text-xs font-bold text-white mb-2">Video</p>
                    {form.video_url && (
                      <div className="mb-2">
                        <video src={maskStorageUrl(form.video_url)} controls className="w-full max-h-40 rounded border border-line bg-[#1a1a1a]" />
                        <button type="button" onClick={() => setForm(f => ({ ...f, video_url: null }))}
                          className="mt-1 text-[11px] text-red-400/70 hover:text-red-400 transition-colors">Remove video</button>
                      </div>
                    )}
                    <input type="file" accept="video/mp4,video/webm" disabled={videoUploading}
                      onChange={e => { const fl = e.target.files?.[0]; if (fl) uploadMedia(fl, 'video'); e.target.value = '' }}
                      className="block w-full text-xs text-[#e5e5e5]/60 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-line file:text-[#e5e5e5]/70 file:text-xs hover:file:bg-[#374056] disabled:opacity-50" />
                    {videoUploading && <p className="text-brand text-[11px] mt-1">Uploading video…</p>}
                    <p className="text-[10px] text-[#e5e5e5]/60 mt-1">MP4 or WebM · max 25 MB · no autoplay for players</p>
                  </div>
                </div>
                {mediaErr && <p className="text-red-400 text-xs mt-2">{mediaErr}</p>}
              </div>

              <div className="flex items-center gap-3">
                <button onClick={handleSave} disabled={saving || imageUploading || videoUploading || !form.question.trim()}
                  className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-all">
                  {saving ? 'Saving…' : editing ? 'Update' : 'Add Question'}
                </button>
                <button onClick={() => { setAdding(false); setMsg(null) }}
                  className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
                  Cancel
                </button>
                {msg && <span className={`text-sm ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</span>}
              </div>
            </div>
          </div>
        )}

        {/* Section tabs (with counts) */}
        <div className="flex items-center gap-2 mb-4">
          {[
            { key: 'all', label: `All (${questions.length})` },
            { key: 'safety', label: `Safety (${safetyCount})` },
            { key: 'general', label: `General (${generalCount})` },
          ].map(t => (
            <button key={t.key} onClick={() => setFilterSection(t.key)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${filterSection === t.key ? 'bg-brand text-black' : 'bg-line text-[#e5e5e5]/60 hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <input type="text" placeholder="Search questions…" value={search} onChange={e => setSearch(e.target.value)}
            className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand w-48" />
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand">
            <option value="all">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterDifficulty} onChange={e => setFilterDifficulty(e.target.value)}
            className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand">
            <option value="all">All difficulties</option>
            {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Questions table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-surface border border-line rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {['Question', 'Section', 'Category', 'Difficulty', 'Answer', 'Active', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-[#e5e5e5]/60 text-sm">No questions found</td></tr>
                ) : filtered.map(q => (
                  <tr key={q.id} className="border-b border-line last:border-0 hover:bg-line/30 transition-colors">
                    <td className="px-4 py-3 text-[#e5e5e5]/80 max-w-xs"><span className="line-clamp-2">{q.question}</span></td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${(q.section ?? 'general') === 'safety' ? 'bg-yellow-500/15 text-yellow-300' : 'bg-line text-[#e5e5e5]/60'}`}>
                        {(q.section ?? 'general') === 'safety' ? 'Safety' : 'General'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#e5e5e5]/60 text-xs">{q.category}</td>
                    <td className="px-4 py-3"><DifficultyBadge d={q.difficulty} /></td>
                    <td className="px-4 py-3 text-brand font-bold text-xs">{(q.correct_answer ?? '').toUpperCase()}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleActive(q)}
                        className={`w-9 h-5 rounded-full transition-colors relative ${q.active ? 'bg-brand' : 'bg-line'}`}>
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${q.active ? 'translate-x-4' : ''}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => startEdit(q)} className="text-xs text-[#e5e5e5]/60 hover:text-brand transition-colors">Edit</button>
                        <button onClick={() => deleteQ(q.id)} className="text-xs text-[#e5e5e5]/60 hover:text-red-400 transition-colors">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
