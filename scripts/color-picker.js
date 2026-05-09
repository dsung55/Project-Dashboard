// ── Shared floating color picker ───────────────────────────────────────────────
// Provides window.createFloatingColorPicker(anchorEl, initialColor, onColorChange).
// Renders a draggable HSV picker panel positioned to the right of anchorEl.
// Only one panel exists at a time; calling again replaces the previous one.

// Shared preset palette used by every swatch grid in the app
window.PRESET_COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE',
  '#007AFF', '#5856D6', '#BF5AF2', '#FF2D55', '#A2845E',
  '#8E8E93', '#1D3557', '#2D6A4F', '#E76F51', '#C77DFF'
];

// Build a preset-swatch grid + Custom-color button into the page and return an API
// for syncing/resetting/destroying it. Centralizes the previously-triplicated logic
// from dashboard.js (create + change-color modals) and project.js (project modal).
//
// opts: {
//   gridId:        id of the swatch grid container,
//   hiddenInputId: id of the hidden <input> that stores the chosen hex color,
//   customBtnId:   id of the "Custom color…" button,
//   modalSelector: CSS selector for the parent modal (used to anchor floating picker),
//   onChange:      optional callback fired whenever the selection changes
// }
window.createSwatchPicker = function (opts) {
  const grid        = document.getElementById(opts.gridId);
  const hiddenInput = document.getElementById(opts.hiddenInputId);
  if (!grid || !hiddenInput) return null;

  // Set the hidden input + fire onChange callback
  function setColor(color) {
    hiddenInput.value = color;
    opts.onChange?.(color);
  }

  // Mark a swatch as the only selected one in the grid
  function markSelected(swatchEl) {
    grid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    swatchEl.classList.add('selected');
  }

  // Get-or-create the single "custom color" swatch shown after using the floating picker
  function ensureCustomSwatch(hex) {
    let swatch = grid.querySelector('.color-swatch-custom');
    if (!swatch) {
      swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch color-swatch-custom';
      swatch.title = 'Custom';
      swatch.addEventListener('click', () => {
        markSelected(swatch);
        setColor(swatch.dataset.color);
      });
      grid.appendChild(swatch);
    }
    swatch.style.background = hex;
    swatch.dataset.color    = hex;
    return swatch;
  }

  // Build the preset swatches once
  window.PRESET_COLORS.forEach((color, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch' + (index === 0 ? ' selected' : '');
    btn.style.background = color;
    btn.dataset.color = color;
    btn.title = color;
    btn.addEventListener('click', () => {
      markSelected(btn);
      setColor(color);
    });
    grid.appendChild(btn);
  });

  // "Custom color…" button opens the floating HSV picker
  document.getElementById(opts.customBtnId)?.addEventListener('click', () => {
    const anchor = document.querySelector(opts.modalSelector);
    window.createFloatingColorPicker(anchor, hiddenInput.value || '#4A90D9', (hex) => {
      const swatch = ensureCustomSwatch(hex);
      markSelected(swatch);
      setColor(hex);
    });
  });

  return {
    // Preselect a color when opening a modal — matches preset, else creates custom swatch
    sync(color) {
      grid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      const presetMatch = [...grid.querySelectorAll('.color-swatch:not(.color-swatch-custom)')]
        .find(s => s.dataset.color === color);
      if (presetMatch) {
        presetMatch.classList.add('selected');
      } else {
        const swatch = ensureCustomSwatch(color);
        swatch.classList.add('selected');
      }
      hiddenInput.value = color;
    },
    // Reset to the first preset and remove any custom swatch (used after closing create modal)
    reset() {
      document.getElementById('ccp-panel')?.remove();
      grid.querySelector('.color-swatch-custom')?.remove();
      const swatches = grid.querySelectorAll('.color-swatch');
      swatches.forEach((s, i) => s.classList.toggle('selected', i === 0));
      hiddenInput.value = window.PRESET_COLORS[0];
    }
  };
};

(function () {

  // Convert a hex color string to {h, s, v} (h in 0-360, s/v in 0-1)
  function hexToHsv(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d !== 0) {
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: h * 360, s, v };
  }

  // Convert HSV (h in 0-360, s/v in 0-1) to a hex string
  function hsvToHex(h, s, v) {
    h = h / 360;
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return '#' + [r, g, b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
  }

  // Draw the SV gradient on the canvas for the given hue
  function drawCanvas(canvas, hue) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    // Horizontal: white → pure hue color
    const hueHex = hsvToHex(hue, 1, 1);
    const gradH = ctx.createLinearGradient(0, 0, w, 0);
    gradH.addColorStop(0, '#ffffff');
    gradH.addColorStop(1, hueHex);
    ctx.fillStyle = gradH;
    ctx.fillRect(0, 0, w, h);
    // Vertical overlay: transparent → black
    const gradV = ctx.createLinearGradient(0, 0, 0, h);
    gradV.addColorStop(0, 'rgba(0,0,0,0)');
    gradV.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradV;
    ctx.fillRect(0, 0, w, h);
  }

  // Create and display a floating color picker anchored to anchorEl.
  // onColorChange(hexString) is called as the user changes the color.
  window.createFloatingColorPicker = function (anchorEl, initialColor, onColorChange) {
    // Remove any existing picker panel
    document.getElementById('ccp-panel')?.remove();

    // Parse initial color to HSV state
    const parsed = hexToHsv(initialColor || '#4A90D9');
    let currentH = parsed.h, currentS = parsed.s, currentV = parsed.v;

    // Build the panel DOM
    const panel = document.createElement('div');
    panel.id = 'ccp-panel';
    panel.className = 'ccp-panel';
    panel.innerHTML = `
      <div class="ccp-header">
        <span class="ccp-title">Custom Color</span>
        <button class="ccp-close" type="button" title="Close">&#x2715;</button>
      </div>
      <div class="ccp-canvas-wrap">
        <canvas class="ccp-canvas" width="200" height="150"></canvas>
        <div class="ccp-cursor"></div>
      </div>
      <input type="range" class="ccp-hue-slider" min="0" max="360" step="1" value="${Math.round(currentH)}">
      <div class="ccp-bottom">
        <div class="ccp-preview"></div>
        <span class="ccp-hash">#</span>
        <input type="text" class="ccp-hex-input" maxlength="6" spellcheck="false" autocomplete="off">
      </div>
    `;
    document.body.appendChild(panel);

    const canvas    = panel.querySelector('.ccp-canvas');
    const cursor    = panel.querySelector('.ccp-cursor');
    const hueSlider = panel.querySelector('.ccp-hue-slider');
    const preview   = panel.querySelector('.ccp-preview');
    const hexInput  = panel.querySelector('.ccp-hex-input');

    // Position the panel to the right of the anchor element; fall back to left if off-screen
    function positionPanel() {
      const rect = anchorEl.getBoundingClientRect();
      const panelW = 224;
      const panelH = 268;
      let left = rect.right + 12;
      let top  = rect.top;
      if (left + panelW > window.innerWidth - 8)  left = rect.left - panelW - 12;
      if (top  + panelH > window.innerHeight - 8) top  = window.innerHeight - panelH - 8;
      if (top < 8) top = 8;
      panel.style.left = left + 'px';
      panel.style.top  = top  + 'px';
    }
    positionPanel();

    // Refresh the canvas, cursor position, preview, hex input, and fire the callback
    function updateAll(fireCallback) {
      drawCanvas(canvas, currentH);
      const hex = hsvToHex(currentH, currentS, currentV);
      preview.style.background = hex;
      hexInput.value = hex.slice(1).toUpperCase();
      // Place cursor relative to canvas pixel dimensions (canvas CSS matches attribute size)
      cursor.style.left = (currentS * canvas.width)        + 'px';
      cursor.style.top  = ((1 - currentV) * canvas.height) + 'px';
      hueSlider.value = Math.round(currentH);
      if (fireCallback !== false) onColorChange(hex);
    }

    // Initial render without firing the callback (color hasn't changed yet)
    updateAll(false);

    // ── Canvas (saturation/value) interaction ─────────────────────────────────
    let draggingCanvas = false;

    function applyCanvasPoint(e) {
      const rect = canvas.getBoundingClientRect();
      currentS = Math.max(0, Math.min((e.clientX - rect.left) / rect.width,  1));
      currentV = Math.max(0, Math.min(1 - (e.clientY - rect.top) / rect.height, 1));
      updateAll();
    }

    canvas.addEventListener('mousedown', e => {
      e.stopPropagation();
      draggingCanvas = true;
      applyCanvasPoint(e);
    });

    // ── Hue slider ────────────────────────────────────────────────────────────
    hueSlider.addEventListener('mousedown', e => e.stopPropagation());
    hueSlider.addEventListener('input', () => {
      currentH = parseFloat(hueSlider.value);
      updateAll();
    });

    // ── Hex input ─────────────────────────────────────────────────────────────
    hexInput.addEventListener('mousedown', e => e.stopPropagation());
    hexInput.addEventListener('input', () => {
      const val = hexInput.value.trim();
      if (/^[0-9a-fA-F]{6}$/.test(val)) {
        const hsv = hexToHsv('#' + val);
        currentH = hsv.h; currentS = hsv.s; currentV = hsv.v;
        drawCanvas(canvas, currentH);
        preview.style.background = '#' + val;
        cursor.style.left = (currentS * canvas.width)        + 'px';
        cursor.style.top  = ((1 - currentV) * canvas.height) + 'px';
        hueSlider.value = Math.round(currentH);
        onColorChange('#' + val);
      }
    });

    // ── Close button ──────────────────────────────────────────────────────────
    panel.querySelector('.ccp-close').addEventListener('click', () => panel.remove());

    // ── Panel dragging — works on header and any non-interactive background ───
    let draggingPanel = false, dragStartX, dragStartY, panelStartX, panelStartY;

    panel.addEventListener('mousedown', e => {
      // Let interactive elements handle their own events
      const tag = e.target.tagName.toLowerCase();
      if (['canvas', 'input', 'button'].includes(tag)) return;
      draggingPanel = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const r = panel.getBoundingClientRect();
      panelStartX = r.left;
      panelStartY = r.top;
      e.preventDefault();
    });

    // ── Document-level mouse move / up (shared for canvas + panel drag) ───────
    function onMouseMove(e) {
      if (draggingCanvas) applyCanvasPoint(e);
      if (draggingPanel) {
        panel.style.left = (panelStartX + e.clientX - dragStartX) + 'px';
        panel.style.top  = (panelStartY + e.clientY - dragStartY) + 'px';
      }
    }

    function onMouseUp() {
      draggingCanvas = false;
      draggingPanel  = false;
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);

    // Clean up document listeners when the panel is removed
    const observer = new MutationObserver(() => {
      if (!document.getElementById('ccp-panel')) {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup',   onMouseUp);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });

    return panel;
  };

})();
