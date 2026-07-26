(function () {
  'use strict';

  var statusEl = document.getElementById('status');
  var logEl = document.getElementById('log');
  var closeBtn = document.getElementById('closeBtn');

  var BRIDGE_URL = 'ws://localhost:8720';
  var ws = null;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind || '';
  }

  function log(msg) {
    var time = new Date().toLocaleTimeString();
    logEl.textContent = time + '  ' + msg + '\n' + logEl.textContent;
  }

  function connect() {
    ws = new WebSocket(BRIDGE_URL);
    ws.onopen = function () {
      setStatus('Connected. Waiting for a push from Illustrator…', 'ok');
      ws.send(JSON.stringify({ type: 'hello', role: 'figma' }));
    };
    ws.onclose = function () {
      setStatus('Disconnected from bridge server - is `npm start` running in bridge-server/? Retrying…', 'err');
      setTimeout(connect, 2000);
    };
    ws.onerror = function () {
      // onclose follows automatically.
    };
    ws.onmessage = function (evt) {
      var msg;
      try {
        msg = JSON.parse(evt.data);
      } catch (e) {
        return;
      }
      if (msg.type === 'push') {
        setStatus('Placing pushed content…', 'ok');
        parent.postMessage({ pluginMessage: { type: 'import', payload: msg.payload } }, '*');
      }
    };
  }
  connect();

  closeBtn.addEventListener('click', function () {
    parent.postMessage({ pluginMessage: { type: 'cancel' } }, '*');
  });

  onmessage = function (event) {
    var msg = event.data.pluginMessage;
    if (!msg) return;
    if (msg.type === 'imported') {
      setStatus('Connected. Waiting for a push from Illustrator…', 'ok');
      log(msg.summary);
    } else if (msg.type === 'error') {
      setStatus('Connected. Waiting for a push from Illustrator…', 'ok');
      log('Import failed: ' + msg.message);
    }
  };
})();
