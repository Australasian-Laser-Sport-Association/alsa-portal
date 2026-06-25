import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import * as Sentry from "@sentry/react";
import RootErrorFallback from './components/RootErrorFallback.jsx'

const STALE_CHUNK_RELOAD_KEY = 'alsa:stale-chunk-reload'
const STALE_CHUNK_RELOAD_COOLDOWN_MS = 60_000

function reloadOnceForStaleChunk() {
  const lastReloadAt = Number(sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) ?? 0)
  if (Date.now() - lastReloadAt < STALE_CHUNK_RELOAD_COOLDOWN_MS) return false
  sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()))
  window.location.reload()
  return true
}

window.addEventListener('vite:preloadError', event => {
  if (reloadOnceForStaleChunk()) event.preventDefault()
})

window.addEventListener('unhandledrejection', event => {
  const message = String(event.reason?.message ?? event.reason ?? '')
  if (
    message.includes('Failed to fetch dynamically imported module')
    || message.includes('Importing a module script failed')
  ) {
    if (reloadOnceForStaleChunk()) event.preventDefault()
  }
})

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
  environment: import.meta.env.MODE,
  sendDefaultPii: false,
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={RootErrorFallback}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
