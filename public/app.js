import { detectBraille } from './dots.js'
import { unicodeToCells, decodeEnglish, decodeBharati, devaToScript, encodeFor, bharatiOddities, labelCells } from './braille.js'

const $ = (id) => document.getElementById(id)
const LANG_NAMES = {
  'en-IN': 'English', 'hi-IN': 'Hindi', 'bn-IN': 'Bengali', 'ta-IN': 'Tamil', 'te-IN': 'Telugu', 'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam', 'mr-IN': 'Marathi', 'gu-IN': 'Gujarati', 'pa-IN': 'Punjabi', 'od-IN': 'Odia',
}
const status = (s) => ($('status').textContent = s)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || r.status)
  return j
}

// ---------- inputs ----------
$('btnUpload').onclick = () => $('file').click()
$('file').onchange = (e) => e.target.files[0] && loadImage(e.target.files[0])

let stream
$('btnCam').onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 1920 } })
    $('video').srcObject = stream
    $('cam').style.display = 'block'
  } catch (e) { status('Camera not available: ' + e.message) }
}
const stopCam = () => { stream?.getTracks().forEach((t) => t.stop()); $('cam').style.display = 'none' }
$('btnCamClose').onclick = stopCam
$('btnSnap').onclick = () => {
  const v = $('video'), c = document.createElement('canvas')
  c.width = v.videoWidth; c.height = v.videoHeight
  c.getContext('2d').drawImage(v, 0, 0)
  stopCam()
  c.toBlob(loadImage, 'image/jpeg', 0.92)
}

document.addEventListener('paste', (e) => {
  const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
  if (item) return loadImage(item.getAsFile())
  const text = e.clipboardData.getData('text')
  if (text && /[⠀-⣿]/.test(text)) { $('preview').style.display = 'none'; fromCells(unicodeToCells(text)) }
  else if (text.trim()) { $('preview').style.display = 'none'; fromText(text.trim()) }
})

// ---------- pipeline ----------
function loadImage(blob) {
  const img = new Image()
  img.onload = () => {
    const scale = Math.min(1, 1400 / img.width)
    const c = $('preview')
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    c.style.display = 'block'
    run(c).catch((e) => status('Error: ' + e.message))
  }
  img.src = URL.createObjectURL(blob)
}

async function run(canvas) {
  $('out').innerHTML = ''
  status('Looking for braille dots…')
  const found = detectBraille(canvas)
  if (found) {
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 2
    for (const p of found.dots) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 3, 0, 7); ctx.stroke() }
    const cells = found.lines.flatMap((l, i) => (i ? [-1, ...l] : l))
    return fromCells(cells)
  }
  // No dot grid: let Sarvam Vision read the page (printed/typed text or braille characters on screen).
  status('No dot grid found. Reading the page with Sarvam Vision…')
  // Send the downscaled preview (no dots were drawn on it) so the upload stays well under host body limits.
  const { job_id } = await api('/api/ocr/start', { image: canvas.toDataURL('image/jpeg', 0.9) })
  let markdown = null
  for (let i = 0; i < 40 && markdown == null; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    const r = await api('/api/ocr/check', { job_id })
    if (r.done) markdown = r.markdown
  }
  if (markdown == null) return status('Sarvam Vision took too long. Please try again.')
  const clean = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^\*[\s\S]*?\*$/gm, '')
    .replace(/^#+\s*/gm, '').replace(/\*\*|__/g, '').trim()
  if (/[⠀-⣿]/.test(clean)) return fromCells(unicodeToCells(clean))
  if (!clean) return status('Could not find braille or text in this image. Try a straighter, brighter photo.')
  return fromText(clean)
}

async function fromCells(cells) {
  const eng = decodeEnglish(cells), dev = decodeBharati(cells)
  status('Identifying the language with Sarvam…')
  const id = await api('/api/identify', { eng, dev, oddities: bharatiOddities(cells) })
  const how = id.choice === 'A' ? 'English Grade 1 braille' : 'Bharati braille'
  // Bharati cells are script-neutral: a likely language can show the original writing in its own script.
  const original = (lang) => (id.choice === 'A' ? (lang === id.language ? eng : null) : lang === 'en-IN' ? null : devaToScript(dev, lang))
  const braille = renderBraille(cells, labelCells(cells, id.choice === 'A' ? 'en' : 'bh', id.language), 'Braille as read')
  await showAndTranslate({ text: original(id.language), probs: id.probs, braille, how, lid: id.lid, original })
}

async function fromText(text) {
  status('Identifying the language with Sarvam…')
  const id = await api('/api/lid', { text })
  await showAndTranslate({ text, probs: id.probs, how: 'Text', lid: id.lid, original: (l) => (l === id.language ? text : null) })
}

const pct = (p) => (p >= 0.995 ? '100%' : p < 0.01 && p > 0 ? '<1%' : Math.round(p * 100) + '%')

function card(lang, p, highlighted) {
  return `
    <div class="card${highlighted ? ' hl' : ''}" id="card-${lang}">
      <h3><span>${esc(LANG_NAMES[lang])}</span><span>${esc(lang)}</span></h3>
      <div class="txt" lang="${lang}"><span class="muted">Translating…</span></div>
      <div class="br"></div>
      <button class="listen secondary" data-lang="${lang}" disabled aria-label="Read aloud in ${esc(LANG_NAMES[lang])}">🔊 Listen</button>
      <div class="prob" title="Sarvam-105B estimate">
        <div class="bar"><i style="width:${Math.max(p * 100, p > 0 ? 1 : 0)}%"></i></div>
        <span>${pct(p)} likely ${highlighted ? 'the original language' : ''}</span>
      </div>
    </div>`
}

// Draw braille as real dot cells (raised dots dark, empty positions faint) with the letter under each cell.
const DOT_ORDER = [0, 3, 1, 4, 2, 5] // grid reads left-right, top-down: dots 1 4 / 2 5 / 3 6
function renderBraille(cells, labels, aria) {
  labels = labels || cells.labels || []
  const words = [[]]
  cells.forEach((m, i) => (m < 0 ? words.push([]) : words.at(-1).push(
    `<span class="cell"><span class="dots">${DOT_ORDER.map((b) => `<i${m >> b & 1 ? ' class="on"' : ''}></i>`).join('')}</span>` +
    `<span class="lbl">${esc(labels[i] || '\u00a0')}</span></span>`)))
  const html = words.filter((w) => w.length).map((w) => `<span class="word">${w.join('')}</span>`).join('')
  return html ? `<div class="cells" role="img" aria-label="${esc(aria)}">${html}</div>` : ''
}

function fill(lang, text, note) {
  const el = $('card-' + lang)
  el.querySelector('.txt').textContent = text
  el.querySelector('.br').innerHTML = renderBraille(encodeFor(text, lang), null, `${LANG_NAMES[lang]} braille`)
  if (note) el.querySelector('.txt').insertAdjacentHTML('afterend', `<div class="note">${esc(note)}</div>`)
  el.querySelector('.listen').disabled = false
}

// Read aloud with Sarvam Bulbul. One clip plays at a time; clicking again stops it.
let playing = null
const audioCache = new Map()
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.listen')
  if (!btn || btn.disabled) return
  const lang = btn.dataset.lang
  const text = $('card-' + lang).querySelector('.txt').textContent
  const wasMe = playing?.btn === btn
  if (playing) { playing.audio.pause(); playing.btn.textContent = '🔊 Listen'; playing = null }
  if (wasMe) return
  btn.textContent = 'Loading…'
  try {
    const key = lang + '|' + text
    if (!audioCache.has(key)) audioCache.set(key, (await api('/api/speak', { text, lang })).audio)
    const audio = new Audio('data:audio/wav;base64,' + audioCache.get(key))
    playing = { audio, btn }
    btn.textContent = '■ Stop'
    audio.onended = () => { if (playing?.audio === audio) { btn.textContent = '🔊 Listen'; playing = null } }
    await audio.play()
  } catch (err) {
    btn.textContent = '🔊 Listen'
    status('Could not read aloud: ' + err.message)
  }
})

async function showAndTranslate({ text, probs, braille, how, lid, original }) {
  const ranked = Object.keys(LANG_NAMES).map((l) => [l, probs[l] || 0]).sort((a, b) => b[1] - a[1])
  const source = ranked[0][0]
  const shown = ranked.filter(([l, p], i) => i === 0 || p > 0.1)
  const hidden = ranked.filter((r) => !shown.includes(r))
  $('out').innerHTML = `
    <p class="how">Read as <b>${esc(how)}</b>${lid ? ` · Sarvam LID says ${esc(lid)}` : ''}</p>
    ${braille ? `<div class="br read">${braille}</div>` : ''}
    <h2>Original language${shown.length > 1 ? 's' : ''}</h2>
    <div class="grid">${shown.map(([l, p]) => card(l, p, true)).join('')}</div>
    <button class="more secondary" id="more" aria-expanded="false" aria-controls="rest" title="Show other languages">⋯ ${hidden.length} more languages</button>
    <div class="grid" id="rest" hidden>${hidden.map(([l, p]) => card(l, p, false)).join('')}</div>`
  $('more').onclick = () => {
    const open = $('rest').hidden
    $('rest').hidden = !open
    $('more').setAttribute('aria-expanded', open)
    $('more').textContent = open ? 'Hide other languages' : `⋯ ${hidden.length} more languages`
  }
  for (const [l] of shown) if (original(l)) fill(l, original(l), l === source ? null : 'Same writing, read in this language')

  status(`Translating into ${ranked.length - 1} languages with Sarvam Translate…`)
  const { results } = await api('/api/translate', { text, source })
  for (const r of results) {
    if (shown.some(([l]) => l === r.lang) && original(r.lang)) continue
    if (r.error) $('card-' + r.lang).querySelector('.txt').innerHTML = `<span class="err">${esc(r.error)}</span>`
    else fill(r.lang, r.text, shown.some(([l]) => l === r.lang) ? 'Translation' : null)
  }
  status('Done.')
}
