# Install & Use: AI to Figma Importer

This plugin brings Illustrator artwork into Figma as editable content: text
stays text, vector shapes stay vectors, and images land as images — all
inside one frame.

Figma plugins can't open native `.ai` files directly (Adobe doesn't publish
that format), so the workflow is: **export to SVG from Illustrator →
import that SVG with this plugin.** SVG keeps text editable and paths as
real vector data, so nothing gets flattened.

---

## Step 1 — Export your artwork from Illustrator as SVG

1. Open your `.ai` file in Adobe Illustrator.
2. Go to **File → Export → Export As…**
3. Choose **SVG** as the format, pick a filename, and click **Export**.
4. In the **SVG Options** dialog that appears, set:
   - **Styling:** `Presentation Attributes` (not "Internal CSS" — this
     makes colors/fonts explicit per-object, which the plugin reads most
     reliably; internal CSS classes are also supported as a fallback, but
     presentation attributes are the safest choice)
   - **Font → Type:** `SVG` (keeps text as real `<text>` elements instead
     of converting it to outlines — this is required for text to import
     as editable text in Figma)
   - **Images:** `Embed` (not "Link" — linked images point at external
     files the plugin can't reach, so they get skipped; embedding inlines
     the image data directly in the SVG)
   - Click **OK**

   > If you have multiple artboards, Illustrator exports one SVG per
   > artboard (or lets you pick "All" and save as SVGs to a folder).
   > Import them into Figma one at a time.

## Step 2 — Install the plugin in Figma

This is an unpublished/local plugin, so it's installed via the **Figma
desktop app** in developer mode (this is the standard, supported way to
run a plugin that isn't on the Community store):

1. Get the plugin folder onto your computer. From this repository, copy
   the whole `figma-illustrator-importer/` folder to your machine (e.g. via
   `git clone`, or download it as a ZIP and unzip it). Keep all the files
   in that folder together — don't move `ui.html`/`code.js` out of it.
2. Open the **Figma desktop app** (download it from figma.com if you
   only use the browser — local/dev plugins require the desktop app).
3. Open any Figma file (or create a new draft).
4. Click the **Figma menu** (top-left) → **Plugins** → **Development** →
   **Import plugin from manifest…**
5. In the file picker, navigate to the `figma-illustrator-importer/`
   folder and select **`manifest.json`**.
6. Figma confirms the plugin is imported. It now appears under
   **Plugins → Development → AI to Figma Importer**.

## Step 3 — Run the import

1. In your Figma file, go to **Plugins → Development → AI to Figma
   Importer**.
2. In the plugin panel, drop the `.svg` file you exported in Step 1 (or
   click the drop zone to browse for it).
3. Click **Import to Figma**.
4. The plugin creates one frame (named after your file) containing:
   - a **Vectors** group for all paths/shapes
   - one **image** layer per embedded image
   - one **text layer** per text object, fully editable
5. Figma zooms to the new frame and selects it when the import finishes.
   The status panel reports how many text/image/vector elements were
   placed, and flags any images that were skipped because they weren't
   embedded (re-export from Illustrator with Images: "Embed" and re-run).

## Troubleshooting

- **"Please choose an .svg file exported from Illustrator"** — you picked
  a non-SVG file, or a `.ai` file directly. Re-export as SVG per Step 1.
- **Some images are missing** — they were linked, not embedded, in the
  Illustrator export. Re-export with Images: "Embed".
- **Text uses the wrong font** — the plugin uses the exact font name from
  the SVG; that font must be installed on your computer and available to
  Figma. If it can't be loaded, the plugin falls back to Inter so text
  still lands, editable, in roughly the right place.
- **A shape looks slightly off** — very complex nested transforms (skewed
  groups) are approximated. Everything is still editable, so nudge it
  into place manually if needed; this is rare in typical artwork.
- **Plugin doesn't show up under Development** — double check you selected
  `manifest.json` itself (not the folder) in Step 2.5, and that
  `code.js`, `ui.html`, `ui.js`, and the `lib/` folder are still sitting
  next to it.

## Updating the plugin later

If you pull down changes to this folder later, Figma desktop picks them up
automatically the next time you run the plugin — no need to re-import,
unless the manifest itself moved or was renamed.
