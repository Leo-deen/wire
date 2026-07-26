// ExtendScript entry point, loaded by Illustrator via CSXS/manifest.xml's
// <ScriptPath>. Runs inside Illustrator's scripting engine with full access
// to the live document (app.activeDocument) - this is what lets it read
// exact bezier anchor points, real color objects, and real text ranges
// instead of going through a lossy export format.
//
// index.html's main.js calls pushSelectionToFigma() via CSInterface's
// evalScript() and gets back a JSON string, which it forwards to the
// bridge server unchanged.

#include "geometry.jsx"
#include "json2.jsx"

function walkItem(item, origin, skipped) {
  var t = item.typename;

  if (t === 'GroupItem') {
    var children = [];
    var i;
    for (i = 0; i < item.pageItems.length; i++) {
      var c = walkItem(item.pageItems[i], origin, skipped);
      if (c) children.push(c);
    }
    if (children.length === 0) return null;
    return { type: 'group', name: item.name || 'Group', children: children };
  }

  if (t === 'PathItem') {
    if (item.pathPoints.length < 2) return null;
    return {
      type: 'path',
      name: item.name || 'Path',
      d: pathPointsToD(item.pathPoints, item.closed, origin),
      windingRule: 'NONZERO',
      fill: item.filled ? colorToRGBA(item.fillColor, item.opacity) : null,
      stroke: item.stroked ? colorToRGBA(item.strokeColor, item.opacity) : null,
      strokeWidth: item.stroked ? item.strokeWidth : 0
    };
  }

  if (t === 'CompoundPathItem') {
    var parts = [];
    var first = item.pathItems.length > 0 ? item.pathItems[0] : null;
    var j;
    for (j = 0; j < item.pathItems.length; j++) {
      parts.push(pathPointsToD(item.pathItems[j].pathPoints, item.pathItems[j].closed, origin));
    }
    if (!first || parts.length === 0) return null;
    return {
      type: 'path',
      name: item.name || 'Compound Path',
      d: parts.join(' '),
      // Illustrator compound paths (e.g. letterforms with counters) rely on
      // even-odd fill to render holes correctly.
      windingRule: 'EVENODD',
      fill: first.filled ? colorToRGBA(first.fillColor, first.opacity) : null,
      stroke: first.stroked ? colorToRGBA(first.strokeColor, first.opacity) : null,
      strokeWidth: first.stroked ? first.strokeWidth : 0
    };
  }

  if (t === 'TextFrame') {
    var pos = item.anchor;
    var attrs = item.textRange.characterAttributes;
    var fontFamily = 'Arial';
    var fontStyleName = '';
    try {
      fontFamily = attrs.textFont.family;
    } catch (eFam) {
      try {
        fontFamily = attrs.textFont.name;
      } catch (eName) {
        // keep default
      }
    }
    try {
      fontStyleName = attrs.textFont.style;
    } catch (eStyle) {
      // keep default (Regular)
    }
    return {
      type: 'text',
      name: item.name || 'Text',
      x: pos[0] - origin.left,
      y: origin.top - pos[1],
      content: item.contents,
      fontFamily: fontFamily,
      fontStyle: mapItalicBoldFromStyleName(fontStyleName),
      fontSize: attrs.size,
      color: colorToRGBA(attrs.fillColor, item.opacity)
    };
  }

  // PlacedItem/RasterItem (images), MeshItem, SymbolItem, gradient meshes,
  // etc. aren't supported yet - recorded so the UI can report what was
  // skipped instead of silently dropping content.
  skipped.push(t);
  return null;
}

function pushSelectionToFigma() {
  if (app.documents.length === 0) {
    return JSON.stringify({ error: 'No document is open in Illustrator.' });
  }
  var doc = app.activeDocument;
  var sel = doc.selection;
  if (!sel || sel.length === 0) {
    return JSON.stringify({ error: 'Nothing selected. Select one or more objects in Illustrator, then try again.' });
  }

  var abIndex = doc.artboards.getActiveArtboardIndex();
  var ab = doc.artboards[abIndex];
  var rect = ab.artboardRect; // [left, top, right, bottom], Illustrator ruler space (Y up)
  var origin = { left: rect[0], top: rect[1] };
  var width = rect[2] - rect[0];
  var height = rect[1] - rect[3];

  var skipped = [];
  var nodes = [];
  var i;
  for (i = 0; i < sel.length; i++) {
    var n = walkItem(sel[i], origin, skipped);
    if (n) nodes.push(n);
  }

  return JSON.stringify({
    artboard: { name: ab.name, width: width, height: height },
    nodes: nodes,
    skipped: skipped
  });
}
