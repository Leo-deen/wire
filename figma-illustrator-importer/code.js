// AI to Figma Importer — main plugin thread (runs in Figma's plugin sandbox).
// Has access to the `figma` API but NOT to the DOM (no document/window/atob).
// All SVG parsing happens in ui.html/ui.js; this file only turns the parsed
// structure into real Figma nodes.

figma.showUI(__html__, { width: 360, height: 480 });

function svgRotationToFigma(deg) {
  // SVG/CSS rotation is clockwise-positive; Figma's `rotation` is
  // counter-clockwise-positive and clamped to [-180, 180].
  var r = -deg;
  while (r > 180) r -= 360;
  while (r < -180) r += 360;
  return r;
}

function dataUriToBytes(href) {
  if (!href) return null;
  var m = href.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  // The main plugin thread has no DOM, so there is no atob() here —
  // Figma exposes its own base64 decoder for exactly this case.
  try {
    return figma.base64Decode(m[2]);
  } catch (e) {
    return null;
  }
}

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

async function buildImageNode(imageData, container) {
  var bytes = dataUriToBytes(imageData.href);
  if (!bytes) {
    return { ok: false, reason: 'no-embedded-data' };
  }
  var image;
  try {
    image = figma.createImage(bytes);
  } catch (e) {
    return { ok: false, reason: 'decode-failed' };
  }
  var rect = figma.createRectangle();
  rect.name = 'Image';
  rect.resize(Math.max(1, imageData.width || 1), Math.max(1, imageData.height || 1));
  rect.x = imageData.x || 0;
  rect.y = imageData.y || 0;
  rect.rotation = svgRotationToFigma(imageData.rotation || 0);
  rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash, opacity: imageData.opacity != null ? imageData.opacity : 1 }];
  container.appendChild(rect);
  return { ok: true, node: rect };
}

async function buildTextNode(textData, container) {
  var font = await loadFontOrFallback(textData.fontFamily, textData.fontStyle);
  var node = figma.createText();
  if (font) {
    node.fontName = font;
  }
  node.characters = textData.content || '';
  try {
    node.fontSize = Math.max(1, textData.fontSize || 16);
  } catch (e) {
    // some fonts reject certain sizes; ignore and keep default
  }
  node.textAlignHorizontal = textData.textAlign || 'LEFT';
  node.fills = [{ type: 'SOLID', color: { r: textData.color.r, g: textData.color.g, b: textData.color.b }, opacity: textData.color.a }];
  node.x = textData.x || 0;
  // SVG x/y marks the text baseline; Figma's y is the top of the text box.
  // Shift up by an approximation of the font's ascent so the glyphs land
  // close to their original position.
  node.y = (textData.y || 0) - (textData.fontSize || 16) * 0.8;
  node.rotation = svgRotationToFigma(textData.rotation || 0);
  node.name = (textData.content || 'Text').slice(0, 40);
  container.appendChild(node);
  return node;
}

function buildVectorNodes(vectorSvg, container) {
  if (!vectorSvg) return null;
  var svgNode = figma.createNodeFromSvg(vectorSvg);
  svgNode.name = 'Vectors';
  svgNode.x = 0;
  svgNode.y = 0;
  container.appendChild(svgNode);
  return svgNode;
}

async function importDocument(payload) {
  var frame = figma.createFrame();
  frame.name = payload.fileName || 'Illustrator Import';
  frame.resize(Math.max(1, payload.width || 100), Math.max(1, payload.height || 100));
  frame.clipsContent = false; // avoid silently losing content placed slightly outside bounds
  frame.fills = [];

  var center = figma.viewport.center;
  frame.x = center.x - frame.width / 2;
  frame.y = center.y - frame.height / 2;

  var results = { images: 0, imagesSkipped: 0, texts: 0, vectorsGroup: false };

  buildVectorNodes(payload.vectorSvg, frame);
  results.vectorsGroup = !!payload.vectorSvg;

  for (var i = 0; i < (payload.images || []).length; i++) {
    figma.ui.postMessage({ type: 'progress', message: 'Placing image ' + (i + 1) + ' of ' + payload.images.length + '…' });
    var imgResult = await buildImageNode(payload.images[i], frame);
    if (imgResult.ok) {
      results.images++;
    } else {
      results.imagesSkipped++;
    }
  }

  for (var j = 0; j < (payload.texts || []).length; j++) {
    figma.ui.postMessage({ type: 'progress', message: 'Placing text ' + (j + 1) + ' of ' + payload.texts.length + '…' });
    await buildTextNode(payload.texts[j], frame);
    results.texts++;
  }

  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);

  return results;
}

figma.ui.onmessage = async function (msg) {
  if (!msg || !msg.type) return;

  if (msg.type === 'import') {
    try {
      var results = await importDocument(msg.payload);
      var summary = 'Imported: ' + results.texts + ' text, ' +
        results.images + ' image' + (results.images === 1 ? '' : 's') +
        (results.imagesSkipped ? ' (' + results.imagesSkipped + ' skipped — not embedded)' : '') +
        (results.vectorsGroup ? ', vectors' : ', no vectors found');
      figma.notify(summary);
      figma.ui.postMessage({ type: 'done', summary: summary });
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
