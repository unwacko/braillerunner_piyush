// Find braille dots in an image and snap them to a cell grid.
// Returns { lines: [[mask|-1,...],...], dots: [{x,y,r}], scale } or null when no braille grid is found.

export function detectBraille(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { width: W, height: H } = canvas
  const px = ctx.getImageData(0, 0, W, H).data
  const g = new Float32Array(W * H)
  let mean = 0
  for (let i = 0; i < W * H; i++) { g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]; mean += g[i] }
  mean /= W * H
  if (mean < 110) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i] // light dots on dark screen

  // Adaptive threshold against a local mean (integral image).
  const I = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let row = 0
    for (let x = 0; x < W; x++) { row += g[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row }
  }
  const R = Math.max(8, Math.round(Math.min(W, H) / 16))
  const bin = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1)
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1)
      const s = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]
      const local = s / ((x1 - x0) * (y1 - y0))
      bin[y * W + x] = g[y * W + x] < local - 25 ? 1 : 0
    }
  }

  // Connected components -> blobs.
  const lab = new Int32Array(W * H), blobs = [], stack = []
  for (let i = 0; i < W * H; i++) {
    if (!bin[i] || lab[i]) continue
    let n = 0, sx = 0, sy = 0, minx = W, maxx = 0, miny = H, maxy = 0
    stack.push(i); lab[i] = 1
    while (stack.length) {
      const j = stack.pop(), x = j % W, y = (j / W) | 0
      n++; sx += x; sy += y
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y
      for (const k of [j - 1, j + 1, j - W, j + W]) {
        if (k < 0 || k >= W * H || lab[k] || !bin[k]) continue
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === W - 1)) continue
        lab[k] = 1; stack.push(k)
      }
    }
    const bw = maxx - minx + 1, bh = maxy - miny + 1
    if (n >= 6 && bw / bh < 2 && bh / bw < 2 && n / (bw * bh) > 0.45) blobs.push({ x: sx / n, y: sy / n, n, r: Math.max(bw, bh) / 2 })
  }
  if (blobs.length < 2) return null
  const areas = blobs.map((b) => b.n).sort((a, b) => a - b)
  const med = areas[areas.length >> 1]
  const dots = blobs.filter((b) => b.n > med * 0.35 && b.n < med * 2.8)
  if (dots.length < 2) return null

  // Dot pitch d: typical nearest-neighbour distance.
  const nn = dots.map((a) => Math.min(...dots.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))))
  nn.sort((a, b) => a - b)
  const d = nn[Math.floor(nn.length * 0.3)]
  if (!(d > 2)) return null

  const xs = cluster(dots.map((p) => p.x), d * 0.4)
  const ys = cluster(dots.map((p) => p.y), d * 0.4)
  const gx = fitLattice(xs, d, 2, d * 2.1, d * 3.6) // cells: columns at x0 + kP + {0,d}
  const gy = fitLattice(ys, d, 3, d * 3.2, d * 7) // lines: rows at y0 + jL + {0,d,2d}

  const grid = new Map()
  let maxLine = 0
  for (const p of dots) {
    const [cell, col] = snap(p.x, gx, d, 2), [line, row] = snap(p.y, gy, d, 3)
    if (cell < 0 || line < 0) continue
    const key = line + ':' + cell
    grid.set(key, (grid.get(key) || 0) | (1 << (col === 0 ? row : row + 3)))
    maxLine = Math.max(maxLine, line)
  }
  const lines = []
  for (let l = 0; l <= maxLine; l++) {
    const idx = [...grid.keys()].filter((k) => +k.split(':')[0] === l).map((k) => +k.split(':')[1])
    if (!idx.length) continue
    const out = []
    for (let c = Math.min(...idx); c <= Math.max(...idx); c++) out.push(grid.get(l + ':' + c) ?? -1)
    lines.push(out)
  }
  return lines.length ? { lines, dots, d } : null
}

function cluster(vals, tol) {
  const s = [...vals].sort((a, b) => a - b), out = []
  let grp = [s[0]]
  for (let i = 1; i < s.length; i++) {
    if (s[i] - grp[grp.length - 1] <= tol) grp.push(s[i])
    else { out.push(grp.reduce((a, b) => a + b) / grp.length); grp = [s[i]] }
  }
  out.push(grp.reduce((a, b) => a + b) / grp.length)
  return out
}

// Fit positions to o + k*P + m*d (m < slots). Brute force P and origin; minimise squared error.
function fitLattice(pos, d, slots, pMin, pMax) {
  const min = Math.min(...pos)
  let best = { err: Infinity, o: min, P: pMax }
  if (pos.length === 1 || Math.max(...pos) - min < d * slots * 0.9) {
    // Single cell/line: anchor so the span fits within one group.
    const span = Math.max(...pos) - min
    const offs = []
    for (let m = 0; m < slots; m++) if (span + m * d <= (slots - 1) * d + d * 0.5) offs.push(m)
    return { o: min - (offs[0] ?? 0) * d, P: pMax }
  }
  for (let P = pMin; P <= pMax; P += d * 0.04) {
    for (const a of pos) for (let m = 0; m < slots; m++) {
      const o = a - m * d
      let err = 0
      for (const p of pos) {
        const k = Math.floor((p - o + d * 0.5) / P)
        let e = Infinity
        for (let s = 0; s < slots; s++) e = Math.min(e, Math.abs(p - (o + k * P + s * d)))
        err += e * e
      }
      if (err < best.err - 1e-6) best = { err, o, P }
    }
  }
  // Pull origin back to the first group that holds any position.
  const kMin = Math.min(...pos.map((p) => Math.floor((p - best.o + d * 0.5) / best.P)))
  return { o: best.o + kMin * best.P, P: best.P }
}

function snap(v, { o, P }, d, slots) {
  const k = Math.floor((v - o + d * 0.5) / P)
  const s = Math.max(0, Math.min(slots - 1, Math.round((v - o - k * P) / d)))
  return [k, s]
}
