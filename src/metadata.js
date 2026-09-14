import exifr from 'exifr'

const HEIC_BRANDS = new Set(['heic', 'heif', 'heix', 'hevc', 'mif1', 'msf1', 'heim', 'heis'])

const PARSE_OPTIONS = {
  tiff: true,
  xmp: true,
  iptc: true,
  jfif: false,
  icc: false,
  ihdr: false,
  gps: true,
  interop: false,
  // Never surface serials / maker notes in the panel model.
  makerNote: false,
  userComment: true,
  mergeOutput: true,
  sanitize: true,
  reviveValues: true,
  translateKeys: true,
  translateValues: true,
}

const HEIC_FAIL_NOTE =
  'This looks like a HEIC photo, and we couldn’t read its hidden notes reliably. You can still hide things in the picture. To check location and other notes, export or share as JPEG from Photos, then open that file here.'

const HEIC_EMPTY_NOTE =
  'We didn’t find location, date, captions, or camera on this HEIC file. Some of those notes don’t always show up for HEIC here. For a fuller check, export or share as JPEG from Photos, then open that file here.'

const UNREADABLE_NOTE =
  'This photo couldn’t be opened in this browser. Try export or share as JPEG from Photos, then open that file here.'

export function emptySnapshot(partial = {}) {
  return {
    sourceName: '',
    sourceType: '',
    heic: false,
    warning: null,
    location: emptyLocation(),
    date: emptyDate(),
    caption: emptyCaption(),
    camera: emptyCamera(),
    ...partial,
  }
}

function emptyLocation() {
  return {
    found: false,
    keep: false,
    latitude: null,
    longitude: null,
    city: '',
    sublocation: '',
    state: '',
    country: '',
  }
}

function emptyDate() {
  return { found: false, keep: false, iso: '' }
}

function emptyCaption() {
  return { found: false, keep: false, title: '', caption: '', keywords: '' }
}

function emptyCamera() {
  return { found: false, keep: false, make: '', model: '' }
}

export function isHeicLike(file) {
  if (!file) return false
  const type = String(file.type || '').toLowerCase()
  const name = String(file.name || '').toLowerCase()
  if (type.includes('heic') || type.includes('heif')) return true
  return name.endsWith('.heic') || name.endsWith('.heif') || name.endsWith('.hif')
}

export function sniffHeic(bytes) {
  if (!bytes || bytes.length < 12) return false
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
  return HEIC_BRANDS.has(brand)
}

export function imageOpenErrorNote(file) {
  if (isHeicLike(file)) return UNREADABLE_NOTE
  return 'This photo couldn’t be opened. Try another file, or export it as JPEG and open that.'
}

function firstString(obj, keys) {
  if (!obj) return ''
  for (const key of keys) {
    const text = asText(obj[key])
    if (text) return text
  }
  return ''
}

function asText(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (value instanceof Date) return ''
  if (ArrayBuffer.isView(value)) return ''
  if (Array.isArray(value)) {
    return value.map(asText).filter(Boolean).join(', ')
  }
  if (typeof value === 'object') {
    if (typeof value.description === 'string' && value.description.trim()) return value.description.trim()
    if (typeof value.value === 'string' && value.value.trim()) return value.value.trim()
    return ''
  }
  return ''
}

function pickGps(parsed) {
  const lat = Number(parsed.latitude)
  const lon = Number(parsed.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { latitude: lat, longitude: lon }
  }
  return { latitude: null, longitude: null }
}

function flattenLocationCreated(parsed) {
  const created = parsed.LocationCreated || parsed.LocationShown
  if (!created) return parsed
  const first = Array.isArray(created) ? created[0] : created
  if (!first || typeof first !== 'object') return parsed
  return { ...parsed, ...first }
}

function pickPlace(parsed) {
  const bag = flattenLocationCreated(parsed)
  return {
    city: firstString(bag, ['City', 'photoshop:City']),
    sublocation: firstString(bag, ['Sublocation', 'Sub-location', 'SubLocation', 'LocationName']),
    state: firstString(bag, ['ProvinceOrState', 'Province/State', 'ProvinceState', 'State', 'Region']),
    country: firstString(bag, [
      'Country',
      'CountryName',
      'Country/Primary Location Name',
      'Country-PrimaryLocationName',
      'CountryPrimaryLocationName',
    ]),
  }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

export function toLocalInput(date) {
  if (!(date instanceof Date) || isNaN(date)) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export function parseLocalDate(iso) {
  if (!iso) return null
  if (iso instanceof Date) return isNaN(iso) ? null : iso
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(iso))
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
  const exif = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(iso))
  if (exif) return new Date(+exif[1], +exif[2] - 1, +exif[3], +exif[4], +exif[5], +exif[6])
  const d = new Date(iso)
  return isNaN(d) ? null : d
}

export function toExifDate(iso) {
  const d = parseLocalDate(iso)
  if (!d) return ''
  return `${d.getFullYear()}:${pad2(d.getMonth() + 1)}:${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function pickDate(parsed) {
  const v = parsed.DateTimeOriginal ?? parsed.CreateDate ?? parsed.DateTime ?? parsed.DateCreated ?? parsed.DateTimeDigitized
  if (v instanceof Date && !isNaN(v)) return toLocalInput(v)
  if (typeof v === 'string' && v.trim()) {
    const d = parseLocalDate(v)
    return d ? toLocalInput(d) : ''
  }
  return ''
}

function pickKeywords(parsed) {
  const raw = parsed.Keywords ?? parsed.Subject ?? parsed.XPKeywords
  if (raw == null || raw === '') return ''
  if (Array.isArray(raw)) return raw.map(asText).filter(Boolean).join(', ')
  return asText(raw)
}

function anyAllowlist(snap) {
  return snap.location.found || snap.date.found || snap.caption.found || snap.camera.found
}

function snapshotFromParsed(parsed, file, heic) {
  const gps = pickGps(parsed || {})
  const place = pickPlace(parsed || {})
  const location = {
    ...emptyLocation(),
    ...gps,
    ...place,
  }
  location.found = locationHasValues(location)

  const iso = pickDate(parsed || {})
  const date = { ...emptyDate(), iso, found: Boolean(iso) }

  const caption = {
    ...emptyCaption(),
    title: firstString(parsed, ['ObjectName', 'Title', 'Headline', 'XPTitle']),
    caption: firstString(parsed, [
      'ImageDescription',
      'Description',
      'Caption',
      'Caption/Abstract',
      'XPComment',
      'UserComment',
      'Comment',
    ]),
    keywords: pickKeywords(parsed || {}),
  }
  caption.found = Boolean(caption.title || caption.caption || caption.keywords)

  const camera = {
    ...emptyCamera(),
    make: firstString(parsed, ['Make']),
    model: firstString(parsed, ['Model']),
  }
  camera.found = Boolean(camera.make || camera.model)

  const snap = emptySnapshot({
    sourceName: file?.name || '',
    sourceType: file?.type || '',
    heic,
    location,
    date,
    caption,
    camera,
  })

  if (heic && !anyAllowlist(snap)) {
    snap.warning = { code: 'heic-empty', message: HEIC_EMPTY_NOTE }
  }
  return snap
}

async function toBytes(file) {
  if (!file) return null
  if (file instanceof Uint8Array) return file
  if (file instanceof ArrayBuffer) return new Uint8Array(file)
  if (typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(file)) {
    return new Uint8Array(file)
  }
  if (typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer())
  }
  return file
}

export async function parsePhotoMetadata(file) {
  const heic = isHeicLike(file)
  const base = emptySnapshot({
    sourceName: file?.name || '',
    sourceType: file?.type || '',
    heic,
  })
  if (!file) return base
  try {
    const bytes = await toBytes(file)
    if (bytes instanceof Uint8Array && sniffHeic(bytes)) base.heic = true
    const parsed = await exifr.parse(bytes, PARSE_OPTIONS)
    return snapshotFromParsed(parsed || {}, file, base.heic)
  } catch {
    if (heic || base.heic) {
      return { ...base, warning: { code: 'heic-fail', message: HEIC_FAIL_NOTE } }
    }
    return base
  }
}

export function locationHasValues(loc) {
  if (!loc) return false
  const lat = Number(loc.latitude)
  const lon = Number(loc.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lon)) return true
  return [loc.city, loc.sublocation, loc.state, loc.country].some((s) => String(s || '').trim())
}

export function captionHasValues(cap) {
  if (!cap) return false
  return [cap.title, cap.caption, cap.keywords].some((s) => String(s || '').trim())
}

export function cameraHasValues(cam) {
  if (!cam) return false
  return [cam.make, cam.model].some((s) => String(s || '').trim())
}

export function hasKeptAllowlist(meta) {
  if (!meta) return false
  if (meta.location?.keep && locationHasValues(meta.location)) return true
  if (meta.date?.keep && String(meta.date.iso || '').trim()) return true
  if (meta.caption?.keep && captionHasValues(meta.caption)) return true
  if (meta.camera?.keep && cameraHasValues(meta.camera)) return true
  return false
}

export function formatCoords(lat, lon) {
  const la = Number(lat)
  const lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return ''
  const ns = la >= 0 ? 'N' : 'S'
  const ew = lo >= 0 ? 'E' : 'W'
  return `${Math.abs(la).toFixed(5)}° ${ns}, ${Math.abs(lo).toFixed(5)}° ${ew}`
}

export function formatPlace(loc) {
  if (!loc) return ''
  return [loc.sublocation, loc.city, loc.state, loc.country].map((s) => String(s || '').trim()).filter(Boolean).join(', ')
}

export function formatDateDisplay(iso) {
  const d = parseLocalDate(iso)
  if (!d) return ''
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatCamera(cam) {
  if (!cam) return ''
  return [cam.make, cam.model].map((s) => String(s || '').trim()).filter(Boolean).join(' ')
}

export function formatCaptionSummary(cap) {
  if (!cap) return ''
  return [cap.title, cap.caption, cap.keywords].map((s) => String(s || '').trim()).filter(Boolean).join(' · ')
}

export function datetimeLocalValue(iso) {
  const s = String(iso || '')
  return s.length >= 16 ? s.slice(0, 16) : s
}
