// dashboard.js — Home page: renders project cards grouped by phase, handles create/delete

// ── Preset colors for the color picker (visually distinct palette) ─────────────
const PRESET_COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE',
  '#007AFF', '#5856D6', '#BF5AF2', '#FF2D55', '#A2845E',
  '#8E8E93', '#1D3557', '#2D6A4F', '#E76F51', '#C77DFF'
];

// ── State ─────────────────────────────────────────────────────────────────────
let allProjects          = [];
let allPhases            = [];
let pendingDeleteId      = null;   // id of the project the user is about to delete
let pendingColorChangeId = null;   // id of the project whose color is being changed
let refreshPending       = false;  // prevents concurrent in-flight project fetches

// Drag state
let draggedProject       = null;   // the full project object being dragged
let dropTargetCard       = null;   // card element currently showing a same-phase drop indicator
let dropInsertBefore     = true;   // true = insert before dropTargetCard, false = after
let crossPhaseDropTarget = null;   // card in a different-phase section showing insertion indicator
let crossPhaseInsertBefore = true; // direction for the cross-phase insertion indicator

// ── Init ──────────────────────────────────────────────────────────────────────

// First load: fetch projects AND config (phases), then render
async function init() {
  try {
    const [projects, config] = await Promise.all([
      api.getProjects(),
      api.getConfig()
    ]);
    allProjects = projects;
    allPhases   = config.phases || [];
    renderDashboard();
    populatePhaseDropdown();
  } catch (err) {
    showToast('Could not load dashboard: ' + err.message, true);
  }
}

// Re-fetch only the project list and re-render; guarded against concurrent calls
async function refreshProjects() {
  if (refreshPending) return;
  refreshPending = true;
  try {
    allProjects = await api.getProjects();
    renderDashboard();
  } catch (err) {
    // Silently ignore — stale data is better than error toasts on every navigation
  } finally {
    refreshPending = false;
  }
}

document.addEventListener('DOMContentLoaded', init);

// Re-fetch every time this page is shown — covers fresh navigation AND bfcache restores
window.addEventListener('pageshow', () => {
  refreshPending = false;
  refreshProjects();
});

// Re-fetch when the user switches back to this tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshProjects();
});

// ── Render ────────────────────────────────────────────────────────────────────

// Rebuild all phase sections dynamically; only show sections that have projects.
// Pass animate=false to skip the stagger (used after drag-drop to avoid flash).
function renderDashboard(animate = true) {
  const container = document.getElementById('phases-container');
  if (!container) return;

  // Group projects by their phase name
  const byPhase = {};
  allProjects.forEach(p => {
    const phase = p.phase || (allPhases[0] || 'Planning');
    if (!byPhase[phase]) byPhase[phase] = [];
    byPhase[phase].push(p);
  });

  // Clear and rebuild — simple and avoids stale section state
  container.innerHTML = '';

  allPhases.forEach((phase, i) => {
    const projects = byPhase[phase] || [];
    if (projects.length === 0) return; // Don't show sections with no projects

    const section = document.createElement('section');
    section.className     = 'project-section';
    section.id            = 'section-phase-' + i;
    section.dataset.phase = phase;

    section.innerHTML = `
      <div class="section-heading">${escapeHtml(phase)}</div>
      <div class="project-grid" id="grid-phase-${i}"></div>
    `;

    const grid = section.querySelector('.project-grid');
    projects.forEach((project, cardIndex) => {
      const card = buildCard(project);
      if (animate) {
        card.style.animation = `card-appear 300ms cubic-bezier(0.34, 1.1, 0.64, 1) ${cardIndex * 45}ms both`;
      }
      grid.appendChild(card);
    });

    container.appendChild(section);
  });

  initDragAndDrop();
}

// Build and return a project card DOM element
function buildCard(project) {
  const card = document.createElement('div');
  card.className = 'project-card';
  card.setAttribute('draggable', 'true');
  card.dataset.id    = project.id;
  card.dataset.phase = project.phase || '';
  card.style.setProperty('--project-color', project.color || '#4A90D9');

  // Prefer sessionStorage values (written by project page on every save/keystroke) over server index
  const storedTask    = sessionStorage.getItem('ct_' + project.id);
  const currentTask   = storedTask !== null ? JSON.parse(storedTask) : project.currentTask;
  const storedPurpose = sessionStorage.getItem('purpose_' + project.id);
  const purposeText   = storedPurpose !== null ? storedPurpose : project.purpose;

  card.innerHTML = `
    <div class="card-actions">
      <button class="btn-delete-card" title="Delete project" data-id="${project.id}">&#x2715;</button>
    </div>
    <div class="project-card-header">
      <div class="project-card-name">${escapeHtml(project.name)}</div>
      <div class="project-card-header-right">
        <button class="card-color-btn" data-id="${project.id}" title="Change color"></button>
      </div>
    </div>
    <div class="project-card-phase">${escapeHtml(project.phase || '')}</div>
    <div class="card-current-task">${currentTask ? `<span class="current-task-label">Current task:</span> ${escapeHtml(currentTask)}` : '<span class="current-task-none">No active tasks</span>'}</div>
    <div class="card-footer">
      <button class="btn-card-menu" title="More info">&#xB7;&#xB7;&#xB7;</button>
    </div>
    <div class="card-expand-panel">
      <div class="card-expand-inner">
        <div class="card-expand-label">Purpose</div>
        <div>${purposeText ? escapeHtml(purposeText) : '<span class="text-secondary">No purpose set.</span>'}</div>
      </div>
    </div>
  `;

  // Set color dot background (can't be done in template string)
  card.querySelector('.card-color-btn').style.background = project.color || '#4A90D9';

  // Navigate to project detail on card click (but not on interactive elements)
  card.addEventListener('click', (e) => {
    if (e.target.closest('.btn-delete-card, .btn-card-menu, .card-expand-panel, .card-color-btn')) return;
    window.location.href = 'project.html?id=' + project.id;
  });

  // Delete button opens confirmation modal
  card.querySelector('.btn-delete-card').addEventListener('click', (e) => {
    e.stopPropagation();
    openDeleteModal(project);
  });

  // Color dot opens color-change modal
  card.querySelector('.card-color-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openChangeColorModal(project.id, project.color || '#4A90D9');
  });

  // 3-dot menu toggles purpose expand panel
  card.querySelector('.btn-card-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    card.classList.toggle('menu-open');
  });

  return card;
}

// ── Drag and drop ─────────────────────────────────────────────────────────────

// Wire up drag-and-drop for all cards and phase sections
function initDragAndDrop() {
  document.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('dragstart', handleCardDragStart);
    card.addEventListener('dragend',   handleCardDragEnd);

    // Show a vertical blue line on the left or right of the card based on cursor position
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedProject || card.dataset.id === draggedProject.id) return;
      e.dataTransfer.dropEffect = 'move';

      if (card.dataset.phase === draggedProject.phase) {
        // Same phase: show insertion indicator; stop propagation so section doesn't highlight
        e.stopPropagation();
        const rect   = card.getBoundingClientRect();
        const isLeft = e.clientX < rect.left + rect.width / 2;
        clearCardDropIndicators();
        card.classList.add(isLeft ? 'drop-before' : 'drop-after');
        dropTargetCard   = card;
        dropInsertBefore = isLeft;
      }
      // Cross-phase: let event bubble to section handler for outline highlight
    });

    // Remove indicator when cursor leaves this card
    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove('drop-before', 'drop-after');
        if (dropTargetCard === card) dropTargetCard = null;
      }
    });

    // Drop on a card — within-phase reorder uses before/after indicator; cross-phase bubbles to section
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!draggedProject || card.dataset.id === draggedProject.id) return;

      const targetProject = allProjects.find(p => p.id === card.dataset.id);
      if (!targetProject) return;

      if (targetProject.phase === draggedProject.phase) {
        e.stopPropagation(); // prevent section drop handler from also firing
        const before = card.classList.contains('drop-before');
        reorderWithinSection(draggedProject.id, card.dataset.id, before);
      }
      // Cross-phase: bubbles up to section drop handler
    });
  });

  // Sections: highlight outline when dragging in from another phase; drop to move
  document.querySelectorAll('.project-section').forEach(section => {
    const phase = section.dataset.phase;
    section.addEventListener('dragover',  (e) => handleSectionDragOver(e, section, phase));
    section.addEventListener('dragleave', (e) => handleSectionDragLeave(e, section));
    section.addEventListener('drop',      (e) => handleSectionDrop(e, section, phase));
  });
}

// ── Card drag handlers ────────────────────────────────────────────────────────

function handleCardDragStart(e) {
  draggedProject = allProjects.find(p => p.id === this.dataset.id) || null;
  this.classList.add('card-dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleCardDragEnd() {
  draggedProject = null;
  clearDragStyles();
}


// ── Section drag handlers ─────────────────────────────────────────────────────

// Highlight section outline and show a vertical insertion line when dragging in from another phase
function handleSectionDragOver(e, section, phase) {
  e.preventDefault();
  if (!draggedProject) return;
  e.dataTransfer.dropEffect = 'move';
  if (draggedProject.phase !== phase) {
    section.classList.add('section-drag-over');

    // Find the card in this section closest to the cursor and show a before/after indicator
    const grid  = section.querySelector('.project-grid');
    const cards = grid ? [...grid.querySelectorAll('.project-card')] : [];
    clearCrossPhaseCardIndicators();

    if (cards.length > 0) {
      // Pick the card whose center is closest to the cursor position
      let closest = null, closestDist = Infinity;
      for (const card of cards) {
        const rect  = card.getBoundingClientRect();
        const cx    = rect.left + rect.width  / 2;
        const cy    = rect.top  + rect.height / 2;
        const dist  = Math.hypot(e.clientX - cx, e.clientY - cy);
        if (dist < closestDist) { closestDist = dist; closest = card; }
      }
      if (closest) {
        const rect   = closest.getBoundingClientRect();
        const isLeft = e.clientX < rect.left + rect.width / 2;
        closest.classList.add(isLeft ? 'drop-before' : 'drop-after');
        crossPhaseDropTarget   = closest;
        crossPhaseInsertBefore = isLeft;
      }
    }
  }
}

// Remove highlight and card indicator when the drag leaves the section entirely
function handleSectionDragLeave(e, section) {
  if (!section.contains(e.relatedTarget)) {
    section.classList.remove('section-drag-over');
    clearCrossPhaseCardIndicators();
  }
}

// Drop on section — move the project to this phase at the indicated position
async function handleSectionDrop(e, section, phase) {
  e.preventDefault();
  section.classList.remove('section-drag-over');

  const targetCardId   = crossPhaseDropTarget?.dataset.id ?? null;
  const insertBefore   = crossPhaseInsertBefore;
  clearCrossPhaseCardIndicators();

  if (!draggedProject || draggedProject.phase === phase) return;
  await moveProjectToPhase(draggedProject.id, phase, targetCardId, insertBefore);
}

// ── Drag operations ───────────────────────────────────────────────────────────

// FLIP-animate a set of cards from their pre-recorded positions to their current layout positions.
// Call this after a DOM mutation; beforeRects must have been captured before the mutation.
function animateSiblingFlip(siblings, beforeRects) {
  siblings.forEach(card => {
    const before = beforeRects.get(card);
    const after  = card.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top  - after.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return; // didn't move

    // Snap back to old position, then spring to the new one
    card.style.transition = 'none';
    card.style.transform  = `translate(${dx}px, ${dy}px)`;
    void card.offsetWidth; // force reflow
    card.style.transition = 'transform 280ms cubic-bezier(0.25, 1, 0.5, 1)';
    card.style.transform  = '';
    card.addEventListener('transitionend', () => {
      card.style.transition = '';
      card.style.transform  = '';
    }, { once: true });
  });
}

// FLIP-animate a card into a grid position:
//  1. Snapshot sibling positions before the DOM move
//  2. Insert the card
//  3. For every sibling that shifted, play it from old → new position
//  4. Bubble the dropped card in
function placeCardWithFlip(cardEl, grid, refEl, insertBeforeRef) {
  // 1. First: record current rects of every card that isn't the one being moved
  const siblings = [...grid.querySelectorAll('.project-card')].filter(c => c !== cardEl);
  const beforeRects = new Map(siblings.map(c => [c, c.getBoundingClientRect()]));

  // 2. DOM move
  if (refEl) {
    grid.insertBefore(cardEl, insertBeforeRef ? refEl : refEl.nextSibling);
  } else {
    grid.appendChild(cardEl);
  }

  // 3. Last + Invert + Play for each displaced sibling
  animateSiblingFlip(siblings, beforeRects);

  // 4. Bubble-in spring for the card that just landed
  cardEl.style.animation = 'none';
  void cardEl.offsetWidth;
  cardEl.style.animation = 'card-bubble 380ms cubic-bezier(0.34, 1.4, 0.64, 1) both';
}

// Reorder projects within their phase — FLIP, no full re-render
function reorderWithinSection(fromId, toId, insertBefore) {
  const fromIdx = allProjects.findIndex(p => p.id === fromId);
  if (fromIdx === -1) return;

  const [moved] = allProjects.splice(fromIdx, 1);
  const newToIdx = allProjects.findIndex(p => p.id === toId);
  if (newToIdx === -1) return;
  allProjects.splice(insertBefore ? newToIdx : newToIdx + 1, 0, moved);

  const cardEl   = document.querySelector(`.project-card[data-id="${fromId}"]`);
  const targetEl = document.querySelector(`.project-card[data-id="${toId}"]`);
  if (cardEl && targetEl?.parentNode) {
    placeCardWithFlip(cardEl, targetEl.parentNode, targetEl, insertBefore);
  } else {
    renderDashboard(false);
  }

  api.reorderProjects(allProjects.map(p => p.id)).catch(() => {});
}

// Move a project to a different phase — uses direct DOM move when possible
async function moveProjectToPhase(projectId, newPhase, targetCardId, insertBefore) {
  const fromIdx = allProjects.findIndex(p => p.id === projectId);
  if (fromIdx === -1) return;

  const cardEl        = document.querySelector(`.project-card[data-id="${projectId}"]`);
  const sourceSection = cardEl?.closest('.project-section');

  // Update in-memory state
  const [project] = allProjects.splice(fromIdx, 1);
  project.phase = newPhase;

  if (targetCardId) {
    const targetIdx = allProjects.findIndex(p => p.id === targetCardId);
    allProjects.splice(targetIdx !== -1
      ? (insertBefore ? targetIdx : targetIdx + 1)
      : allProjects.length, 0, project);
  } else {
    const lastIdx = allProjects.reduce((last, p, i) => p.phase === newPhase ? i : last, -1);
    allProjects.splice(lastIdx + 1, 0, project);
  }

  // Try to move the DOM node directly — no flash, no re-render
  const targetSection = [...document.querySelectorAll('.project-section')]
    .find(s => s.dataset.phase === newPhase);
  const targetGrid = targetSection?.querySelector('.project-grid');

  if (cardEl && targetGrid) {
    cardEl.dataset.phase = newPhase;

    // Snapshot source-grid siblings BEFORE the card leaves so we can slide them to fill the gap
    const sourceGrid = sourceSection?.querySelector('.project-grid');
    const sourceSiblings = sourceGrid
      ? [...sourceGrid.querySelectorAll('.project-card')].filter(c => c !== cardEl)
      : [];
    const sourceBeforeRects = new Map(sourceSiblings.map(c => [c, c.getBoundingClientRect()]));

    const refEl = targetCardId
      ? targetGrid.querySelector(`.project-card[data-id="${targetCardId}"]`)
      : null;
    // placeCardWithFlip moves cardEl (implicitly removing it from sourceGrid) and animates target siblings
    placeCardWithFlip(cardEl, targetGrid, refEl, insertBefore);

    // Animate source siblings sliding left/up to fill the vacated slot
    animateSiblingFlip(sourceSiblings, sourceBeforeRects);

    // If source section is now empty, remove it from the DOM
    if (sourceGrid && sourceGrid.children.length === 0) {
      sourceSection.remove();
    }

    initDragAndDrop(); // re-wire listeners for the moved card's new section
  } else {
    // Target section doesn't exist yet (first card entering an empty phase)
    renderDashboard(false);
  }

  try {
    const saved = await api.saveProject(projectId, project);
    const idx = allProjects.findIndex(p => p.id === projectId);
    if (idx >= 0) allProjects[idx] = { ...allProjects[idx], ...saved };
    api.reorderProjects(allProjects.map(p => p.id)).catch(() => {});
    // No second renderDashboard — DOM is already correct
  } catch (err) {
    showToast('Could not move project: ' + err.message, true);
    await refreshProjects();
  }
}

// ── Drag style helpers ────────────────────────────────────────────────────────

function clearDragStyles() {
  document.querySelectorAll('.card-dragging, .section-drag-over, .drop-before, .drop-after')
    .forEach(el => el.classList.remove('card-dragging', 'section-drag-over', 'drop-before', 'drop-after'));
  dropTargetCard = null;
  clearCrossPhaseCardIndicators();
}

// Clear only the same-phase card insertion indicators (used mid-drag when moving between cards)
function clearCardDropIndicators() {
  document.querySelectorAll('.project-card.drop-before, .project-card.drop-after')
    .forEach(el => el.classList.remove('drop-before', 'drop-after'));
}

// Clear only the cross-phase card insertion indicator
function clearCrossPhaseCardIndicators() {
  if (crossPhaseDropTarget) {
    crossPhaseDropTarget.classList.remove('drop-before', 'drop-after');
    crossPhaseDropTarget = null;
  }
}

// ── Phase dropdown ────────────────────────────────────────────────────────────

// Fill the create-modal phase <select> with current phases
function populatePhaseDropdown() {
  const select = document.getElementById('new-project-phase');
  if (!select) return;
  select.innerHTML = allPhases.map(p =>
    `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`
  ).join('');
}

// ── Create modal ──────────────────────────────────────────────────────────────

// Open the create project modal
function openCreateModal() {
  document.getElementById('modal-create').classList.add('open');
  document.getElementById('new-project-name').focus();
}

// Close the create project modal and reset its form
function closeCreateModal() {
  document.getElementById('modal-create').classList.remove('open');
  document.getElementById('form-create').reset();
  resetColorPicker();
}

// Handle create form submission
async function handleCreate(e) {
  e.preventDefault();
  const name  = document.getElementById('new-project-name').value.trim();
  const color = document.getElementById('new-project-color').value;
  const phase = document.getElementById('new-project-phase').value;

  if (!name) return;

  try {
    const project = await api.createProject({
      id: crypto.randomUUID(),
      name,
      color,
      phase
    });
    allProjects.push({
      ...project,
      taskCount:          0,
      completedTaskCount: 0
    });
    renderDashboard();
    closeCreateModal();
    showToast('Project created');
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

// ── Delete modal ──────────────────────────────────────────────────────────────

// Open the delete confirmation modal for a given project
function openDeleteModal(project) {
  pendingDeleteId = project.id;
  document.getElementById('delete-project-name').textContent = project.name;
  document.getElementById('modal-delete').classList.add('open');
}

// Close the delete modal without deleting
function closeDeleteModal() {
  document.getElementById('modal-delete').classList.remove('open');
  pendingDeleteId = null;
}

// Confirm and perform deletion
async function handleDeleteConfirm() {
  if (!pendingDeleteId) return;
  try {
    await api.deleteProject(pendingDeleteId);
    allProjects = allProjects.filter(p => p.id !== pendingDeleteId);

    const cardEl  = document.querySelector(`.project-card[data-id="${pendingDeleteId}"]`);
    const grid    = cardEl?.closest('.project-grid');
    const section = cardEl?.closest('.project-section');

    if (cardEl && grid) {
      // Snapshot siblings BEFORE removing the card so we can FLIP them into the gap
      const siblings    = [...grid.querySelectorAll('.project-card')].filter(c => c !== cardEl);
      const beforeRects = new Map(siblings.map(c => [c, c.getBoundingClientRect()]));

      cardEl.remove();

      if (grid.children.length === 0) {
        // Section is now empty — remove it entirely
        section?.remove();
      } else {
        // Slide remaining cards to fill the vacated slot
        animateSiblingFlip(siblings, beforeRects);
      }
    } else {
      // Fallback: full re-render if the card wasn't found in the DOM
      renderDashboard();
    }

    closeDeleteModal();
    showToast('Project deleted');
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initColorPicker();
  initChangeColorPicker();

  document.getElementById('btn-cancel-change-color')
    ?.addEventListener('click', closeChangeColorModal);
  document.getElementById('btn-save-change-color')
    ?.addEventListener('click', handleChangeColorSave);
  document.getElementById('modal-change-color')
    ?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeChangeColorModal(); });

  document.getElementById('project-search')
    ?.addEventListener('input', (e) => filterDashboard(e.target.value));

  document.getElementById('btn-new-project')
    ?.addEventListener('click', openCreateModal);
  document.getElementById('btn-cancel-create')
    ?.addEventListener('click', closeCreateModal);
  document.getElementById('form-create')
    ?.addEventListener('submit', handleCreate);

  document.getElementById('btn-cancel-delete')
    ?.addEventListener('click', closeDeleteModal);
  document.getElementById('btn-confirm-delete')
    ?.addEventListener('click', handleDeleteConfirm);

  document.getElementById('modal-create')
    ?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeCreateModal(); });
  document.getElementById('modal-delete')
    ?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDeleteModal(); });
});

// ── Change color modal ────────────────────────────────────────────────────────

// Open the change-color modal for an existing project card
function openChangeColorModal(projectId, currentColor) {
  pendingColorChangeId = projectId;
  const hiddenInput = document.getElementById('change-project-color');
  if (hiddenInput) hiddenInput.value = currentColor;
  syncChangeColorPickerSelection(currentColor);
  document.getElementById('modal-change-color').classList.add('open');
}

// Close the change-color modal and remove any open custom color picker
function closeChangeColorModal() {
  document.getElementById('ccp-panel')?.remove();
  document.getElementById('modal-change-color').classList.remove('open');
  pendingColorChangeId = null;
}

// Save the chosen color to the server and update the card in place
async function handleChangeColorSave() {
  const color = document.getElementById('change-project-color')?.value;
  if (!color || !pendingColorChangeId) { closeChangeColorModal(); return; }

  const idx = allProjects.findIndex(p => p.id === pendingColorChangeId);
  if (idx === -1) return;

  if (color === allProjects[idx].color) { closeChangeColorModal(); return; }

  try {
    // Send only the changed field — server merges with existing project file
    await api.saveProject(pendingColorChangeId, { color });

    // Update local state so subsequent re-renders use the new color
    allProjects[idx] = { ...allProjects[idx], color };

    // Update the card CSS variable and color dot without a full re-render
    const card = document.querySelector(`.project-card[data-id="${pendingColorChangeId}"]`);
    if (card) {
      card.style.setProperty('--project-color', color);
      const btn = card.querySelector('.card-color-btn');
      if (btn) btn.style.background = color;
    }

    closeChangeColorModal();
    showToast('Color updated');
  } catch (err) {
    showToast('Could not save color: ' + err.message, true);
  }
}

// Build the preset swatch grid for the change-color modal
function initChangeColorPicker() {
  const grid        = document.getElementById('color-picker-grid-change');
  const hiddenInput = document.getElementById('change-project-color');
  if (!grid || !hiddenInput) return;

  PRESET_COLORS.forEach((color, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch' + (index === 0 ? ' selected' : '');
    btn.style.background = color;
    btn.dataset.color = color;
    btn.title = color;
    btn.addEventListener('click', () => selectChangeSwatch(btn, color));
    grid.appendChild(btn);
  });

  // Open the floating custom color picker to the right of the modal
  document.getElementById('btn-custom-color-change')?.addEventListener('click', () => {
    const modal = document.querySelector('#modal-change-color .modal');
    createFloatingColorPicker(modal, hiddenInput.value || '#4A90D9', (hex) => {
      hiddenInput.value = hex;
      grid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      let customSwatch = grid.querySelector('.color-swatch-custom');
      if (!customSwatch) {
        customSwatch = document.createElement('button');
        customSwatch.type = 'button';
        customSwatch.className = 'color-swatch color-swatch-custom selected';
        customSwatch.title = 'Custom';
        customSwatch.addEventListener('click', () => selectChangeSwatch(customSwatch, customSwatch.dataset.color));
        grid.appendChild(customSwatch);
      }
      customSwatch.style.background = hex;
      customSwatch.dataset.color = hex;
      customSwatch.classList.add('selected');
    });
  });
}

// Select a swatch in the change-color picker
function selectChangeSwatch(swatchEl, color) {
  const grid = document.getElementById('color-picker-grid-change');
  grid?.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  swatchEl.classList.add('selected');
  const hiddenInput = document.getElementById('change-project-color');
  if (hiddenInput) hiddenInput.value = color;
}

// Pre-select the swatch matching the project's current color when opening the modal
function syncChangeColorPickerSelection(color) {
  const grid = document.getElementById('color-picker-grid-change');
  if (!grid) return;
  grid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  let matched = false;
  grid.querySelectorAll('.color-swatch:not(.color-swatch-custom)').forEach(s => {
    if (s.dataset.color === color) { s.classList.add('selected'); matched = true; }
  });
  if (!matched) {
    let customSwatch = grid.querySelector('.color-swatch-custom');
    if (!customSwatch) {
      customSwatch = document.createElement('button');
      customSwatch.type = 'button';
      customSwatch.className = 'color-swatch color-swatch-custom selected';
      customSwatch.title = 'Custom';
      customSwatch.addEventListener('click', () => selectChangeSwatch(customSwatch, customSwatch.dataset.color));
      grid.appendChild(customSwatch);
    }
    customSwatch.style.background = color;
    customSwatch.dataset.color = color;
    customSwatch.classList.add('selected');
  }
}

// ── Color picker ──────────────────────────────────────────────────────────────

// Build the preset swatch grid and wire up the custom color button
function initColorPicker() {
  const grid        = document.getElementById('color-picker-grid');
  const hiddenInput = document.getElementById('new-project-color');
  if (!grid || !hiddenInput) return;

  PRESET_COLORS.forEach((color, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch' + (index === 0 ? ' selected' : '');
    btn.style.background = color;
    btn.dataset.color = color;
    btn.title = color;
    btn.addEventListener('click', () => selectSwatch(btn, color));
    grid.appendChild(btn);
  });

  // Open the floating custom color picker to the right of the modal
  document.getElementById('btn-custom-color')?.addEventListener('click', () => {
    const modal = document.querySelector('#modal-create .modal');
    createFloatingColorPicker(modal, hiddenInput.value || '#4A90D9', (hex) => {
      hiddenInput.value = hex;
      grid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      let customSwatch = grid.querySelector('.color-swatch-custom');
      if (!customSwatch) {
        customSwatch = document.createElement('button');
        customSwatch.type = 'button';
        customSwatch.className = 'color-swatch color-swatch-custom selected';
        customSwatch.title = 'Custom';
        customSwatch.addEventListener('click', () => selectSwatch(customSwatch, customSwatch.dataset.color));
        grid.appendChild(customSwatch);
      }
      customSwatch.style.background = hex;
      customSwatch.dataset.color = hex;
      customSwatch.classList.add('selected');
    });
  });
}

// Select a swatch: mark it selected and update the hidden color input
function selectSwatch(swatchEl, color) {
  const grid = document.getElementById('color-picker-grid');
  grid?.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  swatchEl.classList.add('selected');
  const hiddenInput = document.getElementById('new-project-color');
  if (hiddenInput) hiddenInput.value = color;
}

// Reset the color picker back to the first preset when the modal is closed
function resetColorPicker() {
  const grid        = document.getElementById('color-picker-grid');
  const hiddenInput = document.getElementById('new-project-color');
  if (!grid) return;
  document.getElementById('ccp-panel')?.remove();
  grid.querySelector('.color-swatch-custom')?.remove();
  const swatches = grid.querySelectorAll('.color-swatch');
  swatches.forEach((s, i) => s.classList.toggle('selected', i === 0));
  if (hiddenInput) hiddenInput.value = PRESET_COLORS[0];
}

// ── Search / filter ───────────────────────────────────────────────────────────

// Filter visible project cards by name; hide sections with no matching cards
function filterDashboard(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('.project-section').forEach(section => {
    const grid = section.querySelector('.project-grid');
    if (!grid) return;
    const cards = grid.querySelectorAll('.project-card');
    let visible = 0;
    cards.forEach(card => {
      const name = card.querySelector('.project-card-name')?.textContent.toLowerCase() || '';
      const show = !q || name.includes(q);
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    section.style.display = (visible === 0) ? 'none' : '';
  });
}

