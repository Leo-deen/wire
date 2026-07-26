// Minimal JSON.stringify polyfill for ExtendScript's engine, which predates
// native JSON in some Illustrator versions. Guarded so it's a no-op (and
// never overrides) when a native JSON already exists.
//
// Only stringify is implemented - main.jsx only needs to serialize its
// output; the CEP panel's JS side runs in a real Chromium webview with
// full native JSON, so parsing the result there needs no polyfill.
if (typeof JSON === 'undefined') {
  JSON = {};
}

if (typeof JSON.stringify === 'undefined') {
  JSON.quoteString = function (s) {
    var out = '"';
    var i, ch, code, hex;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      code = s.charCodeAt(i);
      if (ch === '"') {
        out += '\\"';
      } else if (ch === '\\') {
        out += '\\\\';
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else if (code < 32) {
        hex = code.toString(16);
        while (hex.length < 4) hex = '0' + hex;
        out += '\\u' + hex;
      } else {
        out += ch;
      }
    }
    return out + '"';
  };

  JSON.stringify = function (value) {
    var t = typeof value;
    if (value === null) return 'null';
    if (t === 'number') return isFinite(value) ? String(value) : 'null';
    if (t === 'boolean') return String(value);
    if (t === 'string') return JSON.quoteString(value);
    if (value instanceof Array) {
      var arrParts = [];
      var i;
      for (i = 0; i < value.length; i++) {
        arrParts.push(JSON.stringify(value[i] === undefined ? null : value[i]));
      }
      return '[' + arrParts.join(',') + ']';
    }
    if (t === 'object') {
      var objParts = [];
      for (var key in value) {
        var v = value[key];
        if (v === undefined || typeof v === 'function') continue;
        objParts.push(JSON.quoteString(key) + ':' + JSON.stringify(v));
      }
      return '{' + objParts.join(',') + '}';
    }
    return 'null';
  };
}
