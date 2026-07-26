// Minimal wrapper around the native __adobe_cep__ object that Illustrator
// injects into every CEP panel's webview. We only need one call
// (evalScript), so this avoids pulling in Adobe's full CSInterface.js for
// a single method - swap this out for the official CSInterface.js from
// Adobe's CEP-Resources repo if a later phase needs more of its surface
// (menu events, theme change events, host capabilities, etc.).
window.CEPBridge = {
  evalScript: function (script, callback) {
    if (window.__adobe_cep__) {
      window.__adobe_cep__.evalScript(script, callback || function () {});
    } else {
      console.error('CEPBridge: __adobe_cep__ not found - this page is not running inside a CEP panel.');
      if (callback) callback(null);
    }
  }
};
