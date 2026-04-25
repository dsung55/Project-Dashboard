// settings.js — Settings page: theme, phases, customizations, and update log

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
  initCustomizations();
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

    // Delete this phase — migrate any projects in it to the previous phase first
    item.querySelector('.btn-phase-delete').addEventListener('click', async () => {
      if (phases.length <= 1) {
        showToast('Cannot delete the only remaining phase', true);
        return;
      }
      const deletedPhase  = phases[index];
      const fallbackPhase = index > 0 ? phases[index - 1] : phases[index + 1];
      phases.splice(index, 1);
      renderPhaseList();
      await savePhases();

      // Move any projects that were in the deleted phase to the fallback phase
      try {
        const projects = await api.getProjects();
        const affected  = projects.filter(p => p.phase === deletedPhase);
        if (affected.length > 0) {
          await Promise.all(affected.map(async p => {
            const full = await api.getProject(p.id);
            await api.saveProject(p.id, { ...full, phase: fallbackPhase });
          }));
          showToast(`Moved ${affected.length} project${affected.length !== 1 ? 's' : ''} to "${fallbackPhase}"`);
        }
      } catch (err) {
        showToast('Could not migrate some projects: ' + err.message, true);
      }
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

// ── Customizations tab ────────────────────────────────────────────────────────

// Bootstrap the Customizations tab: restore bg state and load project list
async function initCustomizations() {
  restoreGlobalBgUI();
  try {
    const projects = await api.getProjects();
    renderProjectBgList(projects);
  } catch (err) {
    const el = document.getElementById('project-bg-loading');
    if (el) el.textContent = 'Could not load projects.';
  }
}

// Sync the global-bg upload zone to what is stored in localStorage
function restoreGlobalBgUI() {
  const stored = localStorage.getItem('dashboardGlobalBg');
  const hasApplied = !!stored;
  // Always show the preview if the server has an image — check by fetching HEAD
  fetch('/api/backgrounds/global', { method: 'HEAD' })
    .then(r => {
      if (r.ok) showGlobalBgUI(true, hasApplied);
      else       showGlobalBgUI(false, false);
    })
    .catch(() => showGlobalBgUI(false, false));
}

// Show or hide the global-bg preview, apply checkbox, and remove button
function showGlobalBgUI(hasImage, isApplied) {
  const preview   = document.getElementById('global-bg-preview');
  const thumb     = document.getElementById('global-bg-thumb');
  const applyWrap = document.getElementById('global-bg-apply-wrap');
  const checkbox  = document.getElementById('global-bg-apply-checkbox');
  const removeBtn = document.getElementById('btn-remove-global-bg');

  if (hasImage) {
    // Cache-bust so the browser always shows the current file
    thumb.src = '/api/backgrounds/global?t=' + Date.now();
    preview.style.display   = '';
    applyWrap.style.display = '';
    removeBtn.style.display = '';
    checkbox.checked = isApplied;
  } else {
    preview.style.display   = 'none';
    applyWrap.style.display = 'none';
    removeBtn.style.display = 'none';
    checkbox.checked = false;
  }
}

// Resize an image File to fit within the screen dimensions, returning a Blob
function resizeImageToScreen(file) {
  return new Promise((resolve, reject) => {
    const maxW = window.screen.width  || 1920;
    const maxH = window.screen.height || 1080;
    const img  = new Image();
    const url  = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Scale down only — never enlarge
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const scale = Math.min(1, maxW / w, maxH / h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), 'image/jpeg', 0.90);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

// Handle uploading a new global background photo
async function handleGlobalBgUpload(file) {
  try {
    const resized = await resizeImageToScreen(file);
    await api.uploadGlobalBackground(resized);
    // After upload, default to applied
    const url = '/api/backgrounds/global?t=' + Date.now();
    localStorage.setItem('dashboardGlobalBg', url);
    api.applyGlobalBackground();
    showGlobalBgUI(true, true);
    showToast('Background uploaded and applied');
  } catch (err) {
    showToast('Could not upload background: ' + err.message, true);
  }
}

// Handle removing the global background
async function handleRemoveGlobalBg() {
  try {
    await api.removeGlobalBackground();  // also clears localStorage + unapplies
    showGlobalBgUI(false, false);
    showToast('Background removed');
  } catch (err) {
    showToast('Could not remove background: ' + err.message, true);
  }
}

// Render the per-project background list
function renderProjectBgList(projects) {
  const container = document.getElementById('project-bg-list');
  if (!container) return;

  if (!projects.length) {
    container.innerHTML = '<p class="text-secondary text-sm">No projects yet.</p>';
    return;
  }

  container.innerHTML = '';
  projects.forEach(project => {
    const hasBg = !!localStorage.getItem('dashboardProjectBg_' + project.id);
    const item  = document.createElement('div');
    item.className = 'project-bg-item';
    item.dataset.id = project.id;

    item.innerHTML = `
      <div class="project-bg-item-info">
        <span class="project-bg-color-dot" style="background:${escapeHtml(project.color || '#ccc')}"></span>
        <span class="project-bg-item-name">${escapeHtml(project.name)}</span>
      </div>
      <div class="project-bg-item-actions">
        <div class="project-bg-thumb-wrap" style="${hasBg ? '' : 'display:none'}">
          <img class="bg-preview-thumb bg-preview-thumb--sm"
               src="${hasBg ? '/api/projects/' + project.id + '/background?t=' + Date.now() : ''}"
               alt="">
        </div>
        <label class="btn btn-secondary btn-sm" for="proj-bg-${escapeHtml(project.id)}" style="cursor:pointer">
          ${hasBg ? 'Change' : 'Set Background'}
        </label>
        <input type="file" id="proj-bg-${escapeHtml(project.id)}"
               data-project-id="${escapeHtml(project.id)}"
               accept="image/*" class="visually-hidden proj-bg-input">
        <button class="btn btn-ghost btn-sm btn-remove-proj-bg"
                data-project-id="${escapeHtml(project.id)}"
                style="${hasBg ? '' : 'display:none'}">Remove</button>
      </div>
    `;
    container.appendChild(item);
  });

  // Wire up file inputs
  container.querySelectorAll('.proj-bg-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const file      = e.target.files[0];
      const projectId = input.dataset.projectId;
      if (!file || !projectId) return;
      try {
        const resized = await resizeImageToScreen(file);
        await api.uploadProjectBackground(projectId, resized);
        const url = '/api/projects/' + projectId + '/background?t=' + Date.now();
        localStorage.setItem('dashboardProjectBg_' + projectId, url);
        // Re-render to reflect the new state
        const projects = await api.getProjects();
        renderProjectBgList(projects);
        showToast('Project background updated');
      } catch (err) {
        showToast('Could not upload project background: ' + err.message, true);
      }
      input.value = '';
    });
  });

  // Wire up remove buttons
  container.querySelectorAll('.btn-remove-proj-bg').forEach(btn => {
    btn.addEventListener('click', async () => {
      const projectId = btn.dataset.projectId;
      try {
        await api.removeProjectBackground(projectId);
        const projects = await api.getProjects();
        renderProjectBgList(projects);
        showToast('Project background removed');
      } catch (err) {
        showToast('Could not remove project background: ' + err.message, true);
      }
    });
  });
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

  // Global background file input
  const globalBgInput = document.getElementById('global-bg-file-input');
  globalBgInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleGlobalBgUpload(file);
    globalBgInput.value = '';
  });

  // Global background remove button
  document.getElementById('btn-remove-global-bg')?.addEventListener('click', handleRemoveGlobalBg);

  // Apply-globally checkbox
  document.getElementById('global-bg-apply-checkbox')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      const url = '/api/backgrounds/global?t=' + Date.now();
      localStorage.setItem('dashboardGlobalBg', url);
    } else {
      localStorage.removeItem('dashboardGlobalBg');
    }
    api.applyGlobalBackground();
  });
});

