// Tiny no-dependency server: serves public/ and proxies Sarvam so the key stays server-side.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { routes } from './lib/api.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
loadEnv(path.join(DIR, '.env'))
const PORT = Number(process.env.PORT || 8787)
if (!process.env.SARVAM_API_KEY) console.warn('SARVAM_API_KEY missing: put it in .env')

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'POST' && routes[url.pathname]) {
    let body = ''
    for await (const c of req) body += c
    try {
      const out = await routes[url.pathname](JSON.parse(body || '{}'))
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out))
    } catch (e) {
      console.error(url.pathname, e)
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: e.message }))
    }
    return
  }
  const file = path.join(DIR, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname))
  if (!file.startsWith(path.join(DIR, 'public')) || !fs.existsSync(file)) return res.writeHead(404).end('not found')
  res.writeHead(200, { 'Content-Type': (MIME[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' })
  fs.createReadStream(file).pipe(res)
}).listen(PORT, () => console.log(`Braille Runner on http://localhost:${PORT}`))
