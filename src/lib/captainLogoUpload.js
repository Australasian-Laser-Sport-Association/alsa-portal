import { apiFetch } from './apiFetch.js'

const BASE64_CHUNK_BYTES = 0x8000

export async function encodeFileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}

export async function uploadCaptainLogo({ file, eventId, teamId }) {
  const dataBase64 = await encodeFileBase64(file)
  const result = await apiFetch('/api/captain', {
    method: 'POST',
    body: JSON.stringify({
      action: 'upload-team-logo',
      eventId,
      teamId,
      contentType: file.type,
      sizeBytes: file.size,
      dataBase64,
    }),
  })
  return result
}
