// AI to Figma Live Bridge - main plugin thread.
//
// Unlike the SVG-based importer, this plugin never parses a file. It
// receives a structured JSON payload (built directly from Illustrator's
// live document model by the CEP panel) via ui.js's WebSocket connection,
// and builds native Figma nodes straight from that structure:
//   - 'path'  -> figma.createVector() with exact bezier data (vectorPaths)
//   - 'text'  -> figma.createText(), a real editable text node
//   - 'group' -> figma.group() of already-built children
//
// Path/text coordinates arrive already in frame-relative, Y-down space
// (the CEP panel does that conversion against the active artboard), so no
// transform decomposition is needed here.

figma.showUI(__html__, { width: 340, height: 300 });

async function loadFontOrFallback(fontFamily, fontStyle) {
  var candidates = [
    { family: fontFamily, style: fontStyle },
    { family: fontFamily, style: 'Regular' },
    { family: 'Inter', style: fontStyle },
    { family: 'Inter', style: 'Regular' }
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      await figma.loadFontAsync(candidates[i]);
      return candidates[i];
    } catch (e) {
      // try next candidate
    }
  }
  return null;
}

function buildPathNode(n, container) {
  var vec = figma.createVector();
  vec.name = n.name || 'Path';
  vec.vectorPaths = [{
    windingRule: n.windingRule === 'EVENODD' ? 'EVENODD' : 'NONZERO',
    data: n.d
  }];
  var fills = [];
  if (n.fill) {
    fills.push({ type: 'SOLID', color: { r: n.fill.r, g: n.fill.g, b: n.fill.b }, opacity: n.fill.a });
  }
  vec.fills = fills;
  var strokes = [];
  if (n.stroke) {
    strokes.push({ type: 'SOLID', color: { r: n.stroke.r, g: n.stroke.g, b: n.stroke.b }, opacity: n.stroke.a });
  }
  vec.strokes = strokes;
  if (n.strokeWidth) vec.strokeWeight = n.strokeWidth;
  container.appendChild(vec);
  return vec;
}

async function buildTextNode(n, container) {
  var font = await loadFontOrFallback(n.fontFamily, n.fontStyle);
  var node = figma.createText();
  if (font) node.fontName = font;
  node.characters = n.content || '';
  try {
    node.fontSize = Math.max(1, n.fontSize || 16);
  } catch (e) {
    // some fonts reject certain sizes; keep default
  }
  var color = n.color || { r: 0, g: 0, b: 0, a: 1 };
  node.fills = [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a }];
  node.x = n.x || 0;
  // Illustrator's text anchor is the baseline; Figma positions by the top
  // of the text box. Approximate the shift using the font size.
  node.y = (n.y || 0) - (n.fontSize || 16) * 0.8;
  node.name = (n.content || 'Text').slice(0, 40);
  container.appendChild(node);
  return node;
}

async function buildGroupNode(n, container) {
  var created = [];
  for (var i = 0; i < (n.children || []).length; i++) {
    var child = await buildAnyNode(n.children[i], container);
    if (child) created.push(child);
  }
  if (created.length === 0) return null;
  if (created.length === 1) {
    created[0].name = n.name || created[0].name;
    return created[0];
  }
  var group = figma.group(created, container);
  group.name = n.name || 'Group';
  return group;
}

async function buildAnyNode(n, container) {
  if (!n) return null;
  if (n.type === 'path') return buildPathNode(n, container);
  if (n.type === 'text') return await buildTextNode(n, container);
  if (n.type === 'group') return await buildGroupNode(n, container);
  return null;
}

async function importPush(payload) {
  var frame = figma.createFrame();
  frame.name = (payload.artboard && payload.artboard.name) || 'Illustrator Push';
  var width = (payload.artboard && payload.artboard.width) || 100;
  var height = (payload.artboard && payload.artboard.height) || 100;
  frame.resize(Math.max(1, width), Math.max(1, height));
  frame.clipsContent = false;
  frame.fills = [];

  var center = figma.viewport.center;
  frame.x = center.x - frame.width / 2;
  frame.y = center.y - frame.height / 2;

  var built = 0;
  for (var i = 0; i < (payload.nodes || []).length; i++) {
    var node = await buildAnyNode(payload.nodes[i], frame);
    if (node) built++;
  }

  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);

  return { built: built, skipped: payload.skipped || [] };
}

figma.ui.onmessage = async function (msg) {
  if (!msg || !msg.type) return;

  if (msg.type === 'import') {
    try {
      var result = await importPush(msg.payload);
      var summary = 'Placed ' + result.built + ' item(s) from Illustrator.';
      if (result.skipped.length) {
        summary += ' Skipped: ' + result.skipped.join(', ') + '.';
      }
      figma.notify(summary);
      figma.ui.postMessage({ type: 'imported', summary: summary });
    } catch (err) {
      var message = (err && err.message) || String(err);
      figma.notify('Import failed: ' + message, { error: true });
      figma.ui.postMessage({ type: 'error', message: message });
    }
    return;
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
