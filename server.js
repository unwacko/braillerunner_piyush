// Tiny no-dependency server: serves public/ and proxies Sarvam so the key stays server-side.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
loadEnv(path.join(DIR, '.env'))
const KEY = process.env.SARVAM_API_KEY
const PORT = Number(process.env.PORT || 8787)
const API = 'https://api.sarvam.ai'
if (!KEY) console.warn('SARVAM_API_KEY missing: put it in .env')

const LANGS = {
  'en-IN': 'English', 'hi-IN': 'Hindi', 'bn-IN': 'Bengali', 'ta-IN': 'Tamil', 'te-IN': 'Telugu',
  'kn-IN': 'Kannada', 'ml-IN': 'Malayalam', 'mr-IN': 'Marathi', 'gu-IN': 'Gujarati',
  'pa-IN': 'Punjabi', 'od-IN': 'Odia',
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

async function sarvam(p, body) {
  const r = await fetch(API + p, {
    method: 'POST',
    headers: { 'api-subscription-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`${p}: ${j?.error?.message || r.status}`)
  return j
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Sarvam Vision (Document AI parse): submit image, poll, download ZIP, return the markdown.
async function visionParse(dataUrl) {
  const [, mime, b64] = dataUrl.match(/^data:(.+?);base64,(.*)$/)
  const ext = mime.split('/')[1].replace('jpeg', 'jpg')
  const form = new FormData()
  form.append('file', new Blob([Buffer.from(b64, 'base64')], { type: mime }), `page.${ext}`)
  form.append('language', 'en-IN')
  form.append('output_format', 'md')
  const h = { 'api-subscription-key': KEY }
  let r = await fetch(`${API}/doc-ai/v1/job/parse`, { method: 'POST', headers: h, body: form })
  const job = await r.json()
  if (!job.job_id) throw new Error('vision: ' + JSON.stringify(job))
  for (let i = 0; i < 40; i++) {
    await sleep(1500)
    const st = await (await fetch(`${API}/doc-ai/v1/job/${job.job_id}/status`, { headers: h })).json()
    const s = String(st.status).toLowerCase()
    if (s === 'completed' || s === 'partially_completed') break
    if (s === 'failed' || s === 'rejected') throw new Error('vision job ' + s)
  }
  const dl = await (await fetch(`${API}/doc-ai/v1/job/${job.job_id}/download-url`, { headers: h })).json()
  const zip = Buffer.from(await (await fetch(dl.url)).arrayBuffer())
  const md = unzip(zip).find((f) => f.name.endsWith('.md'))
  return md ? md.data.toString('utf8') : ''
}

// Minimal ZIP reader (central directory + stored/deflate entries).
function unzip(buf) {
  let eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const n = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = []
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nl)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + csize)
    out.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : raw })
    p += 46 + nl + el + cl
  }
  return out
}

// Decide whether the dots are English braille or Bharati braille, and which language.
async function identify({ eng, dev }) {
  const prompt = `A braille page was read cell-by-cell. The same cells were decoded two ways:
A (English Grade 1 braille): "${eng}"
B (Bharati braille, shown in Devanagari; Bharati cells are shared by all Indian scripts, so B may be Hindi, Marathi, Tamil, Bengali, etc. written phonetically): "${dev}"
Which reading is meaningful text? If B, which Indian language is it?
Reply with only JSON like {"choice":"A","language":"en-IN"} or {"choice":"B","language":"hi-IN"}.`
  // Cells that have no meaning in one code are strong evidence for the other.
  const bad = (s) => (s.match(/\?/g) || []).length
  let choice = bad(eng) < bad(dev) ? 'A' : 'B', language = choice === 'A' ? 'en-IN' : 'hi-IN'
  try {
    const r = await sarvam('/v1/chat/completions', {
      model: 'sarvam-105b', reasoning_effort: 'low', max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })
    const msg = r.choices[0].message
    const j = JSON.parse((msg.content || msg.reasoning_content || '').match(/\{[^}]*"choice"[^}]*\}/)[0])
    if (bad(eng) === bad(dev)) choice = j.choice === 'B' ? 'B' : 'A'
    language = choice === 'A' ? 'en-IN' : (LANGS[j.language] && j.language !== 'en-IN' ? j.language : 'hi-IN')
  } catch (e) { console.warn('identify chat failed:', e.message) }
  // Sarvam language-ID as a second opinion on the chosen reading.
  let lid = null
  try { lid = await sarvam('/text-lid', { input: choice === 'A' ? eng : dev }) } catch {}
  if (choice === 'B' && lid?.script_code === 'Deva' && LANGS[lid.language_code]) language = lid.language_code
  return { choice, language, lid: lid?.language_code || null }
}

async function translateAll({ text, source }) {
  const targets = Object.keys(LANGS).filter((l) => l !== source)
  const results = await Promise.all(targets.map(async (target) => {
    try {
      const r = await sarvam('/translate', {
        input: text, source_language_code: source, target_language_code: target, model: 'sarvam-translate:v1',
      })
      return { lang: target, name: LANGS[target], text: r.translated_text }
    } catch (e) { return { lang: target, name: LANGS[target], error: e.message } }
  }))
  return { results }
}

async function lid({ text }) {
  const r = await sarvam('/text-lid', { input: text })
  return { language: LANGS[r.language_code] ? r.language_code : 'en-IN', script: r.script_code }
}

const routes = {
  '/api/ocr': async (b) => ({ markdown: await visionParse(b.image) }),
  '/api/identify': identify,
  '/api/translate': translateAll,
  '/api/lid': lid,
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
}).listen(PORT, () => console.log(`Braille Bridge on http://localhost:${PORT}`))
