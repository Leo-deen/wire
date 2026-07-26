# AI to Figma Live Bridge

A live, no-export-step pipeline from Adobe Illustrator into Figma — the
same architecture Battle Axe's Overlord uses: an Illustrator extension with
direct access to the live document, a local relay, and a Figma plugin that
builds nodes from structured data instead of parsing a file.

This is **Phase 1**: shapes (paths, compound paths, groups) and live text,
pushed on demand by clicking a button in Illustrator. See "Roadmap" below
for what's intentionally deferred.

## Why this instead of the SVG importer (`figma-illustrator-importer/`)

That plugin reads an exported `.svg` file — it has to reconstruct geometry,
color, and transforms from text, and inherits whatever Illustrator's SVG
exporter chose to do with clip masks, gradients, etc. This project instead
reads Illustrator's **live document object model directly** (via
ExtendScript) and sends already-resolved data to Figma — no file format,
no export step, no re-parsing.

## Architecture

```
Illustrator (CEP panel)  --ws-->  bridge-server (Node, local)  --ws-->  Figma plugin
   reads live document           relays 'push' messages              builds real nodes
   via ExtendScript               between the two sides               from JSON
```

- **`bridge-server/`** — a small Node WebSocket server. Both other pieces
  connect to it as clients and identify themselves (`role: 'illustrator'`
  or `role: 'figma'`). It forwards `push` messages from Illustrator to
  every connected Figma plugin. It has no idea what's inside a payload.

- **`illustrator-extension/`** — a CEP panel (`index.html` + `main.js`,
  running in a real Chromium webview) plus an ExtendScript file
  (`host/main.jsx`) that Illustrator loads and runs inside its own
  scripting engine, with full access to `app.activeDocument`.
  - `host/geometry.jsx` — pure functions (no Illustrator API calls) that
    turn PathPoints into an SVG-syntax `d` string and Illustrator color
    objects into `{r,g,b,a}`. Kept dependency-free so it can also run
    under plain Node for the test suite.
  - `host/json2.jsx` — a tiny `JSON.stringify` polyfill, since older
    ExtendScript engines don't have a native `JSON` object. It's a no-op
    if `JSON` already exists.
  - `host/main.jsx` — walks the current selection (`GroupItem` recurses,
    `PathItem`/`CompoundPathItem`/`TextFrame` become payload nodes,
    anything else is recorded in `skipped`) and returns one JSON string.
  - `main.js`/`index.html` — the panel UI. Connects to the bridge on load,
    and on button click calls `pushSelectionToFigma()` via
    `CSInterface.evalScript()`-equivalent (`lib/cep-bridge.js`), then
    forwards the resulting JSON over the already-open WebSocket.

- **`figma-plugin/`** — `ui.js` opens a WebSocket to the bridge and
  forwards any `push` payload to `code.js` (the main thread, which has no
  DOM/WebSocket access of its own — hence the two-file split). `code.js`
  builds:
  - `path` nodes → `figma.createVector()` with `vectorPaths` set directly
    from the `d` string Illustrator produced (exact bezier data, not an
    approximation).
  - `text` nodes → `figma.createText()`, a real editable text node.
  - `group` nodes → `figma.group()` of already-built children.

## Coordinate handling

Illustrator's anchor/handle coordinates are **already fully resolved to
absolute document space** by the DOM (nested group transforms are baked
in), so `host/main.jsx` only needs one conversion: flip Y and offset by
the active artboard's origin, once, in `geometry.jsx`'s `toXY()`. No
matrix-decomposition step is needed here — unlike the SVG importer, which
has to walk and compose `transform` attributes by hand.

## Roadmap (explicitly out of scope for Phase 1)

- **Gradients** — `GradientColor` fills currently fall back to a flagged
  mid-gray (`geometry.jsx`'s `colorToRGBA` sets `approximate: true`).
  Phase 2: read `GradientColor.gradient.gradientStops` and build a real
  `GRADIENT_LINEAR`/`GRADIENT_RADIAL` Figma fill.
- **Clip masks** — not translated at all yet. Illustrator's model (topmost
  path in a group masks the rest) maps directly onto Figma's `isMask`
  node property — much cleaner than SVG's `clip-path`, which is the
  approach `figma-illustrator-importer/` is stuck with.
- **Images** (`PlacedItem`/`RasterItem`) — currently skipped and reported
  in `skipped[]`. Needs `host/main.jsx` to write the raster to a temp file
  (ExtendScript can't return binary through `evalScript`) and `main.js`
  to read it back with CEP's Node `fs` access before basing64-encoding it
  onto the payload.
- **Two-way sync** (Figma → Illustrator) — would need the Figma plugin to
  push its own payload back through the bridge and a second ExtendScript
  entry point that rebuilds Illustrator `PathItem`s from it.

## Tests

Everything that doesn't require a live Illustrator or Figma runtime is
covered:

```bash
cd bridge-server && npm install && npm test          # relay logic, over real sockets
cd illustrator-extension && npm test                  # geometry/color pure functions
```

`bridge-server/test/integration.test.js` goes further: it builds a payload
the same way `host/main.jsx` would (using the real `geometry.jsx`
functions) and pushes it through a live server instance, checking the
Figma-plugin side receives an identical, valid payload. That's the widest
slice of the pipeline that's testable outside the two host apps — the
ExtendScript-in-Illustrator step and the Figma-node-creation step
(`figma-plugin/code.js`) still need a manual check inside the real apps;
see `INSTALL_GUIDE.md`.
