(function () {
  'use strict';

  var statusEl = document.getElementById('bridgeStatus');
  var pushBtn = document.getElementById('pushBtn');
  var logEl = document.getElementById('log');

  var BRIDGE_URL = 'ws://localhost:8720';
  var ws = null;

  function log(msg) {
    var time = new Date().toLocaleTimeString();
    logEl.textContent = time + '  ' + msg + '\n' + logEl.textContent;
  }

  function setStatus(text, ok) {
    statusEl.textContent = text;
    statusEl.className = ok ? 'ok' : 'err';
  }

  function connect() {
    ws = new WebSocket(BRIDGE_URL);
    ws.onopen = function () {
      setStatus('Bridge connected', true);
      ws.send(JSON.stringify({ type: 'hello', role: 'illustrator' }));
    };
    ws.onclose = function () {
      setStatus('Bridge disconnected - retrying…', false);
      setTimeout(connect, 2000);
    };
    ws.onerror = function () {
      // onclose follows automatically; nothing extra to do here.
    };
  }
  connect();

  pushBtn.addEventListener('click', function () {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('Not connected to the bridge server. Make sure it is running (npm start in bridge-server/).');
      return;
    }
    pushBtn.disabled = true;
    CEPBridge.evalScript('pushSelectionToFigma()', function (result) {
      pushBtn.disabled = false;
      if (!result) {
        log('No response from Illustrator - is a document open?');
        return;
      }
      var data;
      try {
        data = JSON.parse(result);
      } catch (e) {
        log('Could not parse response from Illustrator: ' + result);
        return;
      }
      if (data.error) {
        log(data.error);
        return;
      }
      ws.send(JSON.stringify({ type: 'push', payload: data }));
      var msg = 'Pushed ' + data.nodes.length + ' top-level item(s) to Figma.';
      if (data.skipped && data.skipped.length) {
        msg += ' Skipped (unsupported in this phase): ' + data.skipped.join(', ');
      }
      log(msg);
    });
  });
})();
