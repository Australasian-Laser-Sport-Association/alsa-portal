const PUBLIC_PREFIX = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/`;

// Visible-URL aliases - the real bucket name stays unchanged in storage.
const BUCKET_ALIASES = { 'legal-documents': 'documents' };

// Rewrites a Supabase public-object URL to our own domain via the /files proxy.
// No-op in local dev (no Vercel rewrite there) and for any non-matching string.
export function maskStorageUrl(url) {
  if (typeof url !== 'string' || !url) return url;
  if (import.meta.env.DEV) return url;
  if (!url.startsWith(PUBLIC_PREFIX)) return url;
  let path = url.slice(PUBLIC_PREFIX.length);
  const slash = path.indexOf('/');
  if (slash > 0) {
    const bucket = path.slice(0, slash);
    if (BUCKET_ALIASES[bucket]) path = `${BUCKET_ALIASES[bucket]}${path.slice(slash)}`;
  }
  return `/files/${path}`;
}
