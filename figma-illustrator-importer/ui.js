(function () {
  'use strict';

  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var fileInfo = document.getElementById('fileInfo');
  var statusEl = document.getElementById('status');
  var importBtn = document.getElementById('importBtn');
  var cancelBtn = document.getElementById('cancelBtn');

  var currentFile = null; // { name, text }

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = kind || '';
  }

  function baseName(name) {
    return name.replace(/\.svg$/i, '');
  }

  function handleFile(file) {
    if (!file) return;
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
      setStatus('Please choose an .svg file exported from Illustrator.', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      currentFile = { name: file.name, text: String(reader.result) };
      fileInfo.textContent = 'Selected: ' + file.name;
      importBtn.disabled = false;
      setStatus('Ready to import.', '');
    };
    reader.onerror = function () {
      setStatus('Could not read that file.', 'error');
    };
    reader.readAsText(file);
  }

  dropzone.addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', function (e) {
    handleFile(e.target.files && e.target.files[0]);
  });
  ['dragenter', 'dragover'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.remove('drag');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });

  importBtn.addEventListener('click', function () {
    if (!currentFile) return;
    importBtn.disabled = true;
    setStatus('Parsing SVG…', '');

    var doc;
    try {
      doc = SvgImporter.extractDocument(currentFile.text);
    } catch (err) {
      setStatus('Could not parse this file: ' + err.message, 'error');
      importBtn.disabled = false;
      return;
    }

    var missingImages = doc.images.filter(function (img) {
      return !img.href || img.href.indexOf('data:') !== 0;
    }).length;

    var summaryBits = [
      doc.texts.length + ' text element' + (doc.texts.length === 1 ? '' : 's'),
      doc.images.length + ' image' + (doc.images.length === 1 ? '' : 's'),
      doc.vectorSvg ? 'vector shapes' : 'no vector shapes'
    ];
    var msg = 'Found ' + summaryBits.join(', ') + '.';
    if (missingImages > 0) {
      msg += '\n' + missingImages + ' image(s) are linked, not embedded, and will be skipped. ' +
        'Re-export from Illustrator with Images: "Embed" to include them.';
    }
    setStatus(msg, '');

    parent.postMessage({
      pluginMessage: {
        type: 'import',
        payload: {
          fileName: baseName(currentFile.name),
          width: doc.width,
          height: doc.height,
          images: doc.images,
          texts: doc.texts,
          vectorSvg: doc.vectorSvg
        }
      }
    }, '*');
  });

  cancelBtn.addEventListener('click', function () {
    parent.postMessage({ pluginMessage: { type: 'cancel' } }, '*');
  });

  onmessage = function (event) {
    var msg = event.data.pluginMessage;
    if (!msg) return;
    if (msg.type === 'progress') {
      setStatus(msg.message, '');
    } else if (msg.type === 'done') {
      setStatus(msg.summary, 'success');
      importBtn.disabled = false;
    } else if (msg.type === 'error') {
      setStatus('Import failed: ' + msg.message, 'error');
      importBtn.disabled = false;
    }
  };
})();
