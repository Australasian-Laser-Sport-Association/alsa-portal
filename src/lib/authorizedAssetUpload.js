import { apiFetch } from './apiFetch.js'
import { supabase } from './supabase.js'

function validAuthorization(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof value.bucket === 'string'
      && typeof value.path === 'string'
      && typeof value.token === 'string'
      && typeof value.url === 'string'
      && value.url === `/assets/${value.bucket}/${value.path}`,
  )
}

function validFinalization(value, authorization) {
  return Boolean(
    value
      && typeof value === 'object'
      && value.bucket === authorization.bucket
      && value.path === authorization.path
      && value.url === authorization.url,
  )
}

export async function uploadAuthorizedAsset({ endpoint, purpose, scopeId, file }) {
  if (!file || typeof file.type !== 'string' || !Number.isSafeInteger(file.size) || file.size < 1) {
    throw new Error('A non-empty file is required.')
  }

  const request = {
    purpose,
    scopeId: scopeId || undefined,
    contentType: file.type,
    sizeBytes: file.size,
  }
  const authorization = await apiFetch(endpoint, {
    method: 'POST',
    body: JSON.stringify({ action: 'issue', ...request }),
  })
  if (!validAuthorization(authorization)) {
    throw new Error('The upload authorisation response was invalid.')
  }

  const { data, error } = await supabase.storage
    .from(authorization.bucket)
    .uploadToSignedUrl(authorization.path, authorization.token, file, {
      cacheControl: '3600',
      contentType: file.type,
    })
  if (error) throw error
  if (data?.path && data.path !== authorization.path) {
    throw new Error('Storage returned an unexpected upload path.')
  }

  const finalized = await apiFetch(endpoint, {
    method: 'POST',
    body: JSON.stringify({
      action: 'finalize',
      ...request,
      bucket: authorization.bucket,
      path: authorization.path,
    }),
  })
  if (!validFinalization(finalized, authorization)) {
    throw new Error('The uploaded asset could not be verified.')
  }

  return {
    path: finalized.path,
    url: finalized.url,
  }
}
