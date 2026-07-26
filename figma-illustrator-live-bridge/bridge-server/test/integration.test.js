// End-to-end check of everything that can run outside Illustrator/Figma
// themselves: builds a payload the same way host/main.jsx would (using the
// real geometry helpers), pushes it through a real bridge server instance
// over real sockets, and confirms the Figma-side plugin would receive an
// identical, valid payload. This is the widest slice of the pipeline
// testable without the two host applications.
var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var WebSocket = require('ws');
var createServer = require('../server.js').createServer;
var geo = require(path.join(__dirname, '..', '..', 'illustrator-extension', 'host', 'geometry.jsx'));

function openClient(port, role) {
  return new Promise(function (resolve) {
    var ws = new WebSocket('ws://localhost:' + port);
    ws.on('open', function () {
      ws.send(JSON.stringify({ type: 'hello', role: role }));
      resolve(ws);
    });
  });
}

function nextMessage(ws) {
  return new Promise(function (resolve) {
    ws.once('message', function (raw) {
      resolve(JSON.parse(raw));
    });
  });
}

// Mirrors what host/main.jsx's walkItem()/pushSelectionToFigma() produce,
// but built with plain JS objects standing in for Illustrator's
// PathItem/TextFrame DOM objects, since those only exist inside Illustrator.
function buildSamplePayload() {
  var origin = { left: 0, top: 200 };

  var triangle = {
    typename: 'PathItem',
    name: 'Triangle',
    closed: true,
    pathPoints: [
      { anchor: [0, 200], leftDirection: [0, 200], rightDirection: [0, 200] },
      { anchor: [100, 200], leftDirection: [100, 200], rightDirection: [100, 200] },
      { anchor: [50, 100], leftDirection: [50, 100], rightDirection: [50, 100] }
    ],
    filled: true,
    fillColor: { typename: 'RGBColor', red: 255, green: 0, blue: 0 },
    opacity: 100,
    stroked: false
  };

  var pathNode = {
    type: 'path',
    name: triangle.name,
    d: geo.pathPointsToD(triangle.pathPoints, triangle.closed, origin),
    windingRule: 'NONZERO',
    fill: geo.colorToRGBA(triangle.fillColor, triangle.opacity),
    stroke: null,
    strokeWidth: 0
  };

  var textNode = {
    type: 'text',
    name: 'Label',
    x: 10 - origin.left,
    y: origin.top - 190,
    content: 'Hello Figma',
    fontFamily: 'Helvetica',
    fontStyle: geo.mapItalicBoldFromStyleName('Bold'),
    fontSize: 24,
    color: geo.colorToRGBA({ typename: 'RGBColor', red: 0, green: 0, blue: 0 }, 100)
  };

  return {
    artboard: { name: 'Artboard 1', width: 200, height: 200 },
    nodes: [pathNode, { type: 'group', name: 'Label Group', children: [textNode] }],
    skipped: ['PlacedItem']
  };
}

test('a realistic Illustrator-shaped payload survives geometry building + a real relay hop intact', async function () {
  var port = 8900 + Math.floor(Math.random() * 500);
  var wss = createServer(port);
  try {
    var illustrator = await openClient(port, 'illustrator');
    var figmaPlugin = await openClient(port, 'figma');
    await new Promise(function (r) { setTimeout(r, 50); });

    var payload = buildSamplePayload();
    var received = nextMessage(figmaPlugin);
    illustrator.send(JSON.stringify({ type: 'push', payload: payload }));
    var msg = await received;

    assert.equal(msg.type, 'push');
    assert.deepEqual(msg.payload, payload, 'relayed payload must be byte-for-byte identical to what Illustrator sent');

    // Sanity-check the geometry actually produced is well-formed and
    // positioned in Figma's Y-down, frame-relative space.
    var triangleD = msg.payload.nodes[0].d;
    assert.match(triangleD, /^M 0 0 C/, 'first anchor at artboard top-left maps to (0,0)');
    assert.equal(msg.payload.nodes[0].fill.r, 1, 'red channel preserved through RGBColor conversion');

    var label = msg.payload.nodes[1].children[0];
    assert.equal(label.content, 'Hello Figma');
    assert.equal(label.fontStyle, 'Bold');

    illustrator.close();
    figmaPlugin.close();
  } finally {
    wss.close();
  }
});
