#!/usr/bin/env node
/**
 * Fixture proof: dirty JPEG (GPS, IPTC city, XMP location, maker notes, serials,
 * embedded thumbnail) → encode a *new* JPEG from clean pixels + allowlist decisions.
 * Remove location must drop GPS/place; keep camera must not bring serials back.
 */
import { createRequire } from 'node:module'
import { parsePhotoMetadata } from '../src/metadata.js'
import {
  binaryStringToBytes,
  bytesToBinaryString,
  encodeIptc,
  insertJpegAppSegment,
  wrapIptcApp13,
  writeAllowlistJpeg,
} from '../src/exportImage.js'
import exifr from 'exifr'

const require = createRequire(import.meta.url)
const piexif = require('piexifjs')

const MINI_JPEG = binaryStringToBytes(atob(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIQAxAAAAH/2Q=='
))

let failed = 0
function assert(cond, msg) {
  if (cond) console.log(`  ok  ${msg}`)
  else {
    failed++
    console.error(`  FAIL ${msg}`)
  }
}

function containsAscii(bytes, s) {
  return bytesToBinaryString(bytes).includes(s)
}

function buildDirtyJpeg() {
  const zeroth = {}
  const exif = {}
  const gps = {}
  zeroth[piexif.ImageIFD.Make] = 'Canon'
  zeroth[piexif.ImageIFD.Model] = 'EOS R5'
  zeroth[piexif.ImageIFD.CameraSerialNumber] = 'CAMSERIAL'
  zeroth[piexif.ImageIFD.HostComputer] = 'SECRET-HOST'
  zeroth[piexif.ImageIFD.Software] = 'SneakySoft'
  exif[piexif.ExifIFD.MakerNote] = 'SECRET_MAKERNOTE'
  exif[piexif.ExifIFD.BodySerialNumber] = 'SERIAL123'
  exif[piexif.ExifIFD.LensSerialNumber] = 'LENS456'
  exif[piexif.ExifIFD.CameraOwnerName] = 'OWNERNAME'
  exif[piexif.ExifIFD.ImageUniqueID] = 'UNIQUEID123456789012345678901234'
  gps[piexif.GPSIFD.GPSVersionID] = [2, 3, 0, 0]
  gps[piexif.GPSIFD.GPSLatitudeRef] = 'N'
  gps[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(40.6782)
  gps[piexif.GPSIFD.GPSLongitudeRef] = 'W'
  gps[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(73.9442)
  gps[piexif.GPSIFD.GPSProcessingMethod] = 'SECRET_GPS_METHOD'
  gps[piexif.GPSIFD.GPSDestLatitudeRef] = 'N'
  gps[piexif.GPSIFD.GPSDestLatitude] = piexif.GPSHelper.degToDmsRational(51.5)
  const thumb = bytesToBinaryString(MINI_JPEG)
  const first = {}
  first[piexif.ImageIFD.Compression] = 6
  first[piexif.ImageIFD.JPEGInterchangeFormat] = 0
  first[piexif.ImageIFD.JPEGInterchangeFormatLength] = 0
  const dumped = piexif.dump({
    '0th': zeroth,
    Exif: exif,
    GPS: gps,
    '1st': first,
    thumbnail: thumb,
  })
  let jpeg = binaryStringToBytes(piexif.insert(dumped, bytesToBinaryString(MINI_JPEG)))

  const iptc = encodeIptc({
    city: 'Brooklyn',
    state: 'New York',
    country: 'United States',
    sublocation: '4th Ave',
    caption: 'Family porch',
    title: 'Hidden title',
    keywords: 'kids, home',
  })
  jpeg = insertJpegAppSegment(jpeg, 0xed, wrapIptcApp13(iptc))

  const ns = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/')
  const xml = new TextEncoder().encode(
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:City="XmpHiddenCity" photoshop:Country="XmpHiddenCountry"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  )
  const xmp = new Uint8Array(ns.length + 1 + xml.length)
  xmp.set(ns, 0)
  xmp[ns.length] = 0
  xmp.set(xml, ns.length + 1)
  jpeg = insertJpegAppSegment(jpeg, 0xe1, xmp)
  return jpeg
}

const SECRETS = [
  'Brooklyn',
  '4th Ave',
  'SERIAL123',
  'LENS456',
  'CAMSERIAL',
  'SECRET_MAKERNOTE',
  'SECRET-HOST',
  'SneakySoft',
  'OWNERNAME',
  'UNIQUEID123456789012345678901234',
  'SECRET_GPS_METHOD',
  'XmpHiddenCity',
  'XmpHiddenCountry',
  'Family porch',
]

async function parseAll(bytes) {
  return exifr.parse(bytes, {
    tiff: true,
    xmp: true,
    iptc: true,
    gps: true,
    mergeOutput: true,
    sanitize: false,
    reviveValues: true,
    makerNote: true,
    userComment: true,
  })
}

const dirty = buildDirtyJpeg()
const dirtyFile = new File([dirty], 'dirty.jpg', { type: 'image/jpeg' })

console.log('dirty JPEG fixture')
const dirtyParsed = await parseAll(dirty)
assert(dirtyParsed?.latitude && Math.abs(dirtyParsed.latitude - 40.6782) < 0.001, 'dirty has GPS latitude')
assert(dirtyParsed?.longitude && Math.abs(Math.abs(dirtyParsed.longitude) - 73.9442) < 0.001, 'dirty has GPS longitude')
assert(containsAscii(dirty, 'Brooklyn'), 'dirty bytes contain IPTC city')
assert(containsAscii(dirty, 'XmpHiddenCity'), 'dirty bytes contain XMP city')
assert(containsAscii(dirty, 'SECRET_MAKERNOTE'), 'dirty bytes contain maker note')
assert(containsAscii(dirty, 'SERIAL123'), 'dirty bytes contain body serial')
const dirtyThumb = await exifr.thumbnail(dirty)
assert(Boolean(dirtyThumb && dirtyThumb.length), 'dirty has an embedded thumbnail')

const snap = await parsePhotoMetadata(dirtyFile)
console.log('\nparser (panel model)')
assert(snap.location.found, 'panel sees a location')
assert(!snap.location.keep, 'location defaults to Remove')
assert(snap.camera.found && snap.camera.make === 'Canon', 'panel sees camera make')
assert(!snap.camera.keep, 'camera defaults to Remove')
assert(snap.caption.found, 'panel sees caption/title')
assert(snap.date.found === false || typeof snap.date.iso === 'string', 'date field is present on the model')

console.log('\nexport: Remove location, Keep camera (from clean pixels, not the original file)')
snap.camera.keep = true
const outKeepCam = writeAllowlistJpeg(MINI_JPEG, snap)
const outParsed = await parseAll(outKeepCam)
assert(!(outParsed && Number.isFinite(outParsed.latitude)), 'output has no GPS latitude')
assert(!(outParsed && Number.isFinite(outParsed.longitude)), 'output has no GPS longitude')
assert(outParsed?.Make === 'Canon', 'kept Make is written as text')
assert(outParsed?.Model === 'EOS R5', 'kept Model is written as text')
assert(!outParsed?.BodySerialNumber && !outParsed?.SerialNumber, 'no body serial on output')
assert(!outParsed?.MakerNote, 'no maker note on output')
assert(!outParsed?.CameraSerialNumber, 'no camera serial on output')
assert(!outParsed?.HostComputer, 'no host computer on output')
assert(!outParsed?.Software, 'no software tag on output')
assert(!outParsed?.City && !outParsed?.['photoshop:City'], 'no IPTC/XMP city on output')
const outThumb = await exifr.thumbnail(outKeepCam)
assert(!outThumb, 'no embedded thumbnail on output')
for (const secret of SECRETS) {
  assert(!containsAscii(outKeepCam, secret), `output bytes do not contain ${secret}`)
}

console.log('\nexport: all Remove (strip-all default)')
const strippedSnap = await parsePhotoMetadata(dirtyFile)
const outStripped = writeAllowlistJpeg(MINI_JPEG, strippedSnap)
const strippedParsed = await parseAll(outStripped)
assert(!strippedParsed || Object.keys(strippedParsed).length === 0 || !strippedParsed.Make, 'strip-all writes no camera')
assert(!(strippedParsed && Number.isFinite(strippedParsed.latitude)), 'strip-all writes no GPS')
for (const secret of SECRETS) {
  assert(!containsAscii(outStripped, secret), `strip-all bytes do not contain ${secret}`)
}

console.log('\nexport: Keep location with edited pin + place (not a GPS IFD copy)')
const locSnap = await parsePhotoMetadata(dirtyFile)
locSnap.location.keep = true
locSnap.location.latitude = 41.0
locSnap.location.longitude = -74.0
locSnap.location.city = 'Park Slope'
locSnap.location.sublocation = ''
locSnap.location.state = 'NY'
locSnap.location.country = 'USA'
const outLoc = writeAllowlistJpeg(MINI_JPEG, locSnap)
const locParsed = await parseAll(outLoc)
assert(locParsed && Math.abs(locParsed.latitude - 41.0) < 0.001, 'kept location writes edited latitude')
assert(locParsed && Math.abs(locParsed.longitude - -74.0) < 0.001, 'kept location writes edited longitude')
assert(locParsed?.City === 'Park Slope', 'kept location writes chosen place text')
assert(!containsAscii(outLoc, 'Brooklyn'), 'original IPTC city is not copied')
assert(!containsAscii(outLoc, 'XmpHiddenCity'), 'original XMP city is not copied')
assert(!containsAscii(outLoc, 'SECRET_GPS_METHOD'), 'original GPSProcessingMethod is not copied')
assert(!containsAscii(outLoc, 'SERIAL123'), 'serials still absent when keeping location')
const locThumb = await exifr.thumbnail(outLoc)
assert(!locThumb, 'no original thumbnail when keeping location')

if (failed) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nall assertions passed')
