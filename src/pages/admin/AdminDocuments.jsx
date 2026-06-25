import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ConfirmDialog, InlineAlert, LoadErrorState } from '../../components/Feedback'

// Committee CRUD for the public Resources pages, shared between ALSA
// (/admin/alsa-documents) and ZLTAC (/admin/zltac-documents) via the `scope`
// prop. All reads and writes go through the anon client; the committee RLS
// policies on document_categories / documents gate the writes (same pattern
// as AdminRefereeTest). Routed with a per-scope key so switching pages
// remounts with fresh state.

const EMPTY_DOC = { name: '', url: '', description: '', category_id: '', sort_order: 0 }

const byOrder = (a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)

export default function AdminDocuments({ scope }) {
  const scopeLabel = scope === 'zltac' ? 'ZLTAC' : 'ALSA'
  const publicPath = scope === 'zltac' ? '/zltac/resources' : '/resources'

  const [categories, setCategories] = useState([])
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [catDrafts, setCatDrafts] = useState({})
  const [newCatName, setNewCatName] = useState('')
  const [addingDoc, setAddingDoc] = useState(false)
  const [editingDocId, setEditingDocId] = useState(null)
  const [docForm, setDocForm] = useState(EMPTY_DOC)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Fetch lives inside the effect; writes trigger a refetch by bumping
  // refreshKey via loadAll().
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError('')
      try {
        const [
          { data: cats, error: catsError },
          { data: docs, error: docsError },
        ] = await Promise.all([
          supabase.from('document_categories').select('*').eq('scope', scope),
          supabase.from('documents').select('*').eq('scope', scope),
        ])
        if (catsError) throw catsError
        if (docsError) throw docsError
        if (cancelled) return
        const sortedCats = (cats ?? []).slice().sort(byOrder)
        setCategories(sortedCats)
        setDocuments((docs ?? []).slice().sort(byOrder))
        setCatDrafts(Object.fromEntries(sortedCats.map(c => [c.id, { name: c.name, sort_order: c.sort_order }])))
      } catch (error) {
        if (!cancelled) setLoadError(error.message || 'Could not load documents.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [scope, refreshKey])

  function loadAll() {
    setRefreshKey(k => k + 1)
  }

  // ── Categories ──────────────────────────────────────────────────────────

  async function addCategory() {
    const name = newCatName.trim()
    if (!name) return
    const { error } = await supabase.from('document_categories').insert({ scope, name })
    if (error) setMsg({ type: 'error', text: error.message })
    else { setNewCatName(''); setMsg(null); loadAll() }
  }

  async function saveCategory(id) {
    const draft = catDrafts[id]
    const name = (draft?.name ?? '').trim()
    if (!name) return
    const { error } = await supabase
      .from('document_categories')
      .update({ name, sort_order: parseInt(draft.sort_order) || 0 })
      .eq('id', id)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'ok', text: 'Category saved.' }); loadAll() }
  }

  async function deleteCategory(category) {
    if (!category?.id) return
    setDeleteBusy(true)
    setDeleteError('')
    const { error } = await supabase.from('document_categories').delete().eq('id', category.id)
    setDeleteBusy(false)
    if (error) setDeleteError(error.message)
    else {
      setPendingDelete(null)
      setMsg(null)
      loadAll()
    }
  }

  function setCatDraft(id, field, value) {
    setCatDrafts(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  // ── Documents ───────────────────────────────────────────────────────────

  function startAddDoc() {
    setDocForm(EMPTY_DOC); setEditingDocId(null); setAddingDoc(true); setMsg(null)
  }

  function startEditDoc(d) {
    setDocForm({
      name: d.name,
      url: d.url,
      description: d.description ?? '',
      category_id: d.category_id ?? '',
      sort_order: d.sort_order,
    })
    setEditingDocId(d.id); setAddingDoc(true); setMsg(null)
  }

  async function saveDoc() {
    setSaving(true)
    const payload = {
      scope,
      name: docForm.name.trim(),
      url: docForm.url.trim(),
      description: docForm.description.trim() || null,
      category_id: docForm.category_id || null,
      sort_order: parseInt(docForm.sort_order) || 0,
    }
    let error
    if (editingDocId) { ;({ error } = await supabase.from('documents').update(payload).eq('id', editingDocId)) }
    else              { ;({ error } = await supabase.from('documents').insert(payload)) }
    setSaving(false)
    if (error) setMsg({ type: 'error', text: error.message })
    else {
      setMsg({ type: 'ok', text: editingDocId ? 'Document updated.' : 'Document added.' })
      setAddingDoc(false); setEditingDocId(null); setDocForm(EMPTY_DOC)
      loadAll()
    }
  }

  async function deleteDoc(doc) {
    if (!doc?.id) return
    setDeleteBusy(true)
    setDeleteError('')
    const { error } = await supabase.from('documents').delete().eq('id', doc.id)
    setDeleteBusy(false)
    if (error) setDeleteError(error.message)
    else {
      setPendingDelete(null)
      setMsg(null)
      loadAll()
    }
  }

  function openDeleteConfirm(type, item) {
    setPendingDelete({ type, item })
    setDeleteError('')
  }

  function closeDeleteConfirm() {
    if (deleteBusy) return
    setPendingDelete(null)
    setDeleteError('')
  }

  // Grouped list for display: categories in order, then uncategorised last.
  const knownIds = new Set(categories.map(c => c.id))
  const docGroups = categories
    .map(c => ({ key: c.id, name: c.name, docs: documents.filter(d => d.category_id === c.id) }))
    .filter(g => g.docs.length > 0)
  const uncategorised = documents.filter(d => !d.category_id || !knownIds.has(d.category_id))
  if (uncategorised.length > 0) docGroups.push({ key: 'uncategorised', name: 'Uncategorised', docs: uncategorised })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (loadError) {
    return (
      <LoadErrorState
        title={`Could not load ${scopeLabel} documents.`}
        message={loadError}
        onRetry={loadAll}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">{scopeLabel} Documents</h1>
          <p className="text-[#e5e5e5]/60 text-sm mt-1">
            Manage the links shown on the public {scopeLabel} Resources page ({publicPath})
          </p>
        </div>
        <button onClick={startAddDoc}
          className="bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all">
          + Add Document
        </button>
      </div>

      <InlineAlert className="mb-4" tone={msg?.type === 'ok' ? 'success' : 'error'}>{msg?.text}</InlineAlert>

      {/* Categories */}
      <div className="bg-surface border border-line rounded-xl p-5 mb-6">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Categories</h2>
        {categories.length === 0 ? (
          <p className="text-[#e5e5e5]/60 text-sm mb-4">No categories yet. Documents without a category appear under "Other" on the public page.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {categories.map(c => {
              const draft = catDrafts[c.id] ?? { name: c.name, sort_order: c.sort_order }
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    aria-label={`Category name for ${c.name}`}
                    value={draft.name}
                    onChange={e => setCatDraft(c.id, 'name', e.target.value)}
                    className="flex-1 min-w-[160px] bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                  />
                  <input
                    type="number"
                    aria-label={`Sort order for ${c.name}`}
                    value={draft.sort_order}
                    onChange={e => setCatDraft(c.id, 'sort_order', e.target.value)}
                    className="w-20 bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                  />
                  <button onClick={() => saveCategory(c.id)} disabled={!(draft.name ?? '').trim()}
                    className="text-xs bg-line hover:bg-[#374056] disabled:opacity-50 text-[#e5e5e5]/60 hover:text-white font-semibold px-3 py-2 rounded-lg transition-colors">
                    Save
                  </button>
                  <button onClick={() => openDeleteConfirm('category', c)}
                    className="text-xs text-red-400/70 hover:text-red-400 font-semibold px-2 py-2 transition-colors">
                    Delete
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="New category name"
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            className="flex-1 min-w-[160px] bg-base border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand"
          />
          <button onClick={addCategory} disabled={!newCatName.trim()}
            className="text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-4 py-2 rounded-lg transition-all">
            Add Category
          </button>
        </div>
      </div>

      {/* Add/Edit document form */}
      {addingDoc && (
        <div className="bg-surface border border-brand/20 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-bold text-white mb-4">{editingDocId ? 'Edit Document' : 'Add Document'}</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#e5e5e5]/60 mb-1">Name</label>
                <input type="text" value={docForm.name}
                  onChange={e => setDocForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand" />
              </div>
              <div>
                <label className="block text-xs text-[#e5e5e5]/60 mb-1">URL</label>
                <input type="url" value={docForm.url} placeholder="https://"
                  onChange={e => setDocForm(f => ({ ...f, url: e.target.value }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#e5e5e5]/60 mb-1">Description <span className="text-[#e5e5e5]/40">(optional)</span></label>
              <textarea rows={2} value={docForm.description}
                onChange={e => setDocForm(f => ({ ...f, description: e.target.value }))}
                className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#e5e5e5]/60 mb-1">Category</label>
                <select value={docForm.category_id}
                  onChange={e => setDocForm(f => ({ ...f, category_id: e.target.value }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand">
                  <option value="">Uncategorised</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#e5e5e5]/60 mb-1">Sort order</label>
                <input type="number" value={docForm.sort_order}
                  onChange={e => setDocForm(f => ({ ...f, sort_order: e.target.value }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveDoc} disabled={saving || !docForm.name.trim() || !docForm.url.trim()}
                className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black text-xs font-bold px-4 py-2 rounded-lg transition-all">
                {saving ? 'Saving…' : editingDocId ? 'Save Changes' : 'Add Document'}
              </button>
              <button onClick={() => { setAddingDoc(false); setEditingDocId(null); setDocForm(EMPTY_DOC) }}
                className="border border-line text-[#e5e5e5]/60 hover:text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document list, grouped by category */}
      {docGroups.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl p-8 text-center">
          <p className="text-[#e5e5e5]/60 text-sm">No documents yet. Add one to populate the public {scopeLabel} Resources page.</p>
        </div>
      ) : (
        docGroups.map(g => (
          <div key={g.key} className="mb-6">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/60 mb-2">{g.name}</p>
            <div className="space-y-2">
              {g.docs.map(d => (
                <div key={d.id} className="bg-surface border border-line rounded-xl p-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-bold text-sm">{d.name}</p>
                      <span className="text-[10px] text-[#e5e5e5]/40 font-semibold">sort {d.sort_order}</span>
                    </div>
                    {d.description && <p className="text-[#e5e5e5]/60 text-xs mt-1 leading-snug">{d.description}</p>}
                    <a href={d.url} target="_blank" rel="noopener noreferrer"
                      className="text-brand/70 hover:text-brand text-xs break-all transition-colors">
                      {d.url}
                    </a>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => startEditDoc(d)}
                      className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/60 hover:text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
                      Edit
                    </button>
                    <button onClick={() => openDeleteConfirm('document', d)}
                      className="text-xs text-red-400/70 hover:text-red-400 font-semibold px-2 py-1.5 transition-colors">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete?.type === 'category' ? 'Delete category?' : 'Delete document?'}
        confirmLabel={pendingDelete?.type === 'category' ? 'Delete category' : 'Delete document'}
        busyLabel="Deleting..."
        busy={deleteBusy}
        destructive
        error={deleteError}
        onConfirm={() => {
          if (pendingDelete?.type === 'category') deleteCategory(pendingDelete.item)
          else deleteDoc(pendingDelete?.item)
        }}
        onCancel={closeDeleteConfirm}
      >
        {pendingDelete?.type === 'category' ? (
          <>
            Delete category <span className="text-white font-semibold">{pendingDelete.item.name}</span>? Its documents become uncategorised.
          </>
        ) : (
          <>
            Delete document <span className="text-white font-semibold">{pendingDelete?.item?.name}</span>?
          </>
        )}
      </ConfirmDialog>
    </div>
  )
}
