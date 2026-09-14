import piexifImport from 'piexifjs'
import { hasKeptAllowlist, toExifDate } from './metadata.js'

function getPiexif() {
  if (piexifImport && typeof piexifImport.dump === 'function') return piexifImport
  if (piexifImport?.default && typeof piexifImport.default.dump === 'function') return piexifImport.default
  if (piexifImport?.piexif && typeof piexifImport.piexif.dump === 'function') return piexifImport.piexif
  throw new Error('piexifjs failed to load')
}

export function bytesToBinaryString(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < u8.length; i += chunk) {
    out += String.fromCharCode.apply(null, u8.subarray(i, i + chunk))
  }
  return out
}

export function binaryStringToBytes(str) {
  const out = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff
  return out
}

function concatBytes(parts) {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function iptcDataset(record, dataset, text) {
  const enc = new TextEncoder().encode(text)
  if (enc.length > 32767) throw new Error('IPTC field too long')
  const out = new Uint8Array(5 + enc.length)
  out[0] = 0x1c
  out[1] = record
  out[2] = dataset
  out[3] = (enc.length >> 8) & 0xff
  out[4] = enc.length & 0xff
  out.set(enc, 5)
  return out
}

/** IPTC IIM with UTF-8 charset (ESC % G). */
export function encodeIptc({ title, keywords, caption, city, sublocation, state, country } = {}) {
  const parts = [new Uint8Array([0x1c, 0x01, 0x5a, 0x00, 0x03, 0x1b, 0x25, 0x47])]
  const add = (ds, value) => {
    const s = String(value || '').trim()
    if (s) parts.push(iptcDataset(2, ds, s))
  }
  add(5, title)
  if (keywords) {
    for (const kw of String(keywords).split(/[,;]/)) add(25, kw)
  }
  add(90, city)
  add(92, sublocation)
  add(95, state)
  add(101, country)
  add(120, caption)
  if (parts.length === 1) return null
  return concatBytes(parts)
}

export function wrapIptcApp13(iptc) {
  const header = new TextEncoder().encode('Photoshop 3.0\0')
  const bim = new Uint8Array([0x38, 0x42, 0x49, 0x4d]) // 8BIM
  const id = new Uint8Array([0x04, 0x04])
  const name = new Uint8Array([0x00, 0x00])
  const size = iptc.length
  const sizeBytes = new Uint8Array([
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
  ])
  const pad = size % 2 ? new Uint8Array([0]) : new Uint8Array(0)
  return concatBytes([header, bim, id, name, sizeBytes, iptc, pad])
}

/** Insert an APPn payload (without the 0xFF marker / length) after existing APP/COM segments. */
export function insertJpegAppSegment(jpeg, marker, payload) {
  const src = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg)
  if (src.length < 2 || src[0] !== 0xff || src[1] !== 0xd8) throw new Error('Not a JPEG')
  let i = 2
  while (i + 3 < src.length && src[i] === 0xff) {
    const m = src[i + 1]
    if (m === 0xda || m === 0xd9) break
    if ((m >= 0xe0 && m <= 0xef) || m === 0xfe) {
      const len = (src[i + 2] << 8) | src[i + 3]
      i += 2 + len
      continue
    }
    if (m === 0x00 || m === 0xff) {
      i += 1
      continue
    }
    break
  }
  const segLen = payload.length + 2
  if (segLen > 65535) throw new Error('JPEG APP segment too large')
  const seg = new Uint8Array(4 + payload.length)
  seg[0] = 0xff
  seg[1] = marker
  seg[2] = (segLen >> 8) & 0xff
  seg[3] = segLen & 0xff
  seg.set(payload, 4)
  const out = new Uint8Array(src.length + seg.length)
  out.set(src.subarray(0, i), 0)
  out.set(seg, i)
  out.set(src.subarray(i), i + seg.length)
  return out
}

function finiteCoord(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Write only allowlisted fields onto a freshly encoded JPEG.
 * Never loads or copies tags from an original file — no thumbnail, maker notes, or GPS IFD clone.
 */
export function writeAllowlistJpeg(jpegBytes, meta) {
  const piexif = getPiexif()
  const zeroth = {}
  const exif = {}
  const gps = {}

  if (meta?.camera?.keep) {
    const make = String(meta.camera.make || '').trim()
    const model = String(meta.camera.model || '').trim()
    if (make) zeroth[piexif.ImageIFD.Make] = make
    if (model) zeroth[piexif.ImageIFD.Model] = model
  }

  if (meta?.date?.keep && meta.date.iso) {
    const dt = toExifDate(meta.date.iso)
    if (dt) {
      zeroth[piexif.ImageIFD.DateTime] = dt
      exif[piexif.ExifIFD.DateTimeOriginal] = dt
      exif[piexif.ExifIFD.DateTimeDigitized] = dt
    }
  }

  if (meta?.caption?.keep) {
    const desc = String(meta.caption.caption || meta.caption.title || '').trim()
    if (desc) zeroth[piexif.ImageIFD.ImageDescription] = desc
  }

  if (meta?.location?.keep) {
    const lat = finiteCoord(meta.location.latitude)
    const lon = finiteCoord(meta.location.longitude)
    if (lat != null && lon != null) {
      gps[piexif.GPSIFD.GPSVersionID] = [2, 3, 0, 0]
      gps[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? 'N' : 'S'
      gps[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(lat)
      gps[piexif.GPSIFD.GPSLongitudeRef] = lon >= 0 ? 'E' : 'W'
      gps[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(lon)
    }
  }

  const hasExif =
    Object.keys(zeroth).length > 0 || Object.keys(exif).length > 0 || Object.keys(gps).length > 0

  let outBytes = jpegBytes instanceof Uint8Array ? jpegBytes : new Uint8Array(jpegBytes)
  if (hasExif) {
    // Pixels are already upright on the canvas — record that, never copy original Orientation.
    zeroth[piexif.ImageIFD.Orientation] = 1
    const exifObj = { '0th': zeroth, Exif: exif }
    if (Object.keys(gps).length) exifObj.GPS = gps
    // Deliberately omit "1st" and "thumbnail".
    const dumped = piexif.dump(exifObj)
    const inserted = piexif.insert(dumped, bytesToBinaryString(outBytes))
    outBytes = binaryStringToBytes(inserted)
  }

  const iptc = encodeIptc({
    title: meta?.caption?.keep ? meta.caption.title : '',
    caption: meta?.caption?.keep ? meta.caption.caption : '',
    keywords: meta?.caption?.keep ? meta.caption.keywords : '',
    city: meta?.location?.keep ? meta.location.city : '',
    sublocation: meta?.location?.keep ? meta.location.sublocation : '',
    state: meta?.location?.keep ? meta.location.state : '',
    country: meta?.location?.keep ? meta.location.country : '',
  })
  if (iptc) outBytes = insertJpegAppSegment(outBytes, 0xed, wrapIptcApp13(iptc))
  return outBytes
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    const done = (blob) => {
      if (!blob) reject(new Error('Could not encode image'))
      else resolve(blob)
    }
    if (canvas.toBlob) canvas.toBlob(done, type, quality)
    else {
      try {
        const url = canvas.toDataURL(type, quality)
        const bin = atob(url.split(',')[1] || '')
        const bytes = binaryStringToBytes(bin)
        done(new Blob([bytes], { type }))
      } catch (err) {
        reject(err)
      }
    }
  })
}

export function exportFileName(fileName, meta) {
  const stem = String(fileName || 'redacted').replace(/\.[^.]+$/, '')
  return hasKeptAllowlist(meta) ? `${stem}.jpg` : `${stem}.png`
}

/**
 * Encode a new image from redacted canvas pixels, then write only kept allowlist fields.
 * PNG when everything is stripped (current privacy default). JPEG when any allowlist field is kept.
 */
export async function exportRedactedImage(canvas, meta, fileName) {
  const jpeg = hasKeptAllowlist(meta)
  const name = exportFileName(fileName, meta)
  if (!jpeg) {
    const blob = await canvasToBlob(canvas, 'image/png')
    return { blob, fileName: name, mime: 'image/png' }
  }
  const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
  const buf = new Uint8Array(await jpegBlob.arrayBuffer())
  const withMeta = writeAllowlistJpeg(buf, meta)
  return { blob: new Blob([withMeta], { type: 'image/jpeg' }), fileName: name, mime: 'image/jpeg' }
}
