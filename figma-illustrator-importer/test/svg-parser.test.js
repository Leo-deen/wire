var test = require('node:test');
var assert = require('node:assert/strict');
var JSDOM = require('jsdom').JSDOM;
var SvgImporter = require('../lib/svg-parser.js');

var dom = new JSDOM('<!doctype html><html><body></body></html>');
var DOMParser = dom.window.DOMParser;
var XMLSerializer = dom.window.XMLSerializer;

function extract(svg) {
  return SvgImporter.extractDocument(svg, { DOMParser: DOMParser, XMLSerializer: XMLSerializer });
}

// ---- low-level matrix / color helpers --------------------------------

test('parseTransform: translate', function () {
  var m = SvgImporter._internal.parseTransform('translate(10, 20)');
  assert.deepEqual(m, { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
});

test('parseTransform: scale with single arg applies to both axes', function () {
  var m = SvgImporter._internal.parseTransform('scale(2)');
  assert.equal(m.a, 2);
  assert.equal(m.d, 2);
});

test('parseTransform: rotate(90) then decompose gives ~90 degrees', function () {
  var m = SvgImporter._internal.parseTransform('rotate(90)');
  var d = SvgImporter._internal.decomposeMatrix(m);
  assert.ok(Math.abs(d.rotation - 90) < 1e-6, 'rotation was ' + d.rotation);
});

test('parseTransform: combined translate+rotate+scale decomposes back out', function () {
  var m = SvgImporter._internal.parseTransform('translate(50,60) rotate(45) scale(2,3)');
  var d = SvgImporter._internal.decomposeMatrix(m);
  assert.equal(d.x, 50);
  assert.equal(d.y, 60);
  assert.ok(Math.abs(d.rotation - 45) < 1e-6);
  assert.ok(Math.abs(d.scaleX - 2) < 1e-6);
  assert.ok(Math.abs(d.scaleY - 3) < 1e-6);
});

test('parseColor: 3 and 6 digit hex', function () {
  assert.deepEqual(SvgImporter._internal.parseColor('#f00'), { r: 1, g: 0, b: 0, a: 1 });
  assert.deepEqual(SvgImporter._internal.parseColor('#ff0000'), { r: 1, g: 0, b: 0, a: 1 });
});

test('parseColor: rgb()/rgba() and opacity multiplication', function () {
  var c = SvgImporter._internal.parseColor('rgba(255,0,0,0.5)', '0.5');
  assert.ok(Math.abs(c.a - 0.25) < 1e-6);
});

test('parseColor: none/transparent returns null', function () {
  assert.equal(SvgImporter._internal.parseColor('none'), null);
  assert.equal(SvgImporter._internal.parseColor('transparent'), null);
});

test('mapFontStyle: weight/style combos', function () {
  assert.equal(SvgImporter._internal.mapFontStyle('bold', 'normal'), 'Bold');
  assert.equal(SvgImporter._internal.mapFontStyle('normal', 'italic'), 'Italic');
  assert.equal(SvgImporter._internal.mapFontStyle('700', 'oblique'), 'Bold Italic');
  assert.equal(SvgImporter._internal.mapFontStyle('normal', 'normal'), 'Regular');
});

// ---- full document extraction ------------------------------------------

test('extractDocument: computes frame size from viewBox + width/height', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 400 200"></svg>';
  var doc = extract(svg);
  assert.equal(doc.width, 200);
  assert.equal(doc.height, 100);
});

test('extractDocument: falls back to viewBox size when width/height are absent', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"></svg>';
  var doc = extract(svg);
  assert.equal(doc.width, 300);
  assert.equal(doc.height, 150);
});

test('extractDocument: extracts an embedded image with position/size, and removes it from vectorSvg', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
    '<image x="10" y="20" width="30" height="40" href="data:image/png;base64,AAAA" />' +
    '<rect x="0" y="0" width="5" height="5" fill="#000"/>' +
    '</svg>';
  var doc = extract(svg);
  assert.equal(doc.images.length, 1);
  var img = doc.images[0];
  assert.equal(img.x, 10);
  assert.equal(img.y, 20);
  assert.equal(img.width, 30);
  assert.equal(img.height, 40);
  assert.equal(img.href, 'data:image/png;base64,AAAA');
  assert.ok(doc.vectorSvg.indexOf('<image') === -1);
  assert.ok(doc.vectorSvg.indexOf('rect') !== -1);
});

test('extractDocument: image position accounts for ancestor transforms (translate+rotate)', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
    '<g transform="translate(10,10) rotate(90)">' +
    '<image x="0" y="0" width="10" height="10" href="data:image/png;base64,AAAA" />' +
    '</g>' +
    '</svg>';
  var doc = extract(svg);
  var img = doc.images[0];
  // rotate(90) about origin then translate(10,10): (0,0) -> (10,10)
  assert.ok(Math.abs(img.x - 10) < 1e-6);
  assert.ok(Math.abs(img.y - 10) < 1e-6);
  assert.ok(Math.abs(img.rotation - 90) < 1e-6);
});

test('extractDocument: a linked (non-data-URI) image href is preserved so the UI can flag it', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">' +
    '<image x="0" y="0" width="10" height="10" href="linked-photo.png" />' +
    '</svg>';
  var doc = extract(svg);
  assert.equal(doc.images[0].href, 'linked-photo.png');
});

test('extractDocument: extracts text content, presentation-attribute styling, and removes it from vectorSvg', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
    '<text x="15" y="25" font-family="Helvetica, sans-serif" font-size="18" font-weight="bold" fill="#ff0000">Hello</text>' +
    '<rect x="0" y="0" width="5" height="5" fill="#000"/>' +
    '</svg>';
  var doc = extract(svg);
  assert.equal(doc.texts.length, 1);
  var t = doc.texts[0];
  assert.equal(t.content, 'Hello');
  assert.equal(t.fontFamily, 'Helvetica');
  assert.equal(t.fontStyle, 'Bold');
  assert.equal(t.fontSize, 18);
  assert.deepEqual(t.color, { r: 1, g: 0, b: 0, a: 1 });
  assert.ok(doc.vectorSvg.indexOf('<text') === -1);
});

test('extractDocument: resolves fill/font via Illustrator-style internal CSS classes', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
    '<style>.st0{fill:#00ff00;font-family:Georgia;font-size:22px;}</style>' +
    '<text class="st0" x="0" y="0">Styled</text>' +
    '</svg>';
  var doc = extract(svg);
  var t = doc.texts[0];
  assert.deepEqual(t.color, { r: 0, g: 1, b: 0, a: 1 });
  assert.equal(t.fontFamily, 'Georgia');
  assert.equal(t.fontSize, 22);
});

test('extractDocument: inline style attribute takes precedence over class and presentation attribute', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
    '<style>.st0{fill:#00ff00;}</style>' +
    '<text class="st0" fill="#0000ff" style="fill:#ff0000" x="0" y="0">Precedence</text>' +
    '</svg>';
  var doc = extract(svg);
  assert.deepEqual(doc.texts[0].color, { r: 1, g: 0, b: 0, a: 1 });
});

test('extractDocument: text inherits fill from an ancestor group when not set locally', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
    '<g fill="#123456"><text x="0" y="0">Inherited</text></g>' +
    '</svg>';
  var doc = extract(svg);
  var expected = SvgImporter._internal.parseColor('#123456');
  assert.deepEqual(doc.texts[0].color, expected);
});

test('extractDocument: multi-line tspans join with newlines', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
    '<text x="0" y="0"><tspan x="0" y="20">Line one</tspan><tspan x="0" y="40">Line two</tspan></text>' +
    '</svg>';
  var doc = extract(svg);
  assert.equal(doc.texts[0].content, 'Line one\nLine two');
});

test('extractDocument: vectorSvg is null when only text/images are present (no shapes left)', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">' +
    '<text x="0" y="0">Only text</text>' +
    '</svg>';
  var doc = extract(svg);
  assert.equal(doc.vectorSvg, null);
});

test('extractDocument: vector shapes remain in vectorSvg with defs/gradients intact', function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">' +
    '<defs><linearGradient id="g1"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
    '<path d="M0 0 L10 10 Z" fill="url(#g1)"/>' +
    '</svg>';
  var doc = extract(svg);
  assert.ok(doc.vectorSvg.indexOf('linearGradient') !== -1);
  assert.ok(doc.vectorSvg.indexOf('<path') !== -1);
});

test('extractDocument: throws a helpful error for invalid SVG', function () {
  assert.throws(function () {
    extract('not xml at all <<<');
  });
});

test('extractDocument: throws when the root element is not <svg>', function () {
  assert.throws(function () {
    extract('<notsvg xmlns="http://www.w3.org/2000/svg"></notsvg>');
  });
});
