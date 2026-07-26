// Pure geometry/color helpers used by host/main.jsx (via #include) to turn
// Illustrator's live document model into the JSON payload the bridge
// forwards to Figma.
//
// Written in ES3-safe syntax (no let/const/arrow functions/template
// literals) because ExtendScript's engine predates ES5. This also lets the
// exact same file run unmodified under plain Node for the test suite in
// ../test/geometry.test.js - there is no Illustrator-only API used here.

// Illustrator anchor/handle points are [x, y] in the document's ruler space
// (Y increases upward). Figma's space has Y increasing downward with (0,0)
// at a frame's top-left corner. `origin` is the active artboard's
// {left, top} in document space, so this maps a point into
// frame-relative, Y-down coordinates in one step.
function toXY(pt, origin) {
  return (pt[0] - origin.left) + ' ' + (origin.top - pt[1]);
}

// Builds an SVG-syntax path `d` string from one subpath's PathPoints.
// Every segment is emitted as a cubic bezier (control points equal to the
// anchor for straight segments produce an identical straight line), which
// keeps this simple and always correct rather than special-casing lines.
function pathPointsToD(points, closed, origin) {
  if (!points || points.length === 0) return '';
  var d = 'M ' + toXY(points[0].anchor, origin);
  var i;
  for (i = 1; i < points.length; i++) {
    d += ' C ' + toXY(points[i - 1].rightDirection, origin) + ', ' +
      toXY(points[i].leftDirection, origin) + ', ' +
      toXY(points[i].anchor, origin);
  }
  if (closed) {
    d += ' C ' + toXY(points[points.length - 1].rightDirection, origin) + ', ' +
      toXY(points[0].leftDirection, origin) + ', ' +
      toXY(points[0].anchor, origin) + ' Z';
  }
  return d;
}

// Converts an Illustrator Color object (RGBColor/CMYKColor/GrayColor) to
// {r,g,b,a} in the 0-1 range Figma's fill API expects. GradientColor and
// PatternColor aren't supported yet (Phase 2) and fall back to a flagged
// mid-gray so the shape still shows up rather than silently vanishing.
function colorToRGBA(color, opacityPercent) {
  var a = (opacityPercent === undefined || opacityPercent === null) ? 1 : opacityPercent / 100;
  if (!color || !color.typename) return { r: 0.6, g: 0.6, b: 0.6, a: a, approximate: true };
  if (color.typename === 'RGBColor') {
    return { r: color.red / 255, g: color.green / 255, b: color.blue / 255, a: a };
  }
  if (color.typename === 'CMYKColor') {
    var c = color.cyan / 100;
    var m = color.magenta / 100;
    var y = color.yellow / 100;
    var k = color.black / 100;
    return { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k), a: a };
  }
  if (color.typename === 'GrayColor') {
    var g = 1 - color.gray / 100;
    return { r: g, g: g, b: g, a: a };
  }
  return { r: 0.6, g: 0.6, b: 0.6, a: a, approximate: true };
}

// Maps an Illustrator font style name (e.g. "Bold Italic", "Semibold") to
// one of the four Figma font-style buckets. Best-effort keyword match,
// since Illustrator's style names aren't a fixed enum.
function mapItalicBoldFromStyleName(styleName) {
  var s = (styleName || '').toLowerCase();
  var bold = s.indexOf('bold') !== -1 || s.indexOf('black') !== -1 || s.indexOf('heavy') !== -1;
  var italic = s.indexOf('italic') !== -1 || s.indexOf('oblique') !== -1;
  if (bold && italic) return 'Bold Italic';
  if (bold) return 'Bold';
  if (italic) return 'Italic';
  return 'Regular';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toXY: toXY,
    pathPointsToD: pathPointsToD,
    colorToRGBA: colorToRGBA,
    mapItalicBoldFromStyleName: mapItalicBoldFromStyleName
  };
}
