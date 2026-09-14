# Project brief — **redax**

**Name locked 2026-09-13:** `redax` · public fork `typicalfo/redax` (from Blurrr).

A free, open-source photo privacy tool for portfolio use — **not** a business, SaaS, or App Store product. No ads, no accounts, no charge.

People want to share a photo and control *exactly* what stays in it: their own face yes, their kid’s face no; a letter on the table; an ex in the frame; some background people but not others; an offensive sign; the GPS pin on their house. Automation that blurs *all* faces or strips *all* tags gets that wrong. Good privacy here means the user decides, quickly, in one place.

Product name: **redax**. “Freeform” was only the mockup tool used to sketch the idea, not the product name.

## Base

This starts from the open-source **Blurrr** app (already cloned here; ISC license). Blurrr already is the manual redaction UX we want. We fork and extend it — we do not rewrite the canvas editor.

- Keep Blurrr copyright notices and license.
- Credit Blurrr in the README and UI (“based on Blurrr” / upstream link). Do not pretend the redaction work is greenfield.
- Prefer extending the existing app over a ground-up rebuild.
- Fork under the `typicalfo` GitHub account; leave it public.

## Purpose

**Good privacy, easy enough that someone will actually do it.**

One local app, one screen, two jobs:

1. **Picture** — Blurrr as it is in the demo: paint or box what to hide (blur, redact, erase, brush). Purposefully manual. The user chooses the kid, the ex, the stranger, the address on the letter.
2. **Metadata** — see and change the tags that identify people, especially location. Keep, edit, or remove. Then one Save.

Today those are two different tools (face/pixel redaction vs metadata redaction). The fork exists so both happen together. Silent strip-on-save is already what Blurrr does; that alone is not a reason to fork. “Strip everything” can exist as a button. It is not the purpose.

## Manual redaction

- Open an image; big preview.
- Blur / erase / black-out / brush; area selector. Human paints what to hide.
- No auto-detect as a product story. Lots of tools already blur every face or every text region. We are not those tools. Existing auto-detect in upstream can be buried or removed; do not build the UX around it.
- Save exports the redacted picture plus the metadata the user chose.

## Metadata panel

Show a **short list of human rows**, not a grid of 80 Exif keys. This is not Photo Mechanic.

| Row | What the user is deciding | Actions |
| --- | --- | --- |
| **Location** | Coordinates *and* place text (city, sublocation, country, “location created,” etc.) | Keep / Remove / Change |
| **Date taken** | When the photo claims to have been shot | Keep / Remove / Change |
| **Caption, title, keywords** | Names and addresses hiding in text | Show the text; edit or clear |
| **Camera / device** | Make/model as text — not serials, not maker notes | Keep / Remove |
| **Everything else** | Serials, unique IDs, vendor blobs, and anything not in the panel | Strip by default (or keep only if we later add it to the allowlist on purpose) |

Copyright/artist can default to keep or sit in “everything else”; it is not GPS.

### Location

This is the row to get right. Do not lead with Exif rationals.

- “This photo has a location” vs “No location.”
- **Remove** — one click; no pin and no place strings in the export.
- **Change** — a map: search a place or drag the pin. Optional: “make it less precise” (city / ~1 km).
- Lat/lon can exist behind the map for people who want numbers.

A map or place search may use the network (tiles/geocoding). That is fine. The **photo file** is not uploaded. Remove-location needs no network. A one-line note in the UI is enough.

Location is more than the pin. IPTC/XMP place names (“Brooklyn / 4th Ave”) are the same class of data. One row covers coordinates **and** those strings. Remove clears both.

## Export rule (default, not dogma)

If we only edit the fields the UI shows, and GPS (or a face) is still in a tag the UI does not show, the tool is lying.

Identifying data is duplicated across EXIF, IPTC, XMP, maker notes, and the **embedded thumbnail** (a small JPEG of the *un-blurred* original). A denylist (“strip GPSLatitude”) loses to the next copy we did not list.

**Default:** encode a **new** image from the redacted pixels, then write **only an allowlist** — the decisions from the panel, plus a few technical necessities (e.g. orientation already baked into pixels). Nothing else rides along. Thumbnail is omitted, or generated from the redacted pixels — never copied from the original. “Keep camera” writes Make/Model as text, not the maker-note blob. “Keep location” writes the (possibly edited) pin and place text, not a copy of the original GPS IFD.

That is an architecture, not a frozen field list. The allowlist can grow later (copyright, lens, etc.) without changing the rule: **nothing enters the export unless we put it there.**

Do not lock this as the only possible mode forever. A later “keep extra technical tags from the original” path can be explored. It is not v1. Do not default to copy-original-then-patch-visible-fields.

Tests that matter: a dirty fixture JPEG (GPS, IPTC city, XMP location, maker notes, thumbnail) → export with Location = remove → parse the output and assert those are gone. Same idea if “keep camera” is on: serials must not sneak back.

## Crop ratios (only if cheap)

This is the kind of tool you use right before posting. A simple **aspect-ratio lock** on the crop that already exists is enough — not a separate social-media studio.

Examples: 1:1, 4:5 portrait, 9:16 story/reel, 16:9 / 1.91:1 landscape.

If it fights the existing crop math, drop it. Do not invent a new crop editor.

## Shape

- One web app is enough. Desktop packaging is optional and not required.
- Image pixels and metadata work stay in the browser. Photos are not uploaded. Network is allowed for maps/search.
- No tracking (remove upstream Plausible / analytics / committed analytics domain).
- Honest positioning: fork of Blurrr + selective metadata you can actually see and change.

## What we do not want

- A commercial redaction studio (Redacted / BlurIt / ShareGuard / etc.).
- Auto-redact-all-faces or all-text as the experience.
- Accounts, cloud upload of photos, ads, subscriptions, analytics.
- Passing off Blurrr’s UI as if we built it from zero.
- Photo Mechanic, Photoshop, or a general IPTC/XMP DAM.
- Treating “strip everything” as the reason this fork exists.
- Feature creep past: manual redaction + this panel + cheap crop ratios.

## Success looks like

1. Same satisfying manual blur/erase workflow as the Blurrr demo.
2. User opens a family photo, blurs only what they choose, sees location/date/captions/camera, moves or drops the pin, saves **one** file.
3. Hidden copies of GPS, place names, serials, and the original thumbnail are not in that file unless the user put them there.
4. README and UI credit Blurrr. Our contribution is obvious: pixels and metadata, same screen, user decides.

## Out of scope for this brief

Library choices and module layout — that’s implementation. The export **principle** (allowlist by default) is product intent, not a library choice.
