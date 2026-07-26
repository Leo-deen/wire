# Install & Run: AI to Figma Live Bridge

Three pieces need to be running/installed for this to work: the bridge
server (a background process), the Illustrator panel (a one-time install),
and the Figma plugin (a one-time install, same as before). Set them up in
this order.

## 1. Get the code

Same as the SVG importer: download or `git clone` this repo on branch
`claude/illustrator-figma-plugin-x9wedk`, then work from the
`figma-illustrator-live-bridge/` folder. You'll need [Node.js](https://nodejs.org)
installed (any recent LTS version) for the bridge server.

## 2. Start the bridge server

This is a small background process that stays running while you work —
think of it like a local dev server.

```bash
cd figma-illustrator-live-bridge/bridge-server
npm install
npm start
```

You should see:
```
[bridge] AI-to-Figma bridge listening on ws://localhost:8720
```
Leave this terminal window open. Restart it any time with `npm start` if
you close it.

## 3. Install the Illustrator panel

Illustrator only loads unsigned/local extensions like this one in
**debug mode**, which is a one-time toggle.

### Enable debug mode

**macOS** — open Terminal and run:
```bash
defaults write com.adobe.CSXS.9 PlayerDebugMode 1
defaults write com.adobe.CSXS.10 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
```

**Windows** — open Command Prompt and run:
```cmd
reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
```
(Running all three CSXS version numbers covers different Illustrator
releases — harmless if a given version isn't installed.)

### Copy the extension into place

Copy the whole `illustrator-extension/` folder into Adobe's CEP extensions
directory, and **rename the copied folder** to something without spaces
(e.g. `ai-to-figma-bridge`):

- **macOS**: `~/Library/Application Support/Adobe/CEP/extensions/`
- **Windows**: `%APPDATA%\Adobe\CEP\extensions\`

(Create the `extensions` folder if it doesn't already exist.)

### Open it in Illustrator

1. Fully quit and reopen Illustrator.
2. Open a document.
3. Go to **Window → Extensions → AI to Figma Bridge**.
4. The panel appears, showing "Connecting to bridge server…", then
   "Bridge connected" once it reaches the process from Step 2.

## 4. Install the Figma plugin

Same mechanism as the SVG importer, pointed at a different folder:

1. Open the **Figma desktop app**, open any file.
2. **Figma menu → Plugins → Development → Import plugin from manifest…**
3. Select `figma-illustrator-live-bridge/figma-plugin/manifest.json`.
4. Run it: **Plugins → Development → AI to Figma Live Bridge**. Its panel
   should say "Connected. Waiting for a push from Illustrator…".

## 5. Use it

1. In Illustrator, select one or more objects (or a group).
2. Click **Push Selection to Figma** in the AI to Figma Bridge panel.
3. Switch to Figma — the plugin places the selection into a new frame
   named after your artboard: shapes as editable vectors, text as
   editable text.
4. The Illustrator panel's log shows what was pushed and lists anything it
   had to skip (see "What's not supported yet" below).

You can keep both panels open and repeat Step 5 as many times as you like
— each push creates a new frame in Figma.

## What's not supported yet (Phase 1)

- **Gradients** — a filled shape using a gradient comes in as flat gray.
- **Clip masks** — clipping groups aren't translated; ungroup and release
  the clip in Illustrator first if you need that shape in Figma right now.
- **Placed/embedded images** — skipped, and listed in the panel's log.
- **Rotated text** — text always imports at 0° rotation.

None of these are structural blockers — see `README.md`'s Roadmap section
for what each one needs. Tell me which one you hit first and I'll build it
next.

## Troubleshooting

- **Illustrator panel stuck on "Connecting to bridge server…"** — the
  bridge server (Step 2) isn't running, or Illustrator can't reach
  `localhost:8720`. Check the terminal running `npm start` is still open.
- **Panel doesn't appear under Window → Extensions** — debug mode wasn't
  enabled for the CSXS version your Illustrator uses, or the extension
  folder is in the wrong place / still has spaces in its folder name.
  Fully quit and reopen Illustrator after any change here.
- **"Nothing selected" message** — select at least one object in
  Illustrator before clicking Push.
- **Figma plugin panel says "Disconnected from bridge server"** — same
  fix as the Illustrator side: make sure `npm start` is running.
- **A pushed shape looks like solid gray** — it (or something inside a
  pushed group) uses a gradient or pattern fill, which Phase 1 doesn't
  translate yet.
