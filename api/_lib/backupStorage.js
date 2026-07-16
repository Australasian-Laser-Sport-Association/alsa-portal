import { createHash } from 'crypto'

const BACKUP_BUCKET = 'portal-backups'

function validObjectPaths(objectPaths) {
  return Array.isArray(objectPaths)
    ? objectPaths.filter(path => typeof path === 'string' && path.length > 0)
    : []
}

export function buildBackupFiles(csvs, createdAt = new Date().toISOString()) {
  const files = [
    { name: 'registrations.csv', content: csvs.registrationsCsv, contentType: 'text/csv' },
    { name: 'payments.csv', content: csvs.paymentsCsv, contentType: 'text/csv' },
    { name: 'events.csv', content: csvs.eventsCsv, contentType: 'text/csv' },
    {
      name: 'admin-asset-upload-audit.csv',
      content: csvs.assetUploadAuditCsv,
      contentType: 'text/csv',
    },
  ]
  const sha256 = content => createHash('sha256').update(content, 'utf8').digest('hex')
  const manifest = {
    version: 2,
    createdAt,
    timezone: 'Australia/Sydney',
    counts: {
      registrations: csvs.registrationsCount,
      payments: csvs.paymentsCount,
      events: csvs.eventsCount,
      adminAssetUploadAudit: csvs.assetUploadAuditCount,
    },
    files: files.map(file => ({ name: file.name, sha256: sha256(file.content) })),
  }

  return {
    manifest,
    files: [...files, {
      name: 'manifest.json',
      content: JSON.stringify(manifest, null, 2),
      contentType: 'application/json',
    }],
  }
}

export async function removeBackupObjects(supabase, objectPaths) {
  const paths = validObjectPaths(objectPaths)
  if (paths.length === 0) return { error: null, removed: true }

  try {
    const { error } = await supabase.storage.from(BACKUP_BUCKET).remove(paths)
    return { error: error ?? null, removed: !error }
  } catch (error) {
    return { error, removed: false }
  }
}

// Failed backup rows retain object paths whenever deletion could not be
// confirmed. A later run retries those removals and only clears the database
// evidence after storage confirms success.
export async function reconcileFailedBackupObjects(supabase, {
  limit = 100,
  onError = () => {},
} = {}) {
  let failedRuns
  let queryError
  try {
    const result = await supabase
      .from('backup_runs')
      .select('id, object_paths')
      .eq('status', 'failed')
      .not('object_paths', 'eq', '{}')
      .limit(limit)
    failedRuns = result.data
    queryError = result.error
  } catch (error) {
    queryError = error
  }

  if (queryError) {
    onError(queryError, 'query', null)
    return { cleaned: 0, pending: 0, error: queryError }
  }

  let cleaned = 0
  let pending = 0
  for (const run of failedRuns ?? []) {
    const paths = validObjectPaths(run.object_paths)
    if (paths.length === 0) continue

    const removal = await removeBackupObjects(supabase, paths)
    if (removal.error) {
      pending += 1
      onError(removal.error, 'remove', run.id)
      continue
    }

    let clearError
    try {
      const result = await supabase
        .from('backup_runs')
        .update({ object_paths: [] })
        .eq('id', run.id)
        .eq('status', 'failed')
      clearError = result.error
    } catch (error) {
      clearError = error
    }
    if (clearError) {
      pending += 1
      onError(clearError, 'clear', run.id)
      continue
    }
    cleaned += 1
  }

  return { cleaned, pending, error: null }
}
