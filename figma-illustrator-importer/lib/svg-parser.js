/**
 * Pure SVG-parsing logic for the "AI to Figma Importer" plugin.
 *
 * This module has no dependency on the Figma plugin API. It only needs
 * DOMParser / XMLSerializer, which are provided natively by the plugin's
 * UI iframe (a real browser context) and by jsdom in the test suite.
 *
 * It reads an SVG document (as exported from Adobe Illustrator) and pulls
 * it apart into three buckets that map onto how Figma represents content:
 *   - images: <image> elements -> placed as image-filled rectangles
 *   - texts:  <text> elements  -> placed as editable Figma text nodes
 *   - vectorSvg: everything else (paths/shapes/groups) left as a valid,
 *     self-contained SVG string, handed to figma.createNodeFromSvg() so
 *     Figma's own importer builds accurate vector nodes.
 *
 * UMD export: usable via require() in Node and as window.SvgImporter in
 * the browser (ui.html includes it with a plain <script> tag).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SvgImporter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  var UNIT_TO_PX = {
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    '': 1
  };

  var NAMED_COLORS = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    yellow: '#ffff00',
    gray: '#808080',
    grey: '#808080',
    orange: '#ffa500',
    purple: '#800080',
    transparent: null
  };

  // ---- length / number parsing -------------------------------------------

  function parseLength(value) {
    if (value === null || value === undefined || value === '') return null;
    var m = String(value).trim().match(/^(-?[\d.eE+-]+)\s*([a-z%]*)$/i);
    if (!m) return null;
    var num = parseFloat(m[1]);
    if (isNaN(num)) return null;
    var unit = m[2].toLowerCase();
    if (unit === '%') return num; // best-effort: treat as raw user units
    var factor = UNIT_TO_PX.hasOwnProperty(unit) ? UNIT_TO_PX[unit] : 1;
    return num * factor;
  }

  // ---- 2D affine matrix helpers ------------------------------------------

  // Composes m1 (applied second/outer) with m2 (applied first/inner): m1 . m2
  function multiply(m1, m2) {
    return {
      a: m1.a * m2.a + m1.c * m2.b,
      b: m1.b * m2.a + m1.d * m2.b,
      c: m1.a * m2.c + m1.c * m2.d,
      d: m1.b * m2.c + m1.d * m2.d,
      e: m1.a * m2.e + m1.c * m2.f + m1.e,
      f: m1.b * m2.e + m1.d * m2.f + m1.f
    };
  }

  function applyMatrixToPoint(m, x, y) {
    return {
      x: m.a * x + m.c * y + m.e,
      y: m.b * x + m.d * y + m.f
    };
  }

  // Parses the SVG `transform` attribute into a single composed matrix.
  function parseTransform(str) {
    if (!str) return { a: IDENTITY.a, b: IDENTITY.b, c: IDENTITY.c, d: IDENTITY.d, e: IDENTITY.e, f: IDENTITY.f };
    var total = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    var re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
    var m;
    while ((m = re.exec(str))) {
      var fn = m[1];
      var args = m[2]
        .split(/[\s,]+/)
        .filter(function (s) { return s !== ''; })
        .map(Number);
      var mat = IDENTITY;
      if (fn === 'matrix' && args.length === 6) {
        mat = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
      } else if (fn === 'translate') {
        mat = { a: 1, b: 0, c: 0, d: 1, e: args[0] || 0, f: args[1] || 0 };
      } else if (fn === 'scale') {
        var sx = args[0] !== undefined ? args[0] : 1;
        var sy = args[1] !== undefined ? args[1] : sx;
        mat = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
      } else if (fn === 'rotate') {
        var angle = (args[0] || 0) * Math.PI / 180;
        var cx = args[1] || 0;
        var cy = args[2] || 0;
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        var rot = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
        if (cx || cy) {
          mat = multiply(multiply({ a: 1, b: 0, c: 0, d: 1, e: cx, f: cy }, rot), { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy });
        } else {
          mat = rot;
        }
      } else if (fn === 'skewX') {
        mat = { a: 1, b: 0, c: Math.tan((args[0] || 0) * Math.PI / 180), d: 1, e: 0, f: 0 };
      } else if (fn === 'skewY') {
        mat = { a: 1, b: Math.tan((args[0] || 0) * Math.PI / 180), c: 0, d: 1, e: 0, f: 0 };
      }
      total = multiply(total, mat);
    }
    return total;
  }

  // Decomposes a matrix into translate/rotate/scale, ignoring skew.
  // Good enough for the translate+rotate+uniform-or-axis-scale matrices
  // that Illustrator/SVG transforms typically produce.
  function decomposeMatrix(m) {
    var scaleX = Math.sqrt(m.a * m.a + m.b * m.b) || 1;
    var det = m.a * m.d - m.b * m.c;
    var scaleY = (det / scaleX) || 1;
    var rotation = Math.atan2(m.b, m.a) * 180 / Math.PI;
    return { x: m.e, y: m.f, rotation: rotation, scaleX: scaleX, scaleY: scaleY };
  }

  // ---- color parsing ------------------------------------------------------

  function clamp01(n) {
    return Math.max(0, Math.min(1, n));
  }

  function parseColor(value, opacity) {
    var alpha = 1;
    if (opacity !== undefined && opacity !== null && opacity !== '') {
      var op = parseFloat(opacity);
      if (!isNaN(op)) alpha = clamp01(op);
    }
    if (!value) return null;
    var v = String(value).trim().toLowerCase();
    if (v === 'none' || v === 'transparent') return null;
    if (NAMED_COLORS.hasOwnProperty(v)) {
      var named = NAMED_COLORS[v];
      if (named === null) return null;
      v = named;
    }
    if (v[0] === '#') {
      var hex = v.slice(1);
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      if (hex.length !== 6) return { r: 0, g: 0, b: 0, a: alpha };
      var r = parseInt(hex.slice(0, 2), 16) / 255;
      var g = parseInt(hex.slice(2, 4), 16) / 255;
      var b = parseInt(hex.slice(4, 6), 16) / 255;
      return { r: r, g: g, b: b, a: alpha };
    }
    var rgbMatch = v.match(/rgba?\(([^)]+)\)/);
    if (rgbMatch) {
      var parts = rgbMatch[1].split(',').map(function (s) { return s.trim(); });
      var pr = parseFloat(parts[0]) / 255;
      var pg = parseFloat(parts[1]) / 255;
      var pb = parseFloat(parts[2]) / 255;
      var pa = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
      return { r: clamp01(pr), g: clamp01(pg), b: clamp01(pb), a: clamp01(alpha * pa) };
    }
    // Unknown format (e.g. url(#gradient)) - not a flat color we can map.
    return null;
  }

  // ---- CSS class / inline style resolution --------------------------------

  function parseStylesheet(doc) {
    var map = {};
    var styleEls = doc.getElementsByTagName('style');
    for (var i = 0; i < styleEls.length; i++) {
      var css = styleEls[i].textContent || '';
      var ruleRe = /\.([\w-]+)\s*\{([^}]*)\}/g;
      var m;
      while ((m = ruleRe.exec(css))) {
        var cls = m[1];
        var decl = map[cls] || {};
        m[2].split(';').forEach(function (pair) {
          var idx = pair.indexOf(':');
          if (idx === -1) return;
          var k = pair.slice(0, idx).trim().toLowerCase();
          var val = pair.slice(idx + 1).trim();
          if (k) decl[k] = val;
        });
        map[cls] = decl;
      }
    }
    return map;
  }

  function inlineStyleValue(el, prop) {
    var styleAttr = el.getAttribute('style');
    if (!styleAttr) return null;
    var re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i');
    var m = styleAttr.match(re);
    return m ? m[1].trim() : null;
  }

  function classStyleValue(el, prop, classMap) {
    var classAttr = el.getAttribute('class');
    if (!classAttr || !classMap) return null;
    var classes = classAttr.trim().split(/\s+/);
    for (var i = 0; i < classes.length; i++) {
      var decl = classMap[classes[i]];
      if (decl && decl[prop] !== undefined) return decl[prop];
    }
    return null;
  }

  // Resolves prop on el only, in CSS-precedence order:
  // inline style > class rule > presentation attribute.
  function getStyleValue(el, prop, classMap) {
    var v = inlineStyleValue(el, prop);
    if (v !== null) return v;
    v = classStyleValue(el, prop, classMap);
    if (v !== null) return v;
    v = el.getAttribute(prop);
    if (v !== null && v !== '') return v;
    return null;
  }

  // Resolves prop on el, walking up through ancestors (svg inheritance)
  // until found, falling back to defaultValue.
  function resolveInherited(el, prop, classMap, defaultValue) {
    var node = el;
    while (node && node.nodeType === 1) {
      var v = getStyleValue(node, prop, classMap);
      if (v !== null && v !== undefined && v.toLowerCase && v.toLowerCase() !== 'inherit') return v;
      node = node.parentNode && node.parentNode.nodeType === 1 ? node.parentNode : null;
    }
    return defaultValue;
  }

  // ---- font style mapping --------------------------------------------------

  function mapFontStyle(fontWeight, fontStyle) {
    var weight = (fontWeight || 'normal').toLowerCase();
    var style = (fontStyle || 'normal').toLowerCase();
    var isBold = weight === 'bold' || weight === 'bolder' || (parseInt(weight, 10) >= 600 && !isNaN(parseInt(weight, 10)));
    var isItalic = style === 'italic' || style === 'oblique';
    if (isBold && isItalic) return 'Bold Italic';
    if (isBold) return 'Bold';
    if (isItalic) return 'Italic';
    return 'Regular';
  }

  function firstFontFamily(family) {
    if (!family) return 'Arial';
    var first = family.split(',')[0].trim();
    return first.replace(/^["']|["']$/g, '') || 'Arial';
  }

  // ---- main extraction ------------------------------------------------------

  var SKIP_TAGS = { defs: 1, clippath: 1, style: 1, metadata: 1, title: 1, desc: 1, symbol: 1, mask: 1, filter: 1, lineargradient: 1, radialgradient: 1, pattern: 1 };
  var VECTOR_SHAPE_TAGS = { path: 1, rect: 1, circle: 1, ellipse: 1, polygon: 1, polyline: 1, line: 1, use: 1 };

  function extractDocument(svgText, opts) {
    opts = opts || {};
    var DOMParserCtor = opts.DOMParser || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    var XMLSerializerCtor = opts.XMLSerializer || (typeof XMLSerializer !== 'undefined' ? XMLSerializer : null);
    if (!DOMParserCtor || !XMLSerializerCtor) {
      throw new Error('DOMParser/XMLSerializer not available in this environment');
    }

    var parser = new DOMParserCtor();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    var errorNode = doc.getElementsByTagName('parsererror')[0];
    if (errorNode) {
      throw new Error('Could not parse SVG: ' + errorNode.textContent);
    }
    var svgEl = doc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') {
      throw new Error('This file does not look like a valid SVG document.');
    }

    var viewBoxAttr = svgEl.getAttribute('viewBox');
    var vb = viewBoxAttr ? viewBoxAttr.trim().split(/[\s,]+/).map(Number) : null;
    var widthAttr = parseLength(svgEl.getAttribute('width'));
    var heightAttr = parseLength(svgEl.getAttribute('height'));
    var width = widthAttr || (vb ? vb[2] : 100) || 100;
    var height = heightAttr || (vb ? vb[3] : 100) || 100;
    var rootScaleX = vb && vb[2] ? width / vb[2] : 1;
    var rootScaleY = vb && vb[3] ? height / vb[3] : 1;
    var rootOffsetX = vb ? -vb[0] * rootScaleX : 0;
    var rootOffsetY = vb ? -vb[1] * rootScaleY : 0;
    var rootMatrix = { a: rootScaleX, b: 0, c: 0, d: rootScaleY, e: rootOffsetX, f: rootOffsetY };

    var classMap = parseStylesheet(doc);
    var images = [];
    var texts = [];
    var toRemove = [];
    var imgCounter = 0;
    var textCounter = 0;

    function extractImage(el, matrix) {
      var href = el.getAttribute('href') || el.getAttribute('xlink:href') ||
        (el.getAttributeNS && el.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
      var x = parseFloat(el.getAttribute('x') || '0') || 0;
      var y = parseFloat(el.getAttribute('y') || '0') || 0;
      var w = parseFloat(el.getAttribute('width') || '0') || 0;
      var h = parseFloat(el.getAttribute('height') || '0') || 0;
      var topLeft = applyMatrixToPoint(matrix, x, y);
      var decomposed = decomposeMatrix(matrix);
      var opacityRaw = getStyleValue(el, 'opacity', classMap);
      var opacity = opacityRaw !== null ? clamp01(parseFloat(opacityRaw)) : 1;
      images.push({
        id: 'image-' + (imgCounter++),
        href: href || null,
        x: topLeft.x,
        y: topLeft.y,
        width: Math.abs(w * decomposed.scaleX),
        height: Math.abs(h * decomposed.scaleY),
        rotation: decomposed.rotation,
        opacity: isNaN(opacity) ? 1 : opacity
      });
    }

    function extractText(el, matrix) {
      var tspans = el.getElementsByTagName('tspan');
      var content;
      if (tspans.length > 1) {
        var lines = [];
        for (var i = 0; i < tspans.length; i++) lines.push(tspans[i].textContent);
        content = lines.join('\n');
      } else {
        content = el.textContent || '';
      }

      var x = parseFloat(el.getAttribute('x') || '0') || 0;
      var y = parseFloat(el.getAttribute('y') || '0') || 0;
      var pos = applyMatrixToPoint(matrix, x, y);
      var decomposed = decomposeMatrix(matrix);

      var fontFamily = firstFontFamily(resolveInherited(el, 'font-family', classMap, 'Arial'));
      var fontSizeRaw = resolveInherited(el, 'font-size', classMap, '16');
      var fontSize = (parseLength(fontSizeRaw) || 16) * Math.abs(decomposed.scaleY);
      var fontWeight = resolveInherited(el, 'font-weight', classMap, 'normal');
      var fontStyle = resolveInherited(el, 'font-style', classMap, 'normal');
      var fillRaw = resolveInherited(el, 'fill', classMap, '#000000');
      var fillOpacity = resolveInherited(el, 'fill-opacity', classMap, '1');
      var opacityRaw = resolveInherited(el, 'opacity', classMap, '1');
      var color = parseColor(fillRaw, fillOpacity) || { r: 0, g: 0, b: 0, a: 1 };
      var overallOpacity = parseFloat(opacityRaw);
      if (!isNaN(overallOpacity)) color = { r: color.r, g: color.g, b: color.b, a: clamp01(color.a * overallOpacity) };
      var anchor = resolveInherited(el, 'text-anchor', classMap, 'start');

      texts.push({
        id: 'text-' + (textCounter++),
        content: content,
        x: pos.x,
        y: pos.y,
        rotation: decomposed.rotation,
        fontFamily: fontFamily,
        fontStyle: mapFontStyle(fontWeight, fontStyle),
        fontSize: fontSize,
        color: color,
        textAlign: anchor === 'middle' ? 'CENTER' : anchor === 'end' ? 'RIGHT' : 'LEFT'
      });
    }

    function walk(el, matrix) {
      if (!el || el.nodeType !== 1) return;
      var tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (SKIP_TAGS[tag]) return;

      var localMatrix = parseTransform(el.getAttribute('transform'));
      var current = multiply(matrix, localMatrix);

      if (tag === 'image') {
        extractImage(el, current);
        toRemove.push(el);
        return;
      }
      if (tag === 'text') {
        extractText(el, current);
        toRemove.push(el);
        return;
      }

      var children = el.children ? Array.prototype.slice.call(el.children) : [];
      for (var i = 0; i < children.length; i++) walk(children[i], current);
    }

    walk(svgEl, rootMatrix);

    toRemove.forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });

    var hasShapes = false;
    for (var tag in VECTOR_SHAPE_TAGS) {
      if (svgEl.getElementsByTagName(tag).length > 0) {
        hasShapes = true;
        break;
      }
    }

    var vectorSvg = null;
    if (hasShapes) {
      var serializer = new XMLSerializerCtor();
      vectorSvg = serializer.serializeToString(svgEl);
    }

    return {
      width: width,
      height: height,
      images: images,
      texts: texts,
      vectorSvg: vectorSvg
    };
  }

  return {
    extractDocument: extractDocument,
    // exposed for unit testing / advanced use
    _internal: {
      parseLength: parseLength,
      multiply: multiply,
      applyMatrixToPoint: applyMatrixToPoint,
      parseTransform: parseTransform,
      decomposeMatrix: decomposeMatrix,
      parseColor: parseColor,
      parseStylesheet: parseStylesheet,
      getStyleValue: getStyleValue,
      resolveInherited: resolveInherited,
      mapFontStyle: mapFontStyle,
      firstFontFamily: firstFontFamily
    }
  };
});
