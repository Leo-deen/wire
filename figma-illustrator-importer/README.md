# AI to Figma Importer

A Figma plugin that imports artwork from Adobe Illustrator into Figma as
**real, editable content**:

- Placed bitmap images → image-filled rectangles inside a frame
- Text objects → editable Figma text nodes (not outlines)
- Paths/shapes → native Figma vector nodes, via Figma's own SVG importer

Everything lands inside one Figma frame sized to match the Illustrator
artboard, so the result drops straight into your existing workflow.

Figma plugins cannot read Illustrator's native `.ai` binary format
directly — there is no public parser for it, and Adobe doesn't expose one.
This plugin instead works from an **SVG export** of the artwork, which
Illustrator produces natively and which preserves editable text, paths,
and embedded images. See `INSTALL_GUIDE.md` for exact Illustrator export
settings and full install/usage steps.

## How it works

- `manifest.json` — plugin manifest (`main: code.js`, `ui: ui.html`)
- `ui.html` / `ui.js` — the plugin's UI panel (runs in an iframe with full
  browser/DOM access). Lets the user pick/drop an `.svg` file, parses it
  with `lib/svg-parser.js`, and posts the extracted structure to the main
  thread.
- `lib/svg-parser.js` — pure, dependency-free SVG parsing logic. Walks the
  SVG DOM tree, accumulates transform matrices, and splits the document
  into three buckets: `images[]`, `texts[]` (each with resolved position,
  rotation, font, and color), and `vectorSvg` (the remaining shapes,
  serialized back into a standalone SVG string). Understands Illustrator's
  three SVG styling modes: presentation attributes, inline `style="..."`,
  and internal CSS classes (`<style>.st0{fill:...}</style>`).
- `code.js` — the plugin's main thread (has the `figma` API, no DOM).
  Receives the parsed structure and builds real nodes: `figma.createImage`
  + a filled rectangle per image, `figma.createText` + `loadFontAsync` per
  text run, and `figma.createNodeFromSvg` for the leftover vector shapes —
  all appended into one frame named after the source file.

## Known limitations

- **Not a native `.ai` parser.** You must export to SVG from Illustrator
  first (see `INSTALL_GUIDE.md`).
- **Linked images are skipped**, not embedded ones. Export with
  Images: "Embed" in Illustrator so photos/rasters are inlined as base64
  and can be re-created as Figma images.
- **Fonts** must be installed and available to Figma locally; if a font
  can't be loaded the plugin falls back to Inter.
- **Transform decomposition** (used to position text/images) handles
  translate, rotate, and axis-aligned scale correctly, but ignores skew —
  rare in typical Illustrator output.
- **Text baseline vs. box**: SVG positions text by its baseline, Figma
  positions text nodes by the top of their bounding box. The plugin
  approximates the conversion; expect minor vertical drift on some fonts,
  correct visually in Figma after import.
- Complex gradients/patterns applied to **text** fill are not reproduced
  (falls back to black); gradients on **vector shapes** are preserved,
  since those pass through Figma's native SVG importer untouched.

## Tests

`lib/svg-parser.js` has no dependency on the Figma API or a real browser,
so its logic (matrix math, color/style resolution, the full
extract-images/extract-text/leave-vectors pipeline) is covered by a Node
test suite using `jsdom` to provide `DOMParser`/`XMLSerializer`:

```bash
npm install
npm test
```

`code.js` and `ui.js` are exercised inside Figma itself — see
`INSTALL_GUIDE.md` for a manual test checklist.
