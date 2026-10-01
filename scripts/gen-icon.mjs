// Dependency-free PNG icon generator for BatchLive.
// Produces build/icon.png (512x512): rounded blue tile with green "BL".
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SIZE = 512

// Colors (RGBA)
const BG = [18, 58, 143, 255] // blue
const BG_EDGE = [12, 40, 104, 255] // darker blue edge
const FG = [53, 224, 122, 255] // green

// 5x7 bitmap font for the two letters we need.
const GLYPHS = {
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111']
}

const buf = new Uint8Array(SIZE * SIZE * 4)

function setPx(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  buf[i] = r
  buf[i + 1] = g
  buf[i + 2] = b
  buf[i + 3] = a
}

// Rounded-rect mask radius.
const RAD = 96
function inRounded(x, y) {
  const minX = RAD,
    minY = RAD,
    maxX = SIZE - RAD,
    maxY = SIZE - RAD
  let cx = x,
    cy = y
  if (x < minX) cx = minX
  else if (x > maxX) cx = maxX
  if (y < minY) cy = minY
  else if (y > maxY) cy = maxY
  if (cx === x && cy === y) return true
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= RAD * RAD
}

// Fill background with a subtle vertical gradient inside the rounded tile.
for (let y = 0; y < SIZE; y++) {
  const t = y / SIZE
  const col = [
    Math.round(BG[0] * (1 - t) + BG_EDGE[0] * t),
    Math.round(BG[1] * (1 - t) + BG_EDGE[1] * t),
    Math.round(BG[2] * (1 - t) + BG_EDGE[2] * t),
    255
  ]
  for (let x = 0; x < SIZE; x++) {
    setPx(x, y, inRounded(x, y) ? col : [0, 0, 0, 0])
  }
}

// Draw "BL" centered.
const cols = 5 + 2 + 5 // B + gap + L
const rows = 7
const scale = Math.floor((SIZE * 0.62) / cols)
const totalW = cols * scale
const totalH = rows * scale
const offX = Math.round((SIZE - totalW) / 2)
const offY = Math.round((SIZE - totalH) / 2)

function drawGlyph(glyph, gx) {
  for (let r = 0; r < glyph.length; r++) {
    for (let c = 0; c < glyph[r].length; c++) {
      if (glyph[r][c] !== '1') continue
      for (let yy = 0; yy < scale; yy++) {
        for (let xx = 0; xx < scale; xx++) {
          setPx(offX + (gx + c) * scale + xx, offY + r * scale + yy, FG)
        }
      }
    }
  }
}

drawGlyph(GLYPHS.B, 0)
drawGlyph(GLYPHS.L, 7)

// ---- Encode PNG ----
function crc32(bytes) {
  let c = ~0
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
  return Buffer.concat([len, typeBytes, Buffer.from(data), crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

// Add filter byte (0) at the start of each scanline.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  buf.subarray(y * SIZE * 4, (y + 1) * SIZE * 4).forEach((v, i) => {
    raw[y * (SIZE * 4 + 1) + 1 + i] = v
  })
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = join(__dirname, '..', 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log('Wrote', out, png.length, 'bytes')
