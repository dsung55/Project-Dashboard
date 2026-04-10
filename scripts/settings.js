// settings.js — Settings page: theme, phases, and update log

// ── State ─────────────────────────────────────────────────────────────────────
let phases = [];

// ── Init ──────────────────────────────────────────────────────────────────────

// Load config, render phase list and set the active theme button
async function init() {
  try {
    const config = await api.getConfig();
    phases = config.phases || [];
    renderPhaseList();
    renderThemeToggle(config.theme || 'system');
  } catch (err) {
    showToast('Could not load settings: ' + err.message, true);
  }
}

document.addEventListener('DOMContentLoaded', init);

// ── Render ────────────────────────────────────────────────────────────────────

// Render the editable phase list
function renderPhaseList() {
  const list = document.getElementById('phase-list');
  if (!list) return;
  list.innerHTML = '';

  phases.forEach((phase, index) => {
    const item = document.createElement('li');
    item.className = 'phase-item';
    item.innerHTML = `
      <div class="phase-item-row">
        <span class="phase-drag-handle">&#9776;</span>
        <input class="phase-input form-input" value="${escapeHtml(phase)}" data-index="${index}">
        <button class="btn btn-ghost btn-phase-delete" data-index="${index}" title="Delete phase">&#x2715;</button>
      </div>
    `;

    // Save phase name on blur (rename)
    const input = item.querySelector('.phase-input');
    input.addEventListener('blur', () => {
      const newName = input.value.trim();
      if (!newName) {
        input.value = phases[index];  // revert to original if empty
        return;
      }
      phases[index] = newName;
      savePhases();
    });

    // Delete this phase
    item.querySelector('.btn-phase-delete').addEventListener('click', () => {
      phases.splice(index, 1);
      renderPhaseList();
      savePhases();
    });

    list.appendChild(item);
  });
}

// Highlight the active theme button
function renderThemeToggle(activeTheme) {
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === activeTheme);
  });
}

// ── Add phase ─────────────────────────────────────────────────────────────────

// Add a new phase to the list
function addPhase() {
  const input = document.getElementById('new-phase-input');
  const name  = input?.value.trim();
  if (!name) return;
  phases.push(name);
  if (input) input.value = '';
  renderPhaseList();
  savePhases();
}

// ── Save ──────────────────────────────────────────────────────────────────────

// Persist the current phase list to the server (merges with existing config)
async function savePhases() {
  try {
    const config = await api.getConfig();
    await api.saveConfig({ ...config, phases });
    showToast('Phases saved');
  } catch (err) {
    showToast('Could not save phases: ' + err.message, true);
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────────

// Apply a theme, persist it to localStorage and config.json
async function handleThemeChange(theme) {
  // Apply immediately without waiting for the server
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : '');

  // Mirror to localStorage so other pages apply it without a flash on load
  localStorage.setItem('dashboardTheme', JSON.stringify({ theme }));

  // Persist to config.json
  try {
    const config = await api.getConfig();
    await api.saveConfig({ ...config, theme });
    renderThemeToggle(theme);
  } catch (err) {
    showToast('Could not save theme: ' + err.message, true);
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Phase add form
  const addBtn   = document.getElementById('btn-add-phase');
  const addInput = document.getElementById('new-phase-input');
  addBtn?.addEventListener('click', addPhase);
  addInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPhase(); });

  // Theme toggle buttons
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => handleThemeChange(btn.dataset.theme));
  });

  // Sub-tab switching
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(p => { p.style.display = 'none'; });
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).style.display = '';
    });
  });

  // When OS color scheme changes and user has "System" selected, re-apply live
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const stored = JSON.parse(localStorage.getItem('dashboardTheme') || '{}');
    if ((stored.theme || 'system') === 'system') {
      handleThemeChange('system');
    }
  });
});

