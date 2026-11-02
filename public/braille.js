// Braille tables and codecs. A cell is a 6-bit mask: dot N = bit N-1 (same as Unicode U+2800 + mask).
// English: Grade 1 (Braille Works alphabet card). Indian languages: Standard Bharati Braille (NIEPVD 2025).

export const mask = (dots) => [...String(dots)].reduce((m, d) => m | (1 << (d - 1)), 0)
export const cellChar = (m) => String.fromCharCode(0x2800 + m)
export const cellsToUnicode = (cells) => cells.map((c) => (c < 0 ? ' ' : cellChar(c))).join('')
export const unicodeToCells = (s) =>
  [...s].flatMap((ch) => {
    const c = ch.codePointAt(0)
    if (c >= 0x2800 && c <= 0x283f) return [c === 0x2800 ? -1 : c - 0x2800]
    if (/\s/.test(ch)) return [-1]
    return []
  })

// ---------- English Grade 1 ----------
const EN_LETTERS = {
  a: 1, b: 12, c: 14, d: 145, e: 15, f: 124, g: 1245, h: 125, i: 24, j: 245,
  k: 13, l: 123, m: 134, n: 1345, o: 135, p: 1234, q: 12345, r: 1235, s: 234, t: 2345,
  u: 136, v: 1236, w: 2456, x: 1346, y: 13456, z: 1356,
}
const EN_PUNCT = { ',': 2, ';': 23, ':': 25, '.': 256, '?': 236, '!': 235, "'": 3, '-': 36, '"': 236 }
const CAP = mask(6), NUM = mask(3456)
const EN = Object.fromEntries(Object.entries(EN_LETTERS).map(([k, v]) => [k, mask(v)]))
const EN_REV = Object.fromEntries(Object.entries(EN).map(([k, v]) => [v, k]))
const EN_P = Object.fromEntries(Object.entries(EN_PUNCT).map(([k, v]) => [k, mask(v)]))
const EN_P_REV = Object.fromEntries(Object.entries(EN_P).reverse().map(([k, v]) => [v, k]))
const DIGIT_OF = Object.fromEntries('abcdefghij'.split('').map((l, i) => [EN[l], String((i + 1) % 10)]))

export function decodeEnglish(cells) {
  let out = '', cap = false, num = false
  for (const c of cells) {
    if (c < 0) { out += ' '; num = false; continue }
    if (c === CAP) { cap = true; continue }
    if (c === NUM) { num = true; continue }
    if (num && DIGIT_OF[c]) { out += DIGIT_OF[c]; continue }
    num = false
    let ch = EN_REV[c] ?? EN_P_REV[c] ?? '?'
    if (cap) { ch = ch.toUpperCase(); cap = false }
    out += ch
  }
  return out
}

// Cell list that also remembers a plain-language label for each cell (for the dot display).
function labeled() {
  const a = []
  a.labels = []
  a.put = (m, t = '') => { a.push(m); a.labels.push(t) }
  return a
}

export function encodeEnglish(text) {
  const cells = labeled()
  let num = false
  for (const ch of text) {
    if (/\s/.test(ch)) { cells.put(-1); num = false; continue }
    if (/[0-9]/.test(ch)) {
      if (!num) cells.put(NUM, 'num'), (num = true)
      cells.put(EN['jabcdefghi'[+ch]], ch)
      continue
    }
    num = false
    const lo = ch.toLowerCase()
    if (EN[lo] != null) { if (ch !== lo) cells.put(CAP, 'Cap'); cells.put(EN[lo], ch) }
    else if (EN_P[ch] != null) cells.put(EN_P[ch], ch)
  }
  return cells
}

// ---------- Bharati (keyed on Devanagari; other Indic scripts map via Unicode block offset) ----------
const V = { // independent vowel, matra, cell
  'अ': ['', 1], 'आ': ['ा', 345], 'इ': ['ि', 24], 'ई': ['ी', 35], 'उ': ['ु', 136], 'ऊ': ['ू', 1256],
  'ए': ['े', 15], 'ऐ': ['ै', 34], 'ओ': ['ो', 135], 'औ': ['ौ', 246], 'ऑ': ['ॉ', 1346],
  'ऎ': ['ॆ', 26], 'ऒ': ['ॊ', 1346],
}
const C = {
  'क': 13, 'ख': 46, 'ग': 1245, 'घ': 126, 'ङ': 346, 'च': 14, 'छ': 16, 'ज': 245, 'झ': 356, 'ञ': 25,
  'ट': 23456, 'ठ': 2456, 'ड': 1246, 'ढ': 123456, 'ण': 3456, 'त': 2345, 'थ': 1456, 'द': 145, 'ध': 2346,
  'न': 1345, 'प': 1234, 'फ': 124, 'ब': 12, 'भ': 45, 'म': 134, 'य': 13456, 'र': 1235, 'ल': 123,
  'ळ': 456, 'व': 1236, 'श': 146, 'ष': 12346, 'स': 234, 'ह': 125, 'ड़': 12456,
  'ऴ': 12356, 'ऱ': 12456, // Tamil/Malayalam ழ ഴ and ற റ (Bharati chart)
}
const CONJ = { 'क्ष': 12345, 'ज्ञ': 156 }
const SIGNS = { 'ं': 56, 'ः': 6, 'ँ': 3, '्': 4, '़': 5, 'ऽ': 2, '।': 256, ',': 2, '?': 236, '!': 235 }

const B_CONS = {}, B_VOW = {}, B_SIGN = {}
for (const [ch, d] of Object.entries(C)) B_CONS[mask(d)] ??= ch
for (const [ch, d] of Object.entries(CONJ)) B_CONS[mask(d)] = ch
for (const [ch, [, d]] of Object.entries(V)) B_VOW[mask(d)] ??= ch
for (const [ch, d] of Object.entries(SIGNS)) B_SIGN[mask(d)] ??= ch
const MATRA_TO_VOWEL = Object.fromEntries(Object.entries(V).filter(([, [m]]) => m).map(([v, [m]]) => [m, v]))

export function decodeBharati(cells) {
  let out = '', afterCons = false
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (c < 0) { out += ' '; afterCons = false; continue }
    if (c === mask(5) && cells[i + 1] === mask(1235)) { out += afterCons ? 'ृ' : 'ऋ'; i++; afterCons = false; continue }
    if (B_CONS[c]) { out += B_CONS[c]; afterCons = true; continue }
    if (B_VOW[c]) { out += afterCons ? V[B_VOW[c]][0] : B_VOW[c]; afterCons = false; continue }
    if (B_SIGN[c]) { out += B_SIGN[c]; afterCons = false; continue }
    out += '?'; afterCons = false
  }
  return out
}

// Cells a Bharati writer would never produce: अ (dot 1) straight after a consonant is the inherent vowel.
export function bharatiOddities(cells) {
  let n = 0
  for (let i = 1; i < cells.length; i++) if (cells[i] === mask(1) && B_CONS[cells[i - 1]]) n++
  return n
}

const SCRIPT_BASE = {
  'hi-IN': 0x900, 'mr-IN': 0x900, 'ne-IN': 0x900, 'sa-IN': 0x900, 'bn-IN': 0x980, 'as-IN': 0x980,
  'pa-IN': 0xa00, 'gu-IN': 0xa80, 'od-IN': 0xb00, 'ta-IN': 0xb80, 'te-IN': 0xc00, 'kn-IN': 0xc80, 'ml-IN': 0xd00,
}
const toDeva = (ch) => {
  const c = ch.codePointAt(0)
  return c >= 0x980 && c <= 0xd7f ? String.fromCodePoint(0x900 + ((c - 0x900) % 0x80)) : ch
}

// Re-render Devanagari as another Indic script (Bharati reading is script-neutral).
export function devaToScript(text, lang) {
  const base = SCRIPT_BASE[lang] ?? 0x900
  return [...text].map((ch) => {
    const c = ch.codePointAt(0)
    return c >= 0x901 && c <= 0x97f && c !== 0x964 && c !== 0x965 ? String.fromCodePoint(c - 0x900 + base) : ch
  }).join('')
}

// Labels for signs, so a reader sees a letter they know instead of a bare diacritic.
const SIGN_LABEL = { 'ं': 'अं', 'ः': 'अः', 'ँ': 'अँ', '्': 'halant', '़': 'nukta', 'ऽ': 'ऽ', '।': '.' }

export function encodeBharati(text) {
  const orig = [...text.normalize('NFC')]
  const chars = orig.map(toDeva)
  // Show labels in the text's own script: shift Devanagari labels by the same block offset.
  const shift = (s, i) => {
    const delta = orig[i].codePointAt(0) - chars[i].codePointAt(0)
    return delta ? [...s].map((c) => (c >= 'ऀ' && c <= 'ॿ' ? String.fromCodePoint(c.codePointAt(0) + delta) : c)).join('') : s
  }
  const cells = labeled()
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i], two = ch + (chars[i + 1] || '') + (chars[i + 2] || '')
    if (/\s/.test(ch)) { cells.put(-1); continue }
    if (CONJ[two]) { cells.put(mask(CONJ[two]), orig.slice(i, i + 3).join('')); i += 2; continue }
    if (/[0-9०-९]/.test(ch)) {
      const d = /[0-9]/.test(ch) ? +ch : ch.codePointAt(0) - 0x966
      if (!/[0-9०-९]/.test(chars[i - 1] || '')) cells.put(NUM, 'num')
      cells.put(EN['jabcdefghi'[d]], String(d))
      continue
    }
    if (ch === 'ऋ' || ch === 'ृ') { cells.put(mask(5)); cells.put(mask(1235), shift('ऋ', i)); continue }
    if (C[ch]) { cells.put(mask(C[ch]), orig[i]); continue }
    if (V[ch]) { cells.put(mask(V[ch][1]), orig[i]); continue }
    if (MATRA_TO_VOWEL[ch]) { cells.put(mask(V[MATRA_TO_VOWEL[ch]][1]), shift(MATRA_TO_VOWEL[ch], i)); continue }
    if (SIGNS[ch]) { cells.put(mask(SIGNS[ch]), SIGN_LABEL[ch] ? shift(SIGN_LABEL[ch], i) : ch); continue }
    if (EN_P[ch] != null) cells.put(EN_P[ch], ch)
  }
  return cells
}

// Labels for cells read off a page, in the reading the language step chose.
export function labelCells(cells, system, lang) {
  return cells.map((m) => {
    if (m < 0) return ''
    if (system === 'en') return m === CAP ? 'Cap' : m === NUM ? 'num' : EN_REV[m] ?? EN_P_REV[m] ?? ''
    const t = B_CONS[m] ?? B_VOW[m] ?? (B_SIGN[m] ? SIGN_LABEL[B_SIGN[m]] ?? B_SIGN[m] : '')
    return devaToScript(t, lang)
  })
}

export const encodeFor = (text, lang) =>
  lang === 'en-IN' ? encodeEnglish(text) : SCRIPT_BASE[lang] ? encodeBharati(text) : []
