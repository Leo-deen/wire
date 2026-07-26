var test = require('node:test');
var assert = require('node:assert/strict');
var WebSocket = require('ws');
var createServer = require('../server.js').createServer;

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

test('relays a push from the illustrator role to a connected figma client', async function () {
  var port = 8800 + Math.floor(Math.random() * 500);
  var wss = createServer(port);
  try {
    var illustrator = await openClient(port, 'illustrator');
    var figma = await openClient(port, 'figma');
    // give the server a tick to register both hellos
    await new Promise(function (r) { setTimeout(r, 50); });

    var received = nextMessage(figma);
    illustrator.send(JSON.stringify({ type: 'push', payload: { nodes: [{ type: 'path', d: 'M0 0 Z' }] } }));

    var msg = await received;
    assert.equal(msg.type, 'push');
    assert.equal(msg.payload.nodes[0].type, 'path');

    illustrator.close();
    figma.close();
  } finally {
    wss.close();
  }
});

test('a push with no figma client connected does not throw', async function () {
  var port = 8800 + Math.floor(Math.random() * 500) + 1;
  var wss = createServer(port);
  try {
    var illustrator = await openClient(port, 'illustrator');
    await new Promise(function (r) { setTimeout(r, 50); });
    assert.doesNotThrow(function () {
      illustrator.send(JSON.stringify({ type: 'push', payload: { nodes: [] } }));
    });
    illustrator.close();
  } finally {
    wss.close();
  }
});

test('malformed JSON is ignored, not crashing the server', async function () {
  var port = 8800 + Math.floor(Math.random() * 500) + 2;
  var wss = createServer(port);
  try {
    var client = await openClient(port, 'illustrator');
    client.send('not json {{{');
    await new Promise(function (r) { setTimeout(r, 50); });
    // server still alive: a second, well-formed client can connect and hello
    var second = await openClient(port, 'figma');
    assert.ok(second.readyState === WebSocket.OPEN);
    client.close();
    second.close();
  } finally {
    wss.close();
  }
});
