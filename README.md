# redax

Free, local **photo privacy** for sharing. Open an image, hide what you choose (blur / redact / erase / brush), then save — nothing uploads, no accounts, no ads, no tracking.

Open a photo, hide what you choose, then check **Notes** — location, date, captions/keywords, camera — and keep, edit, or leave them off. Save writes a **new** image from the redacted pixels and only the tags you kept. Everything else (serials, maker notes, the original thumbnail) stays off. If you never open Notes, extra notes are left off.

Based on [Blurrr](https://github.com/creativar/blurrr) (ISC).

## Why

Auto-blur-every-face / strip-every-tag gets portfolio privacy wrong. You might want your face in and a kid’s face out, a letter gone, GPS off the house. redax is for deciding that yourself, quickly, in one place.

## Features

- Blur, redact, erase, brush
- Rectangle / rounded / ellipse regions; move, resize, rotate, delete
- Rotate, flip, crop (undoable)
- Undo / redo (`Ctrl/Cmd+Z`)
- Drag & drop or paste a screenshot
- Photo notes: location, date, captions, camera — keep, edit, or remove
- Save encodes a **new** file from the redacted pixels (never copy-original-then-patch)
- JPEG if you kept any notes; PNG if everything is left off (the default)
- HEIC: redaction still works when the browser can show the picture; if hidden notes can’t be read, you’ll get a note to export/share as JPEG from Photos
- Runs entirely in the browser

## Develop

```bash
make help      # list targets
make install
make dev
make build
make preview
make test       # allowlist export proof (dirty JPEG → GPS/place gone)
```

## License

ISC. See [Blurrr](https://github.com/creativar/blurrr) for the original project.
