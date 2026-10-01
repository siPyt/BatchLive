// Dependency-free icon generator for BatchLive.
// Produces build/icon.png (512) and build/icon.ico (multi-size PNG-in-ICO):
// a rounded blue tile with a green "BL".
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Colors (RGBA)
const BG = [18, 58, 143, 255] // blue
const BG_EDGE = [12, 40, 104, 255] // darker blue edge
const FG = [53, 224, 122, 255] // green

// 5x7 bitmap font for the two letters we need.
const GLYPHS = {
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111']
}

/** Render the icon at the given size and return a PNG Buffer. */
function renderPng(size) {
  const buf = new Uint8Array(size * size * 4)
  const setPx = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    buf[i] = r
    buf[i + 1] = g
    buf[i + 2] = b
    buf[i + 3] = a
  }
  const RAD = Math.round(size * 0.1875)
  const inRounded = (x, y) => {
    const minX = RAD,
      minY = RAD,
      maxX = size - RAD,
      maxY = size - RAD
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
  for (let y = 0; y < size; y++) {
    const t = y / size
    const col = [
      Math.round(BG[0] * (1 - t) + BG_EDGE[0] * t),
      Math.round(BG[1] * (1 - t) + BG_EDGE[1] * t),
      Math.round(BG[2] * (1 - t) + BG_EDGE[2] * t),
      255
    ]
    for (let x = 0; x < size; x++) setPx(x, y, inRounded(x, y) ? col : [0, 0, 0, 0])
  }
  const cols = 5 + 2 + 5
  const scale = Math.max(1, Math.floor((size * 0.62) / cols))
  const totalW = cols * scale
  const totalH = 7 * scale
  const offX = Math.round((size - totalW) / 2)
  const offY = Math.round((size - totalH) / 2)
  const drawGlyph = (glyph, gx) => {
    for (let r = 0; r < glyph.length; r++) {
      for (let c = 0; c < glyph[r].length; c++) {
        if (glyph[r][c] !== '1') continue
        for (let yy = 0; yy < scale; yy++)
          for (let xx = 0; xx < scale; xx++)
            setPx(offX + (gx + c) * scale + xx, offY + r * scale + yy, FG)
      }
    }
  }
  drawGlyph(GLYPHS.B, 0)
  drawGlyph(GLYPHS.L, 7)
  return encodePng(buf, size)
}

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

function encodePng(buf, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter byte
    for (let i = 0; i < size * 4; i++) raw[y * (size * 4 + 1) + 1 + i] = buf[y * size * 4 + i]
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Pack PNG images into a Windows .ico container (PNG-compressed entries). */
function buildIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const entries = []
  const datas = []
  let offset = 6 + count * 16
  for (const { size, png } of images) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size // width (0 => 256)
    e[1] = size >= 256 ? 0 : size // height
    e.writeUInt16LE(1, 4) // color planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    datas.push(png)
    offset += png.length
  }
  return Buffer.concat([header, ...entries, ...datas])
}

const buildDir = join(__dirname, '..', 'build')
mkdirSync(buildDir, { recursive: true })

const png512 = renderPng(512)
writeFileSync(join(buildDir, 'icon.png'), png512)
console.log('Wrote build/icon.png', png512.length, 'bytes')

const ico = buildIco([256, 128, 64, 48, 32, 16].map((size) => ({ size, png: renderPng(size) })))
writeFileSync(join(buildDir, 'icon.ico'), ico)
console.log('Wrote build/icon.ico', ico.length, 'bytes')
