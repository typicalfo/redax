import { useRef, useState, useEffect } from 'react'
import MetadataPanel from './MetadataPanel.jsx'
import { emptySnapshot, imageOpenErrorNote, parsePhotoMetadata } from './metadata.js'
import { exportRedactedImage } from './exportImage.js'

let nextId = 1

// --- Geometry helpers ---
function rotPt(px, py, cx, cy, a) {
  const cos = Math.cos(a), sin = Math.sin(a), dx = px - cx, dy = py - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

// --- Shape helpers ---
function clipShape(ctx, shape, x, y, w, h) {
  ctx.beginPath()
  if (shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2) || 1, Math.abs(h / 2) || 1, 0, 0, Math.PI * 2)
  else if (shape === 'rounded') ctx.roundRect(x, y, w, h, Math.min(Math.abs(w), Math.abs(h)) * 0.25)
  else ctx.rect(x, y, w, h)
}

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

function drawChunky(ctx, x, y, w, h, blockSize, seed) {
  const rng = mulberry32(seed)
  for (let r = 0; r < Math.ceil(h / blockSize); r++) {
    for (let c = 0; c < Math.ceil(w / blockSize); c++) {
      const v = rng()
      if (v < 0.33) ctx.fillStyle = '#000'
      else if (v < 0.66) ctx.fillStyle = '#fff'
      else continue
      ctx.fillRect(x + c * blockSize, y + r * blockSize, Math.min(blockSize, w - c * blockSize), Math.min(blockSize, h - r * blockSize))
    }
  }
}

// Detect ctx.filter support (Safari < 17.2 doesn't have it)
const supportsFilter = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d')
    c.filter = 'blur(1px)'
    return c.filter === 'blur(1px)'
  } catch { return false }
})()

// Fallback blur via repeated downscale/upscale (works everywhere)
function blurRegion(ctx, canvas, sx, sy, sw, sh, amount) {
  if (sw < 1 || sh < 1) return
  sx = Math.max(0, Math.round(sx)); sy = Math.max(0, Math.round(sy))
  sw = Math.min(Math.round(sw), canvas.width - sx); sh = Math.min(Math.round(sh), canvas.height - sy)
  if (sw < 1 || sh < 1) return
  const steps = Math.max(2, Math.ceil(amount / 4))
  const scale = Math.max(1, Math.round(amount / 2))
  const tw = Math.max(1, Math.ceil(sw / scale)), th = Math.max(1, Math.ceil(sh / scale))
  const tmp = document.createElement('canvas')
  tmp.width = tw; tmp.height = th
  const tc = tmp.getContext('2d')
  tc.drawImage(canvas, sx, sy, sw, sh, 0, 0, tw, th)
  // Multiple passes of down/up for smoother blur
  for (let i = 1; i < steps; i++) {
    const s = Math.max(1, Math.ceil(tw / 2)), t = Math.max(1, Math.ceil(th / 2))
    const tmp2 = document.createElement('canvas')
    tmp2.width = s; tmp2.height = t
    tmp2.getContext('2d').drawImage(tmp, 0, 0, s, t)
    tc.clearRect(0, 0, tw, th)
    tc.drawImage(tmp2, 0, 0, tw, th)
  }
  ctx.drawImage(tmp, 0, 0, tw, th, sx, sy, sw, sh)
}

// --- Brush helpers ---
function getBrushBBox(r) {
  if (!r.points || r.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const half = r.brushSize / 2
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of r.points) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y
  }
  return { x: minX - half, y: minY - half, w: maxX - minX + r.brushSize, h: maxY - minY + r.brushSize }
}

function pointNearBrushPath(px, py, r) {
  const half = r.brushSize / 2
  for (let i = 0; i < r.points.length; i++) {
    if (Math.hypot(px - r.points[i].x, py - r.points[i].y) <= half) return true
    if (i > 0) {
      const a = r.points[i - 1], b = r.points[i]
      const dx = b.x - a.x, dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      if (len2 === 0) continue
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2))
      if (Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)) <= half) return true
    }
  }
  return false
}

function applyBrushEffect(ctx, canvas, r) {
  if (!r.points || r.points.length < 1) return
  const color = r.mode === 'redact' ? (r.color || '#000') : r.mode === 'erase' ? '#fff' : null
  if (color) {
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = r.brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(r.points[0].x, r.points[0].y)
    for (let i = 1; i < r.points.length; i++) ctx.lineTo(r.points[i].x, r.points[i].y)
    if (r.points.length === 1) ctx.lineTo(r.points[0].x + 0.1, r.points[0].y)
    ctx.stroke()
    ctx.restore()
    return
  }
  // blur mode
  const bbox = getBrushBBox(r)
  const m = (r.blurAmount || 20) * 3
  const sx = Math.max(0, Math.floor(bbox.x - m))
  const sy = Math.max(0, Math.floor(bbox.y - m))
  const ex = Math.min(canvas.width, Math.ceil(bbox.x + bbox.w + m))
  const ey = Math.min(canvas.height, Math.ceil(bbox.y + bbox.h + m))
  const sw = ex - sx, sh = ey - sy
  if (sw < 1 || sh < 1) return
  const tmp = document.createElement('canvas')
  tmp.width = sw; tmp.height = sh
  const tc = tmp.getContext('2d')
  if (supportsFilter) {
    tc.filter = `blur(${r.blurAmount}px)`
    tc.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
    tc.filter = 'none'
  } else {
    tc.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
    blurRegion(tc, tmp, 0, 0, sw, sh, r.blurAmount)
  }
  const mask = document.createElement('canvas')
  mask.width = sw; mask.height = sh
  const mc = mask.getContext('2d')
  mc.strokeStyle = '#fff'
  mc.lineWidth = r.brushSize
  mc.lineCap = 'round'
  mc.lineJoin = 'round'
  mc.beginPath()
  mc.moveTo(r.points[0].x - sx, r.points[0].y - sy)
  for (let i = 1; i < r.points.length; i++) mc.lineTo(r.points[i].x - sx, r.points[i].y - sy)
  if (r.points.length === 1) mc.lineTo(r.points[0].x - sx + 0.1, r.points[0].y - sy)
  mc.stroke()
  tc.globalCompositeOperation = 'destination-in'
  tc.drawImage(mask, 0, 0)
  ctx.drawImage(tmp, 0, 0, sw, sh, sx, sy, sw, sh)
  if (r.chunky) {
    const tmp2 = document.createElement('canvas')
    tmp2.width = sw; tmp2.height = sh
    const t2c = tmp2.getContext('2d')
    drawChunky(t2c, 0, 0, sw, sh, r.chunkSize, r.seed)
    t2c.globalCompositeOperation = 'destination-in'
    t2c.drawImage(mask, 0, 0)
    ctx.drawImage(tmp2, 0, 0, sw, sh, sx, sy, sw, sh)
  }
}

function applyEffect(ctx, canvas, r) {
  if (r.type === 'brush') { applyBrushEffect(ctx, canvas, r); return }
  if (r.w < 2 || r.h < 2) return
  const angle = r.rotation || 0
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  ctx.save()
  ctx.translate(cx, cy); ctx.rotate(angle)
  clipShape(ctx, r.shape, -r.w / 2, -r.h / 2, r.w, r.h)
  ctx.clip()
  if (r.mode === 'redact') { ctx.fillStyle = r.color || '#000'; ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h) }
  else if (r.mode === 'erase') { ctx.fillStyle = '#fff'; ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h) }
  else if (supportsFilter) {
    ctx.rotate(-angle); ctx.translate(-cx, -cy)
    ctx.filter = `blur(${r.blurAmount}px)`
    const m = r.blurAmount * 3
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const corners = [[-r.w / 2, -r.h / 2], [r.w / 2, -r.h / 2], [r.w / 2, r.h / 2], [-r.w / 2, r.h / 2]]
    const xs = corners.map(([lx, ly]) => cx + lx * cos - ly * sin)
    const ys = corners.map(([lx, ly]) => cy + lx * sin + ly * cos)
    const minX = Math.min(...xs) - m, minY = Math.min(...ys) - m
    const maxX = Math.max(...xs) + m, maxY = Math.max(...ys) + m
    ctx.drawImage(canvas, minX, minY, maxX - minX, maxY - minY, minX, minY, maxX - minX, maxY - minY)
  } else {
    // Fallback: downscale blur for browsers without ctx.filter
    ctx.rotate(-angle); ctx.translate(-cx, -cy)
    const m = r.blurAmount * 2
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const corners = [[-r.w / 2, -r.h / 2], [r.w / 2, -r.h / 2], [r.w / 2, r.h / 2], [-r.w / 2, r.h / 2]]
    const xs = corners.map(([lx, ly]) => cx + lx * cos - ly * sin)
    const ys = corners.map(([lx, ly]) => cy + lx * sin + ly * cos)
    const minX = Math.min(...xs) - m, minY = Math.min(...ys) - m
    const maxX = Math.max(...xs) + m, maxY = Math.max(...ys) + m
    blurRegion(ctx, canvas, minX, minY, maxX - minX, maxY - minY, r.blurAmount)
  }
  ctx.restore()
  if (r.mode === 'blur' && r.chunky) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle)
    clipShape(ctx, r.shape, -r.w / 2, -r.h / 2, r.w, r.h); ctx.clip()
    drawChunky(ctx, -r.w / 2, -r.h / 2, r.w, r.h, r.chunkSize, r.seed); ctx.restore()
  }
}

function strokeShape(ctx, shape, x, y, w, h) {
  ctx.beginPath()
  if (shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2) || 1, Math.abs(h / 2) || 1, 0, 0, Math.PI * 2)
  else if (shape === 'rounded') ctx.roundRect(x, y, w, h, Math.min(Math.abs(w), Math.abs(h)) * 0.25)
  else ctx.rect(x, y, w, h)
  ctx.stroke()
}

function strokePreview(ctx, shape, x, y, w, h) {
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([8, 5])
  strokeShape(ctx, shape, x, y, w, h)
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.lineDashOffset = 6
  strokeShape(ctx, shape, x, y, w, h)
  ctx.setLineDash([]); ctx.lineDashOffset = 0
}

// --- Handle helpers ---
function getHandles(r) {
  const angle = r.rotation || 0
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const local = {
    tl: [r.x, r.y], tc: [r.x + r.w / 2, r.y], tr: [r.x + r.w, r.y],
    ml: [r.x, r.y + r.h / 2], mr: [r.x + r.w, r.y + r.h / 2],
    bl: [r.x, r.y + r.h], bc: [r.x + r.w / 2, r.y + r.h], br: [r.x + r.w, r.y + r.h],
  }
  const result = {}
  for (const [k, [lx, ly]] of Object.entries(local)) result[k] = rotPt(lx, ly, cx, cy, angle)
  return result
}

function getResizeInfo(handle, r) {
  const w = r.w, h = r.h, angle = r.rotation || 0
  const cx = r.x + w / 2, cy = r.y + h / 2
  const map = {
    tl: { fl: [r.x + w, r.y + h], rx: true, ry: true, ox: -w / 2, oy: -h / 2 },
    tc: { fl: [r.x + w / 2, r.y + h], rx: false, ry: true, ox: 0, oy: -h / 2 },
    tr: { fl: [r.x, r.y + h], rx: true, ry: true, ox: w / 2, oy: -h / 2 },
    ml: { fl: [r.x + w, r.y + h / 2], rx: true, ry: false, ox: -w / 2, oy: 0 },
    mr: { fl: [r.x, r.y + h / 2], rx: true, ry: false, ox: w / 2, oy: 0 },
    bl: { fl: [r.x + w, r.y], rx: true, ry: true, ox: -w / 2, oy: h / 2 },
    bc: { fl: [r.x + w / 2, r.y], rx: false, ry: true, ox: 0, oy: h / 2 },
    br: { fl: [r.x, r.y], rx: true, ry: true, ox: w / 2, oy: h / 2 },
  }
  const i = map[handle]
  const fs = rotPt(i.fl[0], i.fl[1], cx, cy, angle)
  return { fsx: fs.x, fsy: fs.y, rx: i.rx, ry: i.ry, ox: i.ox, oy: i.oy, angle }
}

const CURSORS = { tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize', tc: 'ns-resize', bc: 'ns-resize', ml: 'ew-resize', mr: 'ew-resize' }

function getRotHandlePos(region, hs) {
  const angle = region.rotation || 0
  const cx = region.x + region.w / 2, cy = region.y + region.h / 2
  return rotPt(region.x + region.w / 2, region.y - hs * 5, cx, cy, angle)
}

function getDeletePos(region, hs) {
  const angle = region.rotation || 0
  const cx = region.x + region.w / 2, cy = region.y + region.h / 2
  return rotPt(region.x + region.w, region.y - hs * 3.2, cx, cy, angle)
}

function drawHandlesUI(ctx, region, hs) {
  if (region.type === 'brush') {
    const bbox = getBrushBBox(region)
    strokePreview(ctx, 'rect', bbox.x, bbox.y, bbox.w, bbox.h)
    const del = { x: bbox.x + bbox.w + hs * 2, y: bbox.y - hs * 2 }
    const dr = hs * 1.6
    ctx.beginPath(); ctx.arc(del.x, del.y, dr, 0, Math.PI * 2); ctx.fillStyle = '#ef4444'; ctx.fill()
    const cr = dr * 0.4
    ctx.strokeStyle = '#fff'; ctx.lineWidth = hs * 0.35
    ctx.beginPath(); ctx.moveTo(del.x - cr, del.y - cr); ctx.lineTo(del.x + cr, del.y + cr)
    ctx.moveTo(del.x + cr, del.y - cr); ctx.lineTo(del.x - cr, del.y + cr); ctx.stroke()
    return
  }
  const angle = region.rotation || 0
  const cx = region.x + region.w / 2, cy = region.y + region.h / 2
  // Rotated outline
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle)
  strokePreview(ctx, region.shape, -region.w / 2, -region.h / 2, region.w, region.h)
  ctx.restore()
  // Resize handles
  const handles = getHandles(region)
  for (const p of Object.values(handles)) {
    ctx.beginPath(); ctx.arc(p.x, p.y, hs, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'; ctx.fill()
    ctx.strokeStyle = '#5fb4e4'; ctx.lineWidth = hs * 0.4; ctx.stroke()
  }
  // Rotation handle
  const tc = handles.tc
  const rh = getRotHandlePos(region, hs)
  ctx.beginPath(); ctx.moveTo(tc.x, tc.y); ctx.lineTo(rh.x, rh.y)
  ctx.strokeStyle = '#5fb4e4'; ctx.lineWidth = hs * 0.3; ctx.setLineDash([]); ctx.stroke()
  ctx.beginPath(); ctx.arc(rh.x, rh.y, hs, 0, Math.PI * 2)
  ctx.fillStyle = '#5fb4e4'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = hs * 0.3; ctx.stroke()
  // Delete button
  const del = getDeletePos(region, hs)
  const dr = hs * 1.6
  ctx.beginPath(); ctx.arc(del.x, del.y, dr, 0, Math.PI * 2); ctx.fillStyle = '#ef4444'; ctx.fill()
  const cr = dr * 0.4
  ctx.strokeStyle = '#fff'; ctx.lineWidth = hs * 0.35
  ctx.beginPath(); ctx.moveTo(del.x - cr, del.y - cr); ctx.lineTo(del.x + cr, del.y + cr)
  ctx.moveTo(del.x + cr, del.y - cr); ctx.lineTo(del.x - cr, del.y + cr); ctx.stroke()
}

// =============================================================
export default function App() {
  const canvasRef = useRef(null), wrapRef = useRef(null), fileRef = useRef(null), imgRef = useRef(null)
  const regionsRef = useRef([])
  const selectedIdRef = useRef(null)
  const dragRef = useRef({ type: 'none' })
  const historyRef = useRef([[]])
  const indexRef = useRef(0)
  const imageStackRef = useRef([]) // stores {img, regions, history, index} before destructive ops

  const [loaded, setLoaded] = useState(false)
  const [blurAmount, setBlurAmount] = useState(20)
  const [fileName, setFileName] = useState('blurred.png')
  const [fileDragging, setFileDragging] = useState(false)
  const [mode, setMode] = useState('blur')
  const [chunky, setChunky] = useState(false)
  const [chunkSize, setChunkSize] = useState(16)
  const [shape, setShape] = useState('rect')
  const [brushSize, setBrushSize] = useState(20)
  const [redactColor, setRedactColor] = useState('#000000')
  const [showAbout, setShowAbout] = useState(false)
  const [showMetadata, setShowMetadata] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [meta, setMeta] = useState(() => emptySnapshot())
  const [imageError, setImageError] = useState(null)
  const [warningDismissed, setWarningDismissed] = useState(false)
  const loadGenRef = useRef(0)
  const savingRef = useRef(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedId, _setSelectedId] = useState(null)
  const [cropping, _setCropping] = useState(false)
  const croppingRef = useRef(false)
  const setCropping = (v) => { croppingRef.current = v; _setCropping(v) }
  const cropRef = useRef(null)
  const [, forceUpdate] = useState(0)
  const showOriginalRef = useRef(false)

  const openAbout = () => { setShowMetadata(false); setShowAbout(true) }
  const openMetadata = () => { setShowAbout(false); setShowMetadata(true) }
  const closeModals = () => { setShowAbout(false); setShowMetadata(false) }
  const patchMeta = (key, part) => setMeta((m) => ({ ...m, [key]: { ...m[key], ...part } }))

  const setSelectedId = (id) => { selectedIdRef.current = id; _setSelectedId(id) }
  const getScale = () => { const c = canvasRef.current; if (!c) return 1; const r = c.getBoundingClientRect(); return c.width / (r.width || 1) }
  const getCoords = (e) => { const c = canvasRef.current, r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) } }

  // --- Render ---
  const render = (opts = {}) => {
    const canvas = canvasRef.current, img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    const { showUI = true, previewRegion, showOriginal = false } = opts
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    if (!showOriginal) {
      for (const r of regionsRef.current) applyEffect(ctx, canvas, r)
      if (previewRegion) {
        applyEffect(ctx, canvas, previewRegion)
        if (showUI && previewRegion.type !== 'brush') strokePreview(ctx, previewRegion.shape, previewRegion.x, previewRegion.y, previewRegion.w, previewRegion.h)
      }
    }
    if (showUI && selectedIdRef.current && !showOriginal) {
      const sel = regionsRef.current.find(r => r.id === selectedIdRef.current)
      if (sel) drawHandlesUI(ctx, sel, 6 * getScale())
    }
    // Crop overlay
    const crop = cropRef.current
    if (showUI && crop && !showOriginal) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, canvas.width, crop.y)
      ctx.fillRect(0, crop.y, crop.x, crop.h)
      ctx.fillRect(crop.x + crop.w, crop.y, canvas.width - crop.x - crop.w, crop.h)
      ctx.fillRect(0, crop.y + crop.h, canvas.width, canvas.height - crop.y - crop.h)
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * getScale(); ctx.setLineDash([])
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h)
    }
    // "Original" badge
    if (showOriginal && showUI) {
      const s = getScale()
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(8 * s, 8 * s, 80 * s, 28 * s)
      ctx.fillStyle = '#fff'; ctx.font = `${14 * s}px Inter, sans-serif`; ctx.fillText('Original', 16 * s, 27 * s)
    }
  }

  // --- History ---
  const commitRegions = (regs) => {
    historyRef.current = historyRef.current.slice(0, indexRef.current + 1)
    historyRef.current.push(structuredClone(regs))
    if (historyRef.current.length > 50) historyRef.current.shift()
    else indexRef.current++
    regionsRef.current = regs
    forceUpdate(n => n + 1)
  }
  const saveImageState = () => {
    imageStackRef.current.push({
      img: imgRef.current,
      regions: structuredClone(regionsRef.current),
      history: structuredClone(historyRef.current),
      index: indexRef.current,
    })
    if (imageStackRef.current.length > 20) imageStackRef.current.shift()
  }
  const canUndo = () => indexRef.current > 0 || imageStackRef.current.length > 0
  const canRedo = () => indexRef.current < historyRef.current.length - 1
  const undo = () => {
    if (indexRef.current > 0) {
      indexRef.current--; regionsRef.current = structuredClone(historyRef.current[indexRef.current]); setSelectedId(null); forceUpdate(n => n + 1)
    } else if (imageStackRef.current.length > 0) {
      const prev = imageStackRef.current.pop()
      imgRef.current = prev.img
      const canvas = canvasRef.current
      canvas.width = prev.img.width; canvas.height = prev.img.height
      regionsRef.current = prev.regions
      historyRef.current = prev.history
      indexRef.current = prev.index
      setSelectedId(null); setCropping(false); cropRef.current = null
      forceUpdate(n => n + 1); setTimeout(fitCanvas, 0)
    }
  }
  const redo = () => { if (!canRedo()) return; indexRef.current++; regionsRef.current = structuredClone(historyRef.current[indexRef.current]); setSelectedId(null); forceUpdate(n => n + 1) }

  useEffect(() => {
    if (!showAbout && !showMetadata && !showNotes) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (showAbout || showMetadata) closeModals()
      else if (showNotes) setShowNotes(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showAbout, showMetadata, showNotes])

  useEffect(() => {
    if (loaded) setTimeout(fitCanvas, 0)
  }, [showNotes, loaded])

  // Render after every React update
  useEffect(() => { if (loaded) render() })

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') { e.preventDefault(); redo() }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'v') { handleClipboardPaste() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdRef.current && document.activeElement === document.body) {
        e.preventDefault()
        commitRegions(regionsRef.current.filter(r => r.id !== selectedIdRef.current))
        setSelectedId(null)
      } else if (e.key === 'b' && document.activeElement === document.body) { setMode('blur') }
      else if (e.key === 'r' && document.activeElement === document.body) { setMode('redact') }
      else if (e.key === 'e' && document.activeElement === document.body) { setMode('erase') }
      else if (e.key === 'p' && document.activeElement === document.body) { setMode('brush') }
      else if (e.key === 'Escape') {
        if (croppingRef.current) { cropRef.current = null; setCropping(false); forceUpdate(n => n + 1) }
        setSelectedId(null)
      } else if (e.key === 'Alt') {
        e.preventDefault()
        if (imgRef.current && regionsRef.current.length > 0) {
          showOriginalRef.current = true; render({ showOriginal: true })
        }
      }
    }
    const handleKeyUp = (e) => {
      if (e.key === 'Alt' && showOriginalRef.current) {
        showOriginalRef.current = false; render()
      }
    }
    const handlePaste = (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const blob = item.getAsFile()
          if (blob) loadFile(new File([blob], 'pasted.png', { type: blob.type }))
          return
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    document.addEventListener('paste', handlePaste)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
      document.removeEventListener('paste', handlePaste)
    }
  }, [])

  const handleClipboardPaste = async () => {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imgType = item.types.find(t => t.startsWith('image/'))
        if (imgType) {
          const blob = await item.getType(imgType)
          loadFile(new File([blob], 'pasted.png', { type: imgType }))
          return
        }
      }
    } catch { /* clipboard API may not be available, fallback paste event handles it */ }
  }

  // Resize
  useEffect(() => {
    const onResize = () => {
      const canvas = canvasRef.current, img = imgRef.current, wrap = wrapRef.current
      if (!canvas || !img || !wrap) return
      const scale = Math.min(wrap.clientWidth / img.width, wrap.clientHeight / img.height, 1)
      canvas.style.width = (img.width * scale) + 'px'
      canvas.style.height = (img.height * scale) + 'px'
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const fitCanvas = () => {
    const canvas = canvasRef.current, img = imgRef.current, wrap = wrapRef.current
    if (!canvas || !img || !wrap) return
    const scale = Math.min(wrap.clientWidth / img.width, wrap.clientHeight / img.height, 1)
    canvas.style.width = (img.width * scale) + 'px'
    canvas.style.height = (img.height * scale) + 'px'
  }

  const loadFile = (file) => {
    const gen = ++loadGenRef.current
    setFileName(file.name.replace(/\.[^.]+$/, '') + '_blurred.png')
    setImageError(null)
    setWarningDismissed(false)
    setMeta(emptySnapshot({ sourceName: file.name, sourceType: file.type }))
    parsePhotoMetadata(file).then((snap) => {
      if (gen !== loadGenRef.current) return
      setMeta(snap)
    })
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        if (gen !== loadGenRef.current) return
        imgRef.current = img
        const canvas = canvasRef.current
        canvas.width = img.width; canvas.height = img.height
        regionsRef.current = []; historyRef.current = [[]]; indexRef.current = 0; nextId = 1
        setSelectedId(null); setLoaded(true)
        forceUpdate(n => n + 1); setTimeout(fitCanvas, 0)
      }
      img.onerror = () => {
        if (gen !== loadGenRef.current) return
        setLoaded(false)
        imgRef.current = null
        setImageError(imageOpenErrorNote(file))
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  }

  // --- Mouse: draw, move, resize ---
  const onMouseDown = (e) => {
    if (!imgRef.current) return
    const pos = getCoords(e), scale = getScale(), hs = 6 * scale, thr = hs * 1.5

    // Crop mode drag
    if (croppingRef.current) {
      dragRef.current = { type: 'cropping', sx: pos.x, sy: pos.y }
      cropRef.current = null
      attachDrag(); return
    }

    // Check selected region's delete button, rotation handle, and resize handles
    const selReg = selectedIdRef.current ? regionsRef.current.find(r => r.id === selectedIdRef.current) : null
    if (selReg) {
      const del = selReg.type === 'brush'
        ? (() => { const bb = getBrushBBox(selReg); return { x: bb.x + bb.w + hs * 2, y: bb.y - hs * 2 } })()
        : getDeletePos(selReg, hs)
      if (Math.hypot(pos.x - del.x, pos.y - del.y) < hs * 2.4) {
        commitRegions(regionsRef.current.filter(r => r.id !== selReg.id))
        setSelectedId(null); return
      }
      if (selReg.type !== 'brush') {
        const rh = getRotHandlePos(selReg, hs)
        if (Math.hypot(pos.x - rh.x, pos.y - rh.y) < thr) {
          const rcx = selReg.x + selReg.w / 2, rcy = selReg.y + selReg.h / 2
          dragRef.current = { type: 'rotating', regionId: selReg.id, startAngle: Math.atan2(pos.y - rcy, pos.x - rcx), origRotation: selReg.rotation || 0 }
          attachDrag(); return
        }
        const handles = getHandles(selReg)
        for (const [key, hp] of Object.entries(handles)) {
          if (Math.abs(pos.x - hp.x) < thr && Math.abs(pos.y - hp.y) < thr) {
            dragRef.current = { type: 'resizing', regionId: selReg.id, ...getResizeInfo(key, selReg) }
            attachDrag(); return
          }
        }
      }
    }
    // Check if clicking inside any region
    for (let i = regionsRef.current.length - 1; i >= 0; i--) {
      const r = regionsRef.current[i]
      if (r.type === 'brush') {
        if (pointNearBrushPath(pos.x, pos.y, r)) {
          setSelectedId(r.id)
          dragRef.current = { type: 'moving', regionId: r.id, lastX: pos.x, lastY: pos.y }
          attachDrag(); return
        }
      } else {
        const rcx = r.x + r.w / 2, rcy = r.y + r.h / 2
        const lp = rotPt(pos.x, pos.y, rcx, rcy, -(r.rotation || 0))
        if (lp.x >= r.x && lp.x <= r.x + r.w && lp.y >= r.y && lp.y <= r.y + r.h) {
          setSelectedId(r.id)
          dragRef.current = { type: 'moving', regionId: r.id, ox: pos.x - r.x, oy: pos.y - r.y }
          attachDrag(); return
        }
      }
    }
    // Start drawing new region
    setSelectedId(null)
    if (mode === 'brush') {
      dragRef.current = { type: 'brushing', points: [pos], mode: 'redact', brushSize, blurAmount, chunky, chunkSize, color: redactColor, seed: Math.floor(Math.random() * 2 ** 32) }
    } else {
      dragRef.current = { type: 'drawing', sx: pos.x, sy: pos.y, seed: Math.floor(Math.random() * 2 ** 32), mode, shape, blurAmount, chunky, chunkSize, color: redactColor }
    }
    attachDrag()
  }

  const attachDrag = () => {
    const onMove = (e) => {
      const pos = getCoords(e), drag = dragRef.current
      if (drag.type === 'cropping') {
        cropRef.current = { x: Math.min(drag.sx, pos.x), y: Math.min(drag.sy, pos.y), w: Math.abs(pos.x - drag.sx), h: Math.abs(pos.y - drag.sy) }
        render()
      } else if (drag.type === 'drawing') {
        render({ previewRegion: { id: '_p', x: Math.min(drag.sx, pos.x), y: Math.min(drag.sy, pos.y), w: Math.abs(pos.x - drag.sx), h: Math.abs(pos.y - drag.sy), mode: drag.mode, shape: drag.shape, blurAmount: drag.blurAmount, chunky: drag.chunky, chunkSize: drag.chunkSize, seed: drag.seed, color: drag.color } })
      } else if (drag.type === 'brushing') {
        drag.points.push(pos)
        render({ previewRegion: { id: '_bp', type: 'brush', points: drag.points, brushSize: drag.brushSize, mode: drag.mode, color: drag.color, blurAmount: drag.blurAmount, chunky: drag.chunky, chunkSize: drag.chunkSize, seed: drag.seed } })
      } else if (drag.type === 'rotating') {
        const reg = regionsRef.current.find(r => r.id === drag.regionId)
        if (reg) {
          const rcx = reg.x + reg.w / 2, rcy = reg.y + reg.h / 2
          const curAngle = Math.atan2(pos.y - rcy, pos.x - rcx)
          reg.rotation = drag.origRotation + (curAngle - drag.startAngle)
          render()
        }
      } else if (drag.type === 'moving') {
        const reg = regionsRef.current.find(r => r.id === drag.regionId)
        if (reg) {
          if (reg.type === 'brush') {
            const dx = pos.x - drag.lastX, dy = pos.y - drag.lastY
            for (const p of reg.points) { p.x += dx; p.y += dy }
            drag.lastX = pos.x; drag.lastY = pos.y
          } else {
            reg.x = pos.x - drag.ox; reg.y = pos.y - drag.oy
          }
          render()
        }
      } else if (drag.type === 'resizing') {
        const reg = regionsRef.current.find(r => r.id === drag.regionId)
        if (reg) {
          const cos = Math.cos(drag.angle), sin = Math.sin(drag.angle)
          const vx = pos.x - drag.fsx, vy = pos.y - drag.fsy
          const projX = vx * cos + vy * sin, projY = -vx * sin + vy * cos
          const newW = drag.rx ? Math.max(4, Math.abs(projX)) : reg.w
          const newH = drag.ry ? Math.max(4, Math.abs(projY)) : reg.h
          const offX = drag.rx ? projX / 2 : drag.ox, offY = drag.ry ? projY / 2 : drag.oy
          const ncx = drag.fsx + offX * cos - offY * sin
          const ncy = drag.fsy + offX * sin + offY * cos
          reg.x = ncx - newW / 2; reg.y = ncy - newH / 2; reg.w = newW; reg.h = newH
          render()
        }
      }
    }
    const onUp = (e) => {
      const drag = dragRef.current
      if (drag.type === 'cropping') {
        const pos = getCoords(e)
        const crop = { x: Math.min(drag.sx, pos.x), y: Math.min(drag.sy, pos.y), w: Math.abs(pos.x - drag.sx), h: Math.abs(pos.y - drag.sy) }
        if (crop.w >= 4 && crop.h >= 4) { cropRef.current = crop; forceUpdate(n => n + 1) }
        else { cropRef.current = null }
      } else if (drag.type === 'brushing') {
        if (drag.points.length >= 1) {
          const nr = { id: String(nextId++), type: 'brush', points: [...drag.points], brushSize: drag.brushSize, mode: drag.mode, color: drag.color, blurAmount: drag.blurAmount, chunky: drag.chunky, chunkSize: drag.chunkSize, seed: drag.seed, rotation: 0 }
          commitRegions([...regionsRef.current, nr]); setSelectedId(nr.id)
        }
      } else if (drag.type === 'drawing') {
        const pos = getCoords(e)
        const x = Math.min(drag.sx, pos.x), y = Math.min(drag.sy, pos.y), w = Math.abs(pos.x - drag.sx), h = Math.abs(pos.y - drag.sy)
        if (w >= 4 && h >= 4) {
          const nr = { id: String(nextId++), x, y, w, h, mode: drag.mode, shape: drag.shape, blurAmount: drag.blurAmount, chunky: drag.chunky, chunkSize: drag.chunkSize, seed: drag.seed, rotation: 0, color: drag.color }
          commitRegions([...regionsRef.current, nr]); setSelectedId(nr.id)
        }
      } else if (drag.type === 'moving' || drag.type === 'resizing' || drag.type === 'rotating') {
        commitRegions([...regionsRef.current])
      }
      dragRef.current = { type: 'none' }
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
    }
    const onTouchMove = (e) => { e.preventDefault(); onMove(e.touches[0]) }
    const onTouchEnd = (e) => { e.preventDefault(); onUp(e.changedTouches[0]) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)
  }

  // Hover cursor
  const onCanvasMouseMove = (e) => {
    if (dragRef.current.type !== 'none' || !canvasRef.current || !imgRef.current) return
    const canvas = canvasRef.current, pos = getCoords(e), scale = getScale(), hs = 6 * scale, thr = hs * 1.5
    const selReg = selectedIdRef.current ? regionsRef.current.find(r => r.id === selectedIdRef.current) : null
    if (selReg) {
      const del = selReg.type === 'brush'
        ? (() => { const bb = getBrushBBox(selReg); return { x: bb.x + bb.w + hs * 2, y: bb.y - hs * 2 } })()
        : getDeletePos(selReg, hs)
      if (Math.hypot(pos.x - del.x, pos.y - del.y) < hs * 2.4) { canvas.style.cursor = 'pointer'; return }
      if (selReg.type !== 'brush') {
        const rh = getRotHandlePos(selReg, hs)
        if (Math.hypot(pos.x - rh.x, pos.y - rh.y) < thr) { canvas.style.cursor = 'grab'; return }
        const handles = getHandles(selReg)
        for (const [key, hp] of Object.entries(handles)) {
          if (Math.abs(pos.x - hp.x) < thr && Math.abs(pos.y - hp.y) < thr) { canvas.style.cursor = CURSORS[key]; return }
        }
      }
    }
    for (let i = regionsRef.current.length - 1; i >= 0; i--) {
      const r = regionsRef.current[i]
      if (r.type === 'brush') {
        if (pointNearBrushPath(pos.x, pos.y, r)) { canvas.style.cursor = 'move'; return }
      } else {
        const rcx = r.x + r.w / 2, rcy = r.y + r.h / 2
        const lp = rotPt(pos.x, pos.y, rcx, rcy, -(r.rotation || 0))
        if (lp.x >= r.x && lp.x <= r.x + r.w && lp.y >= r.y && lp.y <= r.y + r.h) { canvas.style.cursor = 'move'; return }
      }
    }
    canvas.style.cursor = 'crosshair'
  }

  const save = async () => {
    if (savingRef.current || !canvasRef.current) return
    savingRef.current = true
    const prev = selectedIdRef.current; selectedIdRef.current = null
    render({ showUI: false })
    try {
      const { blob, fileName: outName } = await exportRedactedImage(canvasRef.current, meta, fileName)
      const a = document.createElement('a')
      a.download = outName
      a.href = URL.createObjectURL(blob)
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } finally {
      selectedIdRef.current = prev
      render()
      savingRef.current = false
    }
  }

  const clear = () => { regionsRef.current = []; historyRef.current = [[]]; indexRef.current = 0; imageStackRef.current = []; setSelectedId(null); forceUpdate(n => n + 1) }
  const removeImage = () => {
    loadGenRef.current++
    setLoaded(false)
    imgRef.current = null
    regionsRef.current = []
    historyRef.current = [[]]
    indexRef.current = 0
    imageStackRef.current = []
    setSelectedId(null)
    setCropping(false)
    cropRef.current = null
    setShowNotes(false)
    setMeta(emptySnapshot())
    setImageError(null)
    setWarningDismissed(false)
    forceUpdate(n => n + 1)
  }

  const transformImage = (fn) => {
    const img = imgRef.current; if (!img) return
    saveImageState()
    const offscreen = document.createElement('canvas')
    const octx = offscreen.getContext('2d')
    fn(offscreen, octx, img)
    const newImg = new Image()
    newImg.onload = () => {
      imgRef.current = newImg
      const canvas = canvasRef.current
      canvas.width = newImg.width; canvas.height = newImg.height
      regionsRef.current = []; historyRef.current = [[]]; indexRef.current = 0; setSelectedId(null)
      forceUpdate(n => n + 1); setTimeout(fitCanvas, 0)
    }
    newImg.src = offscreen.toDataURL()
  }

  const flipH = () => transformImage((c, ctx, img) => {
    c.width = img.width; c.height = img.height
    ctx.translate(img.width, 0); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0)
  })
  const flipV = () => transformImage((c, ctx, img) => {
    c.width = img.width; c.height = img.height
    ctx.translate(0, img.height); ctx.scale(1, -1); ctx.drawImage(img, 0, 0)
  })
  const rotateCW = () => transformImage((c, ctx, img) => {
    c.width = img.height; c.height = img.width
    ctx.translate(img.height, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(img, 0, 0)
  })
  const rotateCCW = () => transformImage((c, ctx, img) => {
    c.width = img.height; c.height = img.width
    ctx.translate(0, img.width); ctx.rotate(-Math.PI / 2); ctx.drawImage(img, 0, 0)
  })

  const applyCrop = () => {
    const crop = cropRef.current; if (!crop || crop.w < 4 || crop.h < 4) return
    saveImageState()
    // First render clean (with effects baked in)
    selectedIdRef.current = null; cropRef.current = null; render({ showUI: false })
    const canvas = canvasRef.current, ctx = canvas.getContext('2d')
    const data = ctx.getImageData(Math.round(crop.x), Math.round(crop.y), Math.round(crop.w), Math.round(crop.h))
    const offscreen = document.createElement('canvas')
    offscreen.width = Math.round(crop.w); offscreen.height = Math.round(crop.h)
    offscreen.getContext('2d').putImageData(data, 0, 0)
    const newImg = new Image()
    newImg.onload = () => {
      imgRef.current = newImg; canvas.width = newImg.width; canvas.height = newImg.height
      regionsRef.current = []; historyRef.current = [[]]; indexRef.current = 0; setSelectedId(null)
      setCropping(false); cropRef.current = null
      forceUpdate(n => n + 1); setTimeout(fitCanvas, 0)
    }
    newImg.src = offscreen.toDataURL()
  }
  const cancelCrop = () => { cropRef.current = null; setCropping(false); forceUpdate(n => n + 1) }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-row">
          <span className="logo" onClick={openAbout}>redax</span>
          <button type="button" className="help-btn" title="What's metadata?" aria-label="What's metadata?" onClick={openMetadata}>?</button>
          <button
            type="button"
            className={showNotes ? 'active' : ''}
            onClick={() => setShowNotes((v) => !v)}
            disabled={!loaded}
            title="Photo notes"
          >
            Notes
            {loaded && meta.location.found && <span className="notes-dot" title="This photo has a location" />}
          </button>
          <div className="sep" />
          <div className="toolbar-dropdown">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="blur">Blur</option>
              <option value="redact">Redact</option>
              <option value="erase">Erase</option>
              <option value="brush">Brush</option>
            </select>
          </div>
          {mode !== 'brush' && <div className="toolbar-dropdown">
            <select value={shape} onChange={(e) => setShape(e.target.value)}>
              <option value="rect">Rectangle</option>
              <option value="rounded">Rounded</option>
              <option value="ellipse">Ellipse</option>
            </select>
          </div>}
          <button className="menu-toggle" onClick={() => setMenuOpen(v => !v)} title="More options">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <div className="spacer" />
          <button className="primary" onClick={() => fileRef.current.click()}>Add</button>
          <button className="primary" onClick={save} disabled={!loaded || cropping}>Save</button>
        </div>
        {menuOpen && (
          <div className="toolbar-overflow">
            {mode === 'blur' && (
              <>
                <label>Strength: <input type="range" min="5" max="60" value={blurAmount} onChange={(e) => setBlurAmount(Number(e.target.value))} /> <span>{blurAmount}px</span></label>
                <label className="checkbox-label"><input type="checkbox" checked={chunky} onChange={(e) => setChunky(e.target.checked)} /> Chunky</label>
                {chunky && <label>Size: <input type="range" min="4" max="48" value={chunkSize} onChange={(e) => setChunkSize(Number(e.target.value))} /> <span>{chunkSize}px</span></label>}
                <div className="sep" />
              </>
            )}
            {(mode === 'redact' || mode === 'brush') && (
              <>
                <label className="color-picker">Color: <input type="color" value={redactColor} onChange={(e) => setRedactColor(e.target.value)} /></label>
                <div className="sep" />
              </>
            )}
            {mode === 'brush' && (
              <>
                <label>Brush: <input type="range" min="4" max="100" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} /> <span>{brushSize}px</span></label>
                <div className="sep" />
              </>
            )}
            <div className="undo-redo">
              <button onClick={undo} disabled={!loaded || !canUndo()} title="Undo (Ctrl+Z)">Undo</button>
              <button onClick={redo} disabled={!loaded || !canRedo()} title="Redo (Ctrl+Shift+Z)">Redo</button>
            </div>
            <div className="sep" />
            <div className="undo-redo">
              <button onClick={rotateCCW} disabled={!loaded} title="Rotate Left">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              </button>
              <button onClick={rotateCW} disabled={!loaded} title="Rotate Right">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>
              </button>
              <button onClick={flipH} disabled={!loaded} title="Flip Horizontal">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20"/><path d="M16 5h5l-5 14"/><path d="M8 5H3l5 14"/></svg>
              </button>
              <button onClick={flipV} disabled={!loaded} title="Flip Vertical">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12h20"/><path d="M5 8V3l14 5"/><path d="M5 16v5l14-5"/></svg>
              </button>
            </div>
            <div className="sep" />
            <button onClick={() => { setCropping(true); setSelectedId(null); cropRef.current = null }} disabled={!loaded || cropping} title="Crop">Crop</button>
            {cropping && (
              <>
                <button className="primary" onClick={() => { applyCrop(); setMenuOpen(false) }} disabled={!cropRef.current}>Apply Crop</button>
                <button onClick={() => { cancelCrop(); setMenuOpen(false) }}>Cancel</button>
              </>
            )}
            <div className="sep" />
            <button
              disabled={!loaded || regionsRef.current.length === 0}
              title="Show original (hold Alt)"
              onMouseDown={() => { showOriginalRef.current = true; render({ showOriginal: true }) }}
              onMouseUp={() => { showOriginalRef.current = false; render() }}
              onMouseLeave={() => { if (showOriginalRef.current) { showOriginalRef.current = false; render() } }}
            >Before/After</button>
            <div className="sep" />
            <button onClick={clear} disabled={!loaded} title="Reset all changes">Clear</button>
            <button onClick={removeImage} disabled={!loaded} title="Remove image">Delete</button>
          </div>
        )}
      </div>

      {loaded && meta.warning && !warningDismissed && (
        <div className="heic-note">
          <p>{meta.warning.message}</p>
          <button type="button" className="text-btn" onClick={() => setShowNotes(true)}>Notes</button>
          <button type="button" className="modal-close" onClick={() => setWarningDismissed(true)} aria-label="Dismiss">&times;</button>
        </div>
      )}

      <div className={`workspace${loaded && showNotes ? ' with-notes' : ''}`}>
      <div className={`canvas-wrap${!loaded ? ' landing-wrap' : ''}`} ref={wrapRef} onDrop={(e) => { e.preventDefault(); setFileDragging(false); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) loadFile(f) }} onDragOver={(e) => { e.preventDefault(); setFileDragging(true) }} onDragLeave={() => setFileDragging(false)}>
        {!loaded && (
          <div className={`drop-zone${fileDragging ? ' dragging' : ''}`}>
            <div className="landing">
              <h1 className="landing-title">Let’s get your pics ready to share.</h1>
              <p className="landing-lead">
                Hide anything you wouldn’t want someone else to keep — a face, a name, a house number.
                Then check the hidden notes photos can carry — keep, edit, or leave them off — and save.
              </p>
              {imageError && <p className="heic-note landing">{imageError}</p>}
              <div className="drop-target" onClick={() => fileRef.current.click()}>
                <div className="icon">&#128444;&#65039;</div>
                <div className="label">Open or drop a photo</div>
                <div className="sub">or paste with Ctrl+V / Cmd+V</div>
              </div>
              <ol className="landing-steps">
                <li>
                  <span className="step-n">1 · Open</span>
                  Drop a photo here, click to browse, or paste.
                </li>
                <li>
                  <span className="step-n">2 · Hide</span>
                  Draw over what you want out of the picture.
                </li>
                <li>
                  <span className="step-n">3 · Check</span>
                  Photos can carry hidden notes. Keep, edit, or leave them off.{' '}
                  <button type="button" className="text-btn" onClick={openMetadata}>What’s metadata?</button>
                </li>
                <li>
                  <span className="step-n">4 · Save</span>
                  Download a copy you’re comfortable sharing. Extra notes stay off unless you keep them.
                </li>
              </ol>
              <p className="privacy-note">
                <span className="lock">&#128274;</span>
                Your photo stays on this device. Nothing is uploaded.
              </p>
              <p className="landing-links">
                <button type="button" className="text-btn" onClick={openAbout}>About</button>
                {' · '}
                <a href="https://github.com/typicalfo/redax" target="_blank" rel="noopener noreferrer">View source</a>
                {' · based on '}
                <a href="https://github.com/creativar/blurrr" target="_blank" rel="noopener noreferrer">Blurrr</a>
              </p>
            </div>
          </div>
        )}
        <canvas ref={canvasRef} style={{ display: loaded ? 'block' : 'none', touchAction: 'none' }}
          onMouseDown={onMouseDown} onMouseMove={onCanvasMouseMove}
          onTouchStart={(e) => { e.preventDefault(); onMouseDown(e.touches[0]) }}
          onTouchMove={(e) => { e.preventDefault() }}
        />
      </div>
      {loaded && showNotes && (
        <MetadataPanel
          meta={meta}
          onPatch={patchMeta}
          onClose={() => setShowNotes(false)}
          onOpenHelp={openMetadata}
        />
      )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onClick={(e) => { e.target.value = '' }} onChange={(e) => { if (e.target.files[0]) loadFile(e.target.files[0]) }} />

      {showAbout && (
        <div className="modal-overlay" onClick={closeModals}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="logo" id="about-title">redax</span>
              <button type="button" className="modal-close" onClick={closeModals} aria-label="Close">&times;</button>
            </div>
            <p className="modal-tagline">Let’s get your pics ready to share.</p>
            <p>Hide faces, names, house numbers — whatever you don’t want in the picture. You choose what stays.</p>
            <div className="modal-section">
              <h3>How to</h3>
              <ol>
                <li>Open or drop a photo (or paste with <strong>Ctrl+V</strong> / <strong>Cmd+V</strong>)</li>
                <li>Draw over what you want to hide — blur, black out, erase, or brush</li>
                <li>Click a region to move, resize, or delete it</li>
                <li>
                  Open <strong>Notes</strong> to keep, edit, or leave off location, date, captions, and camera.{' '}
                  <button type="button" className="text-btn" onClick={openMetadata}>What’s metadata?</button>
                </li>
                <li>Save when you’re happy — extra notes stay off unless you kept them</li>
              </ol>
            </div>
            <div className="modal-section">
              <h3>On this device</h3>
              <p>Your photo stays here. Nothing is uploaded.</p>
            </div>
            <div className="modal-section">
              <h3>Source</h3>
              <p>
                Open source: <a href="https://github.com/typicalfo/redax" target="_blank" rel="noopener noreferrer">typicalfo/redax</a>.
                Based on <a href="https://github.com/creativar/blurrr" target="_blank" rel="noopener noreferrer">Blurrr</a> — we extend their canvas; we didn’t rewrite it.
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="primary" onClick={closeModals}>Got it</button>
            </div>
          </div>
        </div>
      )}

      {showMetadata && (
        <div className="modal-overlay" onClick={closeModals}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="metadata-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="logo" id="metadata-title">What’s metadata?</span>
              <button type="button" className="modal-close" onClick={closeModals} aria-label="Close">&times;</button>
            </div>
            <p className="modal-tagline">Hidden notes that can ride along with a photo.</p>
            <p>
              Photos can carry extra information tucked into the file — notes you don’t see when you look at the picture.
            </p>
            <div className="modal-section">
              <h3>What might be in there</h3>
              <ul>
                <li>Where it was taken — a place name or a GPS pin</li>
                <li>When it was taken</li>
                <li>What camera or phone took it</li>
                <li>Captions, titles, or keywords (sometimes names)</li>
              </ul>
            </div>
            <div className="modal-section">
              <h3>Why it matters</h3>
              <p>
                If you share the file, those notes can travel with it. A picture of your front porch might also say exactly where you live.
              </p>
              <p>
                One common place those notes hide is called EXIF — that’s just a label for a bundle of extra details cameras and phones attach to photos. There are other hiding spots too.
              </p>
              <p>
                When you save, extra notes are left off unless you choose to keep them. Open <strong>Notes</strong> on a photo to keep, edit, or remove location, date, captions, and camera. Everything else is left off.
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="primary" onClick={closeModals}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
