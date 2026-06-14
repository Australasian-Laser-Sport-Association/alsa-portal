// Public uploads must remain on Supabase's separate storage origin. Rewriting
// user-controlled files through the application origin turns active formats
// into a same-origin script and session-theft risk.
export function maskStorageUrl(url) {
  return url
}
