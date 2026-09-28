import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// TEMPORARY NPI demo: in `vite` dev, serve api/npi-*.ts (Web Request→Response
// handlers) so /npi-list works without `vercel dev`. Production uses Vercel's
// own api/ functions; this plugin only runs in the dev server.
function npiDevApi(): Plugin {
  return {
    name: 'npi-dev-api',
    apply: 'serve',
    configureServer(server) {
      // Server-only secrets for the api/ handlers (e.g. SRFAX_*) from .env.local — never VITE_-prefixed, never bundled.
      for (const [k, v] of Object.entries(loadEnv(server.config.mode, server.config.root, ['SRFAX_', 'OPENAI_', 'NPI_', 'BRAVE_']))) process.env[k] ??= v
      server.middlewares.use(async (req, res, next) => {
        // Mirror vercel.json's /npi-list rewrite.
        if (req.url && /^\/npi-list(\/(referral-demo|opportunity|fax-settings|pms|embed\/provider-intelligence|experiment|shared-knowledge))?\/?(\?|#|$)/.test(req.url)) req.url = req.url.replace(/^\/npi-list(\/(referral-demo|opportunity|fax-settings|pms|embed\/provider-intelligence|experiment|shared-knowledge))?\/?/, '/npi-list/index.html')
        const m = req.url?.match(/^\/api\/(npi-(?:search|provider|nearby|research|fax|discover))(\?.*)?$/)
        if (!m) return next()
        try {
          const mod = await server.ssrLoadModule(`/api/${m[1]}.ts`)
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
          const body = req.method === 'POST' ? Buffer.concat(chunks) : undefined
          const response: Response = await mod.default(new Request(`http://localhost${req.url}`, { method: req.method, headers, body }))
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          if (!response.body) return res.end()
          const reader = response.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            res.write(value)
          }
          res.end()
        } catch (err) {
          next(err)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), npiDevApi()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        npi: resolve(import.meta.dirname, 'npi-list/index.html'),
      },
    },
  },
})
