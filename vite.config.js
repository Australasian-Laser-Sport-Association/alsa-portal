import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { existsSync, statSync } from 'fs'

// Dev-only plugin: serve api/*.js files as Vercel-style handlers through vite.
// Mirrors Vercel's runtime behaviour: skips _-prefixed segments (api/_lib/),
// decorates req.query, parses JSON bodies, decorates res.status/.json/.send.
function vercelStyleApiPlugin() {
  return {
    name: 'vercel-style-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()
        const [pathOnly, qs = ''] = req.url.split('?')
        const segments = pathOnly.slice(1).split('/')
        if (segments.some(s => s.startsWith('_'))) return next()
        const candidate = resolve(process.cwd(), `${pathOnly.slice(1)}.js`)
        if (!existsSync(candidate) || !statSync(candidate).isFile()) return next()
        try {
          const mod = await server.ssrLoadModule(candidate)
          const handler = mod.default
          if (typeof handler !== 'function') return next()
          req.query = Object.fromEntries(new URLSearchParams(qs))
          if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const raw = Buffer.concat(chunks).toString('utf8')
            try { req.body = raw ? JSON.parse(raw) : undefined } catch { req.body = raw }
          }
          res.status = (code) => { res.statusCode = code; return res }
          res.json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)) }
          res.send = (data) => res.end(typeof data === 'string' ? data : JSON.stringify(data))
          await handler(req, res)
        } catch (err) {
          console.error(`[api] ${req.url}:`, err)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message }))
          }
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Merge ALL env vars (no VITE_ prefix filter) into process.env so api/* handlers
  // can read process.env.RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY, etc. in dev.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), vercelStyleApiPlugin()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    test: {
      environment: 'node',
    },
  }
})
