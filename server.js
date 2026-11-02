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

const CODES = Object.keys(LANGS).join(', ')
const PROB_RULES = `Give a probability for each candidate language (${CODES}). Many words are shared between languages (for example Hindi and Marathi share lots of vocabulary), so spread probability when the words fit several languages; probabilities sum to 1. Judge by vocabulary and grammar; personal and place names say nothing about the language.`

async function askJson(prompt) {
  const r = await sarvam('/v1/chat/completions', {
    // reasoning off: with it on, the model spends the whole budget thinking and returns no JSON.
    model: 'sarvam-105b', reasoning_effort: null, max_tokens: 800, temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  })
  const msg = r.choices[0].message
  const raw = (msg.content || msg.reasoning_content || '').match(/\{[\s\S]*\}/)[0]
  return JSON.parse(raw)
}

// Keep known codes, drop noise, renormalise. Falls back to a single label.
function cleanProbs(probs, fallback, allowed = Object.keys(LANGS)) {
  const out = {}
  for (const [k, v] of Object.entries(probs || {})) if (allowed.includes(k) && +v > 0.005) out[k] = +v
  const sum = Object.values(out).reduce((a, b) => a + b, 0)
  if (!sum) return { [fallback]: 1 }
  for (const k in out) out[k] = Math.round((out[k] / sum) * 1000) / 1000
  return out
}

const top = (probs) => Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0]

// Decide whether the dots are English braille or Bharati braille, and how likely each language is.
async function identify({ eng, dev, oddities = 0 }) {
  // Cells that have no meaning (or are never written) in one code are strong evidence for the other.
  const badEng = (eng.match(/\?/g) || []).length
  const badDev = (dev.match(/\?/g) || []).length + oddities
  let choice = badEng < badDev ? 'A' : 'B', probs = null
  try {
    if (badEng === badDev) {
      const j = await askJson(`Which of these two strings is real, meaningful text?
A: "${eng}"
B: "${dev}"
A is read as English letters (it may be English, or an Indian language typed in Latin letters). B is Devanagari (it may be any Indian language written phonetically).
Reply with only JSON like {"choice":"A"} or {"choice":"B"}.`)
      choice = j.choice === 'B' ? 'B' : 'A'
    }
    probs = (await askJson(`What language is this text in? "${choice === 'A' ? eng : dev}"
${choice === 'B' ? 'It was read from Bharati braille, which is shared by all Indian scripts, so it may be any Indian language written phonetically in Devanagari. Do not include English.\n' : ''}${PROB_RULES}
Reply with only JSON like {"probs":{"hi-IN":0.6,"mr-IN":0.4}}.`)).probs
  } catch (e) { console.warn('identify chat failed:', e.message) }
  const lid = await sarvam('/text-lid', { input: choice === 'A' ? eng : dev }).catch(() => null)
  const indic = Object.keys(LANGS).filter((l) => l !== 'en-IN')
  const fallback = choice === 'A' ? 'en-IN' : (indic.includes(lid?.language_code) ? lid.language_code : 'hi-IN')
  // English braille spells Latin letters, which may still be romanised Hindi etc.
  probs = choice === 'A' ? cleanProbs(probs, fallback) : cleanProbs(probs, fallback, indic)
  return { choice, probs, language: top(probs), lid: lid?.language_code || null }
}

async function lid({ text }) {
  const l = await sarvam('/text-lid', { input: text }).catch(() => null)
  const fallback = LANGS[l?.language_code] ? l.language_code : 'en-IN'
  let probs
  try {
    probs = (await askJson(`What language is this text in? "${text}"
${PROB_RULES}
Reply with only JSON like {"probs":{"hi-IN":0.7,"mr-IN":0.3}}.`)).probs
  } catch (e) { console.warn('lid chat failed:', e.message) }
  probs = cleanProbs(probs, fallback)
  return { probs, language: top(probs), lid: l?.language_code || null }
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
