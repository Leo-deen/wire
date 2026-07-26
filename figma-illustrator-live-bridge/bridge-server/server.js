// Local relay between the Illustrator CEP panel and the Figma plugin.
//
// Both sides connect to this as WebSocket clients and identify themselves
// with a {type:'hello', role:'illustrator'|'figma'} message. Any {type:'push'}
// message from an 'illustrator' client is forwarded verbatim to every
// connected 'figma' client. Nothing here understands the payload shape —
// that's decided entirely by the two endpoints.

var WebSocket = require('ws');

function createServer(port) {
  var wss = new WebSocket.Server({ port: port });
  var clients = { illustrator: new Set(), figma: new Set() };

  function log(msg) {
    console.log('[bridge] ' + msg);
  }

  wss.on('connection', function (ws) {
    ws.role = null;
    log('client connected');

    ws.on('message', function (raw) {
      var msg;
      try {
        msg = JSON.parse(raw);
      } catch (e) {
        log('ignoring malformed message');
        return;
      }

      if (msg.type === 'hello' && (msg.role === 'illustrator' || msg.role === 'figma')) {
        ws.role = msg.role;
        clients[msg.role].add(ws);
        log(msg.role + ' connected (' + clients[msg.role].size + ' total)');
        return;
      }

      if (msg.type === 'push') {
        if (clients.figma.size === 0) {
          log('push received but no Figma plugin is connected - open the plugin in Figma first');
          return;
        }
        clients.figma.forEach(function (client) {
          if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
        });
        log('relayed push to ' + clients.figma.size + ' Figma client(s)');
      }
    });

    ws.on('close', function () {
      if (ws.role && clients[ws.role]) {
        clients[ws.role].delete(ws);
        log(ws.role + ' disconnected (' + clients[ws.role].size + ' remaining)');
      }
    });
  });

  log('AI-to-Figma bridge listening on ws://localhost:' + port);
  return wss;
}

if (require.main === module) {
  var port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8720;
  createServer(port);
}

module.exports = { createServer: createServer };
