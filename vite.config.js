import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { existsSync, statSync, readdirSync } from 'fs'

// Resolve a request path to an api/ handler the way Vercel's file-system router
// does: prefer an exact file, then fall back to a [param] segment at the same
// depth. Without the dynamic fallback, routes backed by files such as
// api/superadmin/[resource].js never match in dev and silently fall through to
// the SPA, so every call returns index.html with a 200 and local testing of
// those features is impossible.
function resolveApiHandler(segments) {
  const exact = resolve(process.cwd(), `${segments.join('/')}.js`)
  if (existsSync(exact) && statSync(exact).isFile()) return { file: exact, params: {} }

  const params = {}
  const parts = []
  for (let depth = 0; depth < segments.length; depth += 1) {
    const segment = segments[depth]
    const literal = resolve(process.cwd(), [...parts, segment].join('/'))
    const isLastSegment = depth === segments.length - 1
    if (!isLastSegment && existsSync(literal) && statSync(literal).isDirectory()) {
      parts.push(segment)
      continue
    }
    // Look for a [param].js (leaf) or [param] directory at this depth.
    const parentDir = resolve(process.cwd(), parts.join('/'))
    if (!existsSync(parentDir) || !statSync(parentDir).isDirectory()) return null
    const dynamic = readdirSync(parentDir).find(entry => (
      isLastSegment
        ? /^\[[^\]]+\]\.js$/.test(entry)
        : /^\[[^\]]+\]$/.test(entry) && statSync(resolve(parentDir, entry)).isDirectory()
    ))
    if (!dynamic) return null
    // "[resource].js" -> "resource"; "[slug]" -> "slug"
    const name = dynamic.replace(/\.js$/, '').slice(1, -1)
    params[name] = segment
    if (isLastSegment) return { file: resolve(parentDir, dynamic), params }
    parts.push(dynamic)
  }
  return null
}

// Dev-only plugin: serve api/*.js files as Vercel-style handlers through vite.
// Mirrors Vercel's runtime behaviour: skips _-prefixed segments (api/_lib/),
// resolves [param] segments, decorates req.query, parses JSON bodies, and
// decorates res.status/.json/.send.
function vercelStyleApiPlugin() {
  return {
    name: 'vercel-style-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()
        const [pathOnly, qs = ''] = req.url.split('?')
        const segments = pathOnly.slice(1).split('/')
        if (segments.some(s => s.startsWith('_'))) return next()
        const resolved = resolveApiHandler(segments)
        if (!resolved) return next()
        const { file: candidate, params } = resolved
        try {
          const mod = await server.ssrLoadModule(candidate)
          const handler = mod.default
          if (typeof handler !== 'function') return next()
          // Dynamic segment values are part of req.query on Vercel, and lose to
          // a real query-string key of the same name.
          req.query = { ...params, ...Object.fromEntries(new URLSearchParams(qs)) }
          if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const raw = Buffer.concat(chunks)
            const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
            if (contentType === 'application/json') {
              const text = raw.toString('utf8')
              try { req.body = text ? JSON.parse(text) : undefined } catch { req.body = text }
            } else {
              // Mirror Vercel's binary request handling for server-validated
              // uploads. Converting arbitrary PDF bytes to UTF-8 corrupts them.
              req.body = raw.length > 0 ? raw : undefined
            }
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
  const sentryUploadEnabled = process.env.SENTRY_UPLOAD_SOURCEMAPS === 'true'
    && !!process.env.SENTRY_AUTH_TOKEN
    && process.env.SENTRY_DISABLE_UPLOAD !== 'true'
  return {
    plugins: [
      react(),
      vercelStyleApiPlugin(),
      sentryUploadEnabled && sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: "australasian-laser-sport-assoc",
        project: "alsa-portal",
        sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
      }),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    build: {
      sourcemap: sentryUploadEnabled,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (id.includes('react') || id.includes('react-router-dom')) return 'vendor-react'
            if (id.includes('@supabase')) return 'vendor-supabase'
            if (id.includes('@sentry')) return 'vendor-sentry'
            if (id.includes('lucide-react')) return 'vendor-icons'
            return 'vendor'
          },
        },
      },
    },
    test: {
      environment: 'node',
      pool: 'forks',
      include: [
        'src/**/*.test.{js,jsx,ts,tsx}',
        'api/**/*.test.{js,jsx,ts,tsx}',
      ],
    },
  }
})
