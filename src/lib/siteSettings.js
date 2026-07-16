import { createContext } from 'react'
import { supabase } from './supabase'
import { apiFetch } from './apiFetch.js'

// Site-wide "testing mode" flag, stored as one row in cms_global
// (key 'site_banner', value { enabled, message }). Reads are anon (public
// SELECT policy); writes use the actor-checked committee API.

const BANNER_KEY = 'site_banner'

const BANNER_DEFAULTS = {
  enabled: false,
  message: 'This site is in testing mode. All information, dates, and payment figures shown are placeholders and should be treated as fictitious.',
}

// App-level share point: App fetches the flag once on mount and provides
// { banner, setBanner } so SiteBanner, the homepage modal, and the AdminHub
// card all reuse the same fetch.
export const SiteBannerContext = createContext({
  banner: BANNER_DEFAULTS,
  setBanner: () => {},
})

export async function getSiteBanner() {
  const { data, error } = await supabase
    .from('cms_global')
    .select('value')
    .eq('key', BANNER_KEY)
    .maybeSingle()
  if (error || !data?.value) return { ...BANNER_DEFAULTS }
  return {
    enabled: data.value.enabled === true,
    message: typeof data.value.message === 'string' && data.value.message.trim()
      ? data.value.message
      : BANNER_DEFAULTS.message,
  }
}

export async function setSiteBanner({ enabled, message }) {
  try {
    await apiFetch('/api/admin/event?resource=site-banner', {
      method: 'POST',
      body: JSON.stringify({
        entity: 'banner',
        data: { enabled: enabled === true, message },
      }),
    })
    return { error: null }
  } catch (error) {
    return { error }
  }
}
