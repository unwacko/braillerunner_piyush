// Sarvam calls behind /api/*, shared by the local server (server.js) and the Netlify function.
import zlib from 'node:zlib'

const API = 'https://api.sarvam.ai'
// Read lazily: the local server loads .env after imports run; Netlify injects it as an env var.
const key = () => {
  // Netlify Functions expose site variables through Netlify.env; Node (local server) uses process.env.
  const k = globalThis.Netlify?.env?.get('SARVAM_API_KEY') || process.env.SARVAM_API_KEY
  if (!k) throw new Error('SARVAM_API_KEY is not set on the server')
  return k.trim()
}

const LANGS = {
  'en-IN': 'English', 'hi-IN': 'Hindi', 'bn-IN': 'Bengali', 'ta-IN': 'Tamil', 'te-IN': 'Telugu',
  'kn-IN': 'Kannada', 'ml-IN': 'Malayalam', 'mr-IN': 'Marathi', 'gu-IN': 'Gujarati',
  'pa-IN': 'Punjabi', 'od-IN': 'Odia',
}

async function sarvam(p, body) {
  const r = await fetch(API + p, {
    method: 'POST',
    headers: { 'api-subscription-key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`${p}: ${j?.error?.message || r.status}`)
  return j
}

// Sarvam Vision (Document AI parse), split in two so no single request runs long
// (serverless hosts like Netlify cut functions off after ~10s). The browser polls visionCheck.
async function visionStart({ image }) {
  const [, mime, b64] = image.match(/^data:(.+?);base64,(.*)$/)
  const ext = mime.split('/')[1].replace('jpeg', 'jpg')
  const form = new FormData()
  form.append('file', new Blob([Buffer.from(b64, 'base64')], { type: mime }), `page.${ext}`)
  form.append('language', 'en-IN')
  form.append('output_format', 'md')
  const r = await fetch(`${API}/doc-ai/v1/job/parse`, { method: 'POST', headers: { 'api-subscription-key': key() }, body: form })
  const job = await r.json()
  if (!job.job_id) throw new Error('vision: ' + JSON.stringify(job))
  return { job_id: job.job_id }
}

async function visionCheck({ job_id }) {
  const h = { 'api-subscription-key': key() }
  const st = await (await fetch(`${API}/doc-ai/v1/job/${encodeURIComponent(job_id)}/status`, { headers: h })).json()
  const s = String(st.status).toLowerCase()
  if (s === 'failed' || s === 'rejected') throw new Error('vision job ' + s)
  if (s !== 'completed' && s !== 'partially_completed') return { done: false }
  const dl = await (await fetch(`${API}/doc-ai/v1/job/${encodeURIComponent(job_id)}/download-url`, { headers: h })).json()
  const zip = Buffer.from(await (await fetch(dl.url)).arrayBuffer())
  const md = unzip(zip).find((f) => f.name.endsWith('.md'))
  return { done: true, markdown: md ? md.data.toString('utf8') : '' }
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

// Sarvam Bulbul text-to-speech. Returns a base64 WAV the browser can play directly.
async function speak({ text, lang }) {
  if (!LANGS[lang]) throw new Error('No voice for ' + lang)
  const r = await sarvam('/text-to-speech', {
    text: String(text).slice(0, 2500), language_code: lang, model: 'bulbul:v3', speaker: 'shubh',
  })
  return { audio: r.audios[0] }
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

const handlers = {
  '/api/ocr/start': visionStart,
  '/api/ocr/check': visionCheck,
  '/api/identify': identify,
  '/api/translate': translateAll,
  '/api/lid': lid,
  '/api/speak': speak,
}

// Check the key up front: identify/lid fall back quietly on errors, which would hide a missing key.
export const routes = Object.fromEntries(Object.entries(handlers).map(([p, fn]) => [p, (body) => (key(), fn(body))]))
