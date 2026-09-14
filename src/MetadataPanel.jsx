import { useState } from 'react'
import {
  cameraHasValues,
  captionHasValues,
  datetimeLocalValue,
  formatCamera,
  formatCaptionSummary,
  formatCoords,
  formatDateDisplay,
  formatPlace,
  locationHasValues,
} from './metadata.js'

function KeepRemove({ keep, onKeep, onRemove, disabled }) {
  return (
    <div className="seg" role="group" aria-label="Keep or remove">
      <button type="button" className={keep ? 'on keep' : 'keep'} onClick={onKeep} disabled={disabled} aria-pressed={keep}>
        Keep
      </button>
      <button type="button" className={!keep ? 'on remove' : 'remove'} onClick={onRemove} disabled={disabled} aria-pressed={!keep}>
        Remove
      </button>
    </div>
  )
}

function FieldRow({ title, summary, emptyLabel, keep, onKeep, onRemove, editing, onToggleEdit, canDecide, children }) {
  return (
    <section className="notes-field">
      <div className="notes-field-head">
        <h3>{title}</h3>
        <button type="button" className="text-btn notes-edit" onClick={onToggleEdit}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {!editing && <p className={`notes-summary${summary ? '' : ' dim'}`}>{summary || emptyLabel}</p>}
      {editing && <div className="notes-edit-form">{children}</div>}
      {canDecide && (
        <div className="notes-actions">
          <KeepRemove keep={keep} onKeep={onKeep} onRemove={onRemove} />
          <span className="notes-status">{keep ? 'Will be on the saved file' : 'Left off when you save'}</span>
        </div>
      )}
    </section>
  )
}

function numOrEmpty(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : ''
}

export default function MetadataPanel({ meta, onPatch, onClose, onOpenHelp }) {
  const [editing, setEditing] = useState({ location: false, date: false, caption: false, camera: false })
  const toggle = (key) => setEditing((e) => ({ ...e, [key]: !e[key] }))
  const patch = (key, part) => onPatch(key, part)

  const loc = meta.location
  const placeLine = formatPlace(loc)
  const coordLine = formatCoords(loc.latitude, loc.longitude)
  const locSummary = [placeLine, coordLine].filter(Boolean).join('\n')
  const locValues = locationHasValues(loc)

  const dateSummary = formatDateDisplay(meta.date.iso)
  const capSummary = formatCaptionSummary(meta.caption)
  const camSummary = formatCamera(meta.camera)

  const setKeep = (key, keep) => patch(key, { keep })
  const editAndKeep = (key, part) => patch(key, { ...part, keep: true })

  return (
    <aside className="notes-panel" aria-label="Photo notes">
      <div className="notes-panel-header">
        <h2>Photo notes</h2>
        <div className="notes-panel-tools">
          <button type="button" className="help-btn" title="What's metadata?" aria-label="What's metadata?" onClick={onOpenHelp}>
            ?
          </button>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close notes">
            &times;
          </button>
        </div>
      </div>

      {meta.warning && <p className="notes-banner">{meta.warning.message}</p>}

      {loc.found && !meta.warning && (
        <p className="notes-lead">This photo has a location. Extra notes are left off unless you keep them.</p>
      )}
      {!loc.found && !meta.warning && (
        <p className="notes-lead">Extra notes are left off unless you keep them. Everything else is always left off.</p>
      )}

      <FieldRow
        title="Location"
        summary={locSummary}
        emptyLabel="None found"
        keep={loc.keep}
        onKeep={() => setKeep('location', true)}
        onRemove={() => setKeep('location', false)}
        editing={editing.location}
        onToggleEdit={() => toggle('location')}
        canDecide={locValues}
      >
        <label>
          Place
          <input
            type="text"
            value={loc.city}
            placeholder="City"
            onChange={(e) => editAndKeep('location', { city: e.target.value })}
          />
        </label>
        <label>
          More detail
          <input
            type="text"
            value={loc.sublocation}
            placeholder="Neighborhood or street"
            onChange={(e) => editAndKeep('location', { sublocation: e.target.value })}
          />
        </label>
        <div className="notes-pair">
          <label>
            Region
            <input
              type="text"
              value={loc.state}
              placeholder="State / region"
              onChange={(e) => editAndKeep('location', { state: e.target.value })}
            />
          </label>
          <label>
            Country
            <input
              type="text"
              value={loc.country}
              onChange={(e) => editAndKeep('location', { country: e.target.value })}
            />
          </label>
        </div>
        <div className="notes-pair">
          <label>
            Latitude
            <input
              type="number"
              step="any"
              min="-90"
              max="90"
              value={numOrEmpty(loc.latitude)}
              onChange={(e) => {
                const v = e.target.value
                editAndKeep('location', { latitude: v === '' ? null : Number(v) })
              }}
            />
          </label>
          <label>
            Longitude
            <input
              type="number"
              step="any"
              min="-180"
              max="180"
              value={numOrEmpty(loc.longitude)}
              onChange={(e) => {
                const v = e.target.value
                editAndKeep('location', { longitude: v === '' ? null : Number(v) })
              }}
            />
          </label>
        </div>
      </FieldRow>

      <FieldRow
        title="Date taken"
        summary={dateSummary}
        emptyLabel="None found"
        keep={meta.date.keep}
        onKeep={() => setKeep('date', true)}
        onRemove={() => setKeep('date', false)}
        editing={editing.date}
        onToggleEdit={() => toggle('date')}
        canDecide={Boolean(meta.date.iso)}
      >
        <label>
          Date and time
          <input
            type="datetime-local"
            value={datetimeLocalValue(meta.date.iso)}
            onChange={(e) => editAndKeep('date', { iso: e.target.value ? `${e.target.value}:00` : '' })}
          />
        </label>
      </FieldRow>

      <FieldRow
        title="Caption, title, keywords"
        summary={capSummary}
        emptyLabel="None found"
        keep={meta.caption.keep}
        onKeep={() => setKeep('caption', true)}
        onRemove={() => setKeep('caption', false)}
        editing={editing.caption}
        onToggleEdit={() => toggle('caption')}
        canDecide={captionHasValues(meta.caption)}
      >
        <label>
          Title
          <input type="text" value={meta.caption.title} onChange={(e) => editAndKeep('caption', { title: e.target.value })} />
        </label>
        <label>
          Caption
          <textarea
            rows={3}
            value={meta.caption.caption}
            onChange={(e) => editAndKeep('caption', { caption: e.target.value })}
          />
        </label>
        <label>
          Keywords
          <input
            type="text"
            value={meta.caption.keywords}
            placeholder="Comma-separated"
            onChange={(e) => editAndKeep('caption', { keywords: e.target.value })}
          />
        </label>
      </FieldRow>

      <FieldRow
        title="Camera"
        summary={camSummary}
        emptyLabel="None found"
        keep={meta.camera.keep}
        onKeep={() => setKeep('camera', true)}
        onRemove={() => setKeep('camera', false)}
        editing={editing.camera}
        onToggleEdit={() => toggle('camera')}
        canDecide={cameraHasValues(meta.camera)}
      >
        <label>
          Make
          <input type="text" value={meta.camera.make} onChange={(e) => editAndKeep('camera', { make: e.target.value })} />
        </label>
        <label>
          Model
          <input type="text" value={meta.camera.model} onChange={(e) => editAndKeep('camera', { model: e.target.value })} />
        </label>
      </FieldRow>

      <p className="notes-foot">
        Hidden extras — serial numbers, a tiny original picture tucked in the file — are never copied.{' '}
        <button type="button" className="text-btn" onClick={onOpenHelp}>
          What’s metadata?
        </button>
      </p>
    </aside>
  )
}
