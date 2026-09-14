# redax

Free, local **photo privacy** for sharing. Open an image, hide what you choose (blur / redact / erase / brush), then save — nothing uploads, no accounts, no ads, no tracking.

**Next:** a short metadata panel on the same screen — location, date, captions/keywords, camera — so you keep, edit, or remove identifying tags before export. Export will be allowlist-from-redacted-pixels (no original thumbnail sneaking through).

Based on [Blurrr](https://github.com/creativar/blurrr) (ISC).

## Why

Auto-blur-every-face / strip-every-tag gets portfolio privacy wrong. You might want your face in and a kid’s face out, a letter gone, GPS off the house. redax is for deciding that yourself, quickly, in one place.

## Features

- Blur, redact, erase, brush
- Rectangle / rounded / ellipse regions; move, resize, rotate, delete
- Rotate, flip, crop (undoable)
- Undo / redo (`Ctrl/Cmd+Z`)
- Drag & drop or paste a screenshot
- Runs entirely in the browser

## Develop

```bash
make help      # list targets
make install
make dev
make build
make preview
```

## License

ISC. See [Blurrr](https://github.com/creativar/blurrr) for the original project.
