const INTERNAL_REDIRECT_BASE = 'https://portal.invalid'

export function safeInternalRedirect(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  const hasControlCharacter = [...value].some(character => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
  if (value.includes('\\') || hasControlCharacter || /%5c/i.test(value)) return null

  try {
    const parsed = new URL(value, INTERNAL_REDIRECT_BASE)
    if (parsed.origin !== INTERNAL_REDIRECT_BASE) return null
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}
