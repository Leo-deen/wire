var test = require('node:test');
var assert = require('node:assert/strict');
var geo = require('../host/geometry.jsx');

test('toXY flips Y relative to artboard origin', function () {
  var origin = { left: 10, top: 100 };
  assert.equal(geo.toXY([10, 100], origin), '0 0');
  assert.equal(geo.toXY([20, 90], origin), '10 10');
  assert.equal(geo.toXY([0, 100], origin), '-10 0');
});

test('pathPointsToD: open path with straight (handle==anchor) segments', function () {
  var origin = { left: 0, top: 0 };
  var points = [
    { anchor: [0, 0], leftDirection: [0, 0], rightDirection: [0, 0] },
    { anchor: [10, 0], leftDirection: [10, 0], rightDirection: [10, 0] }
  ];
  var d = geo.pathPointsToD(points, false, origin);
  assert.equal(d, 'M 0 0 C 0 0, 10 0, 10 0');
});

test('pathPointsToD: closed path appends a final segment back to the start and Z', function () {
  var origin = { left: 0, top: 0 };
  var points = [
    { anchor: [0, 0], leftDirection: [0, 0], rightDirection: [0, 0] },
    { anchor: [10, 0], leftDirection: [10, 0], rightDirection: [10, 0] },
    { anchor: [10, 10], leftDirection: [10, 10], rightDirection: [10, 10] }
  ];
  var d = geo.pathPointsToD(points, true, origin);
  assert.ok(d.indexOf(' Z') === d.length - 2, 'should end with Z');
  assert.equal(d.split('C').length - 1, 3, 'three closing/segment curves for a 3-point closed path');
});

test('pathPointsToD: empty points returns empty string', function () {
  assert.equal(geo.pathPointsToD([], false, { left: 0, top: 0 }), '');
  assert.equal(geo.pathPointsToD(null, false, { left: 0, top: 0 }), '');
});

test('colorToRGBA: RGBColor', function () {
  var c = geo.colorToRGBA({ typename: 'RGBColor', red: 255, green: 0, blue: 0 }, 100);
  assert.deepEqual(c, { r: 1, g: 0, b: 0, a: 1 });
});

test('colorToRGBA: CMYKColor pure cyan', function () {
  var c = geo.colorToRGBA({ typename: 'CMYKColor', cyan: 100, magenta: 0, yellow: 0, black: 0 }, 100);
  assert.ok(Math.abs(c.r - 0) < 1e-9);
  assert.ok(Math.abs(c.g - 1) < 1e-9);
  assert.ok(Math.abs(c.b - 1) < 1e-9);
});

test('colorToRGBA: GrayColor', function () {
  var c = geo.colorToRGBA({ typename: 'GrayColor', gray: 100 }, 100);
  assert.deepEqual(c, { r: 0, g: 0, b: 0, a: 1 });
});

test('colorToRGBA: opacity percent is divided into 0-1 alpha', function () {
  var c = geo.colorToRGBA({ typename: 'RGBColor', red: 0, green: 0, blue: 0 }, 50);
  assert.equal(c.a, 0.5);
});

test('colorToRGBA: unsupported color type (gradient/pattern) falls back to flagged gray', function () {
  var c = geo.colorToRGBA({ typename: 'GradientColor' }, 100);
  assert.equal(c.approximate, true);
  assert.equal(c.r, 0.6);
});

test('mapItalicBoldFromStyleName', function () {
  assert.equal(geo.mapItalicBoldFromStyleName('Bold'), 'Bold');
  assert.equal(geo.mapItalicBoldFromStyleName('Italic'), 'Italic');
  assert.equal(geo.mapItalicBoldFromStyleName('Bold Italic'), 'Bold Italic');
  assert.equal(geo.mapItalicBoldFromStyleName('Regular'), 'Regular');
  // "Semibold" contains "bold", so it buckets into Bold - a reasonable
  // approximation when only four Figma style buckets are available.
  assert.equal(geo.mapItalicBoldFromStyleName('Semibold'), 'Bold');
  assert.equal(geo.mapItalicBoldFromStyleName('Light'), 'Regular');
  assert.equal(geo.mapItalicBoldFromStyleName(''), 'Regular');
});
