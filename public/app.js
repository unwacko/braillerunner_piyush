import { detectBraille } from './dots.js'
import { cellsToUnicode, unicodeToCells, decodeEnglish, decodeBharati, devaToScript, encodeFor } from './braille.js'

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
    run(c, blob).catch((e) => status('Error: ' + e.message))
  }
  img.src = URL.createObjectURL(blob)
}

async function run(canvas, blob) {
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
  const dataUrl = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob) })
  const { markdown } = await api('/api/ocr', { image: dataUrl })
  const clean = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^\*[\s\S]*?\*$/gm, '').trim()
  if (/[⠀-⣿]/.test(clean)) return fromCells(unicodeToCells(clean))
  if (!clean) return status('Could not find braille or text in this image. Try a straighter, brighter photo.')
  return fromText(clean)
}

async function fromCells(cells) {
  const braille = cellsToUnicode(cells)
  const eng = decodeEnglish(cells), dev = decodeBharati(cells)
  status('Identifying the language with Sarvam…')
  const id = await api('/api/identify', { eng, dev })
  const text = id.choice === 'A' ? eng : devaToScript(dev, id.language)
  const how = id.choice === 'A' ? 'English Grade 1 braille' : 'Bharati braille'
  await showAndTranslate(text, id.language, braille, `${how} → ${LANG_NAMES[id.language]}` + (id.lid ? ` (Sarvam LID: ${id.lid})` : ''))
}

async function fromText(text) {
  status('Identifying the language with Sarvam…')
  const { language } = await api('/api/lid', { text })
  await showAndTranslate(text, language, null, `Text → ${LANG_NAMES[language]}`)
}

async function showAndTranslate(text, lang, braille, how) {
  $('out').innerHTML = `
    <div class="card src">
      <h3><span>Read: ${esc(how)}</span></h3>
      ${braille ? `<div class="br" aria-label="braille as read">${esc(braille)}</div>` : ''}
      <div class="txt" lang="${lang}">${esc(text)}</div>
    </div>
    <div class="grid" id="grid"></div>`
  status(`Translating into ${Object.keys(LANG_NAMES).length - 1} languages with Sarvam Translate…`)
  const { results } = await api('/api/translate', { text, source: lang })
  $('grid').innerHTML = results.map((r) => `
    <div class="card">
      <h3><span>${esc(r.name)}</span><span>${esc(r.lang)}</span></h3>
      ${r.error ? `<div class="err">${esc(r.error)}</div>` : `
        <div class="txt" lang="${r.lang}">${esc(r.text)}</div>
        <div class="br" aria-label="${esc(r.name)} braille">${esc(cellsToUnicode(encodeFor(r.text, r.lang)))}</div>`}
    </div>`).join('')
  status('Done.')
}
