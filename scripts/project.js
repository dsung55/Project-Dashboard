// project.js — Project detail page: tasks, notes, files, phase, version, color

// ── Preset colors (matches dashboard.js palette) ──────────────────────────────
const PRESET_COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE',
  '#007AFF', '#5856D6', '#BF5AF2', '#FF2D55', '#A2845E',
  '#8E8E93', '#1D3557', '#2D6A4F', '#E76F51', '#C77DFF'
];

// ── State ─────────────────────────────────────────────────────────────────────
let projectId     = null;
let projectData   = null;
let phases        = [];
let notesTimer    = null;  // debounce timer for notes autosave
let purposeTimer  = null;  // debounce timer for purpose autosave
let expandedTaskId = null; // id of the currently expanded task panel
let undoStack     = [];    // snapshots of tasks array before each mutation
const UNDO_MAX    = 20;    // maximum undo history depth

// ── Due date helpers ──────────────────────────────────────────────────────────

// Parse a dueDate object { month, day, year } into a JS Date, or null if incomplete
function parseDueDate(dueDate) {
  if (!dueDate || !dueDate.month || !dueDate.day || !dueDate.year) return null;
  const m = parseInt(dueDate.month, 10);
  const d = parseInt(dueDate.day, 10);
  const y = parseInt(dueDate.year, 10);
  if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
  return new Date(y, m - 1, d);
}

// Format a dueDate object as "M/D/YYYY" for display, or null if incomplete
function formatDueDate(dueDate) {
  const date = parseDueDate(dueDate);
  if (!date) return null;
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

// ── Undo helpers ──────────────────────────────────────────────────────────────

// Push a deep copy of the current tasks array onto the undo stack before any mutation
function pushUndo() {
  undoStack.push(JSON.parse(JSON.stringify(projectData.tasks)));
  if (undoStack.length > UNDO_MAX) undoStack.shift();
}

// Revert to the last snapshot in the undo stack
function undoLastAction() {
  if (undoStack.length === 0) { showToast('Nothing to undo'); return; }
  expandedTaskId = null;
  projectData.tasks = undoStack.pop();
  saveAndRender();
}

// ── Sub-item helpers ──────────────────────────────────────────────────────────

// Normalize a sub-item — old format was a plain string, new format is an object
function normalizeSubItem(sub) {
  if (typeof sub === 'string') return { id: crypto.randomUUID(), text: sub, completed: false, dueDate: null };
  if (!sub.id) sub.id = crypto.randomUUID();
  return sub;
}

// Wire numeric-only + range validation on a date input element
// Relies on input.dataset.field: 'month' (1-12), 'day' (1-31), 'year' (free)
function wireDateInput(input) {
  const field = input.dataset.field;
  // Block non-digit keystrokes (allow control keys and clipboard shortcuts)
  input.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) return;
    if (['Backspace','Delete','Tab','Escape','Enter','ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  });
  // Strip any non-digits that slip through (e.g. paste)
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
  });
  // Clamp to valid range on blur
  input.addEventListener('blur', () => {
    if (!input.value) return;
    const v = parseInt(input.value, 10);
    if (field === 'month') {
      if (v < 1) input.value = '1';
      else if (v > 12) input.value = '12';
    } else if (field === 'day') {
      if (v < 1) input.value = '1';
      else if (v > 31) input.value = '31';
    }
  });
}

// ── Task sort ─────────────────────────────────────────────────────────────────

// Re-order active tasks by due date (closest first, undated tasks at bottom)
function orderByDate() {
  pushUndo();
  const active    = projectData.tasks.filter(t => !t.completed);
  const completed = projectData.tasks.filter(t => t.completed);
  active.sort((a, b) => {
    const da = parseDueDate(a.dueDate);
    const db = parseDueDate(b.dueDate);
    if (da && db) return da - db;
    if (da)       return -1;
    if (db)       return 1;
    return 0;
  });
  projectData.tasks = [...active, ...completed];
  saveAndRender();
}

// ── Save without re-render ────────────────────────────────────────────────────

// Save projectData to server without re-rendering the task list (used for due date edits)
async function saveProject() {
  const purposeEl = document.getElementById('project-purpose');
  if (purposeEl) projectData.purpose = purposeEl.value;
  const notesEl = document.getElementById('project-notes');
  if (notesEl) projectData.notes = notesEl.value;
  try {
    projectData = await api.saveProject(projectId, projectData);
  } catch (err) {
    showToast('Could not save: ' + err.message, true);
  }
}

// Replace the due date badge with inline inputs for editing; restore badge on save/blur
function openDueDateInlineEdit(taskId, badgeEl) {
  const t = projectData.tasks.find(t => t.id === taskId);
  const container = document.createElement('span');
  container.className = 'task-due-edit-inline';
  container.innerHTML =
    `<input class="task-due-input task-due-month" data-field="month" placeholder="MM" maxlength="2" value="${escapeHtml(t?.dueDate?.month || '')}">` +
    `<span class="task-due-sep">/</span>` +
    `<input class="task-due-input" data-field="day" placeholder="DD" maxlength="2" value="${escapeHtml(t?.dueDate?.day || '')}">` +
    `<span class="task-due-sep">/</span>` +
    `<input class="task-due-input task-due-year" data-field="year" placeholder="YYYY" maxlength="4" value="${escapeHtml(t?.dueDate?.year || '')}">`;
  badgeEl.replaceWith(container);

  const inputs = container.querySelectorAll('.task-due-input');
  inputs.forEach(input => wireDateInput(input));

  // Save date and swap container back to a fresh badge
  async function commitEdit() {
    const month = container.querySelector('[data-field="month"]').value.trim();
    const day   = container.querySelector('[data-field="day"]').value.trim();
    const year  = container.querySelector('[data-field="year"]').value.trim();
    const task  = projectData.tasks.find(t => t.id === taskId);
    if (task) {
      task.dueDate = (month || day || year) ? { month, day, year } : null;
      await saveProject();
    }
    const display = formatDueDate(task?.dueDate);
    const newBadge = document.createElement('span');
    newBadge.className = `task-due-badge${display ? '' : ' task-due-empty'}`;
    newBadge.textContent = display || '';
    newBadge.addEventListener('click', e => e.stopPropagation());
    newBadge.addEventListener('dblclick', (e) => { e.stopPropagation(); openDueDateInlineEdit(taskId, newBadge); });
    container.replaceWith(newBadge);
  }

  // Commit when focus leaves all inputs in the container
  let blurTimer;
  inputs.forEach(input => {
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('blur',  () => { blurTimer = setTimeout(commitEdit, 150); });
    input.addEventListener('focus', () => clearTimeout(blurTimer));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { input.blur(); }
      if (e.key === 'Escape') { container.replaceWith(badgeEl); }
    });
  });

  inputs[0].focus();
  inputs[0].select();
}

// Update just the due date badge on a task row without a full re-render
function updateDueBadge(taskId) {
  const taskEl = document.querySelector(`.task-item[data-id="${taskId}"]`);
  if (!taskEl) return;
  const task = projectData.tasks.find(t => t.id === taskId);
  const display = formatDueDate(task?.dueDate);
  const badge = taskEl.querySelector('.task-row .task-due-badge');
  if (!badge) return;
  if (display) {
    badge.textContent = display;
    badge.classList.remove('task-due-empty');
  } else {
    badge.textContent = '';
    badge.classList.add('task-due-empty');
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

// Extract project id from the URL, load data, render page
async function init() {
  projectId = new URLSearchParams(window.location.search).get('id');
  if (!projectId) {
    document.body.innerHTML = '<p style="padding:48px">No project ID in URL.</p>';
    return;
  }

  try {
    const [project, config] = await Promise.all([
      api.getProject(projectId),
      api.getConfig()
    ]);
    projectData = project;
    phases      = config.phases || [];
    renderPage();
  } catch (err) {
    showToast('Could not load project: ' + err.message, true);
  }
}

// Collapse the expanded task panel when the user clicks outside of it
document.addEventListener('click', (e) => {
  if (!expandedTaskId) return;
  const expandedEl = document.querySelector(`.task-item[data-id="${expandedTaskId}"]`);
  if (!expandedEl || expandedEl.contains(e.target)) return;
  expandedEl.classList.remove('expanded');
  expandedTaskId = null;
});

document.addEventListener('DOMContentLoaded', init);

// ── Full page render ──────────────────────────────────────────────────────────

// Render the entire project detail page from projectData
function renderPage() {
  renderHeader();
  renderTasks();
  renderPurpose();
  renderNotes();
  renderFiles();
}

// Render the project header (name, color swatch, phase, version)
function renderHeader() {
  const p = projectData;

  document.title = p.name + ' — Dashboard';

  const swatch = document.getElementById('project-color-swatch');
  if (swatch) swatch.style.background = p.color || '#4A90D9';

  const nameEl = document.getElementById('project-name');
  if (nameEl) nameEl.textContent = p.name;

  // Phase selector
  const phaseEl = document.getElementById('project-phase');
  if (phaseEl) {
    phaseEl.innerHTML = phases.map(ph =>
      `<option value="${escapeHtml(ph)}" ${ph === p.phase ? 'selected' : ''}>${escapeHtml(ph)}</option>`
    ).join('');
    phaseEl.addEventListener('change', handlePhaseChange);
  }

  // Version input
  const versionEl = document.getElementById('project-version');
  if (versionEl) {
    versionEl.value = p.version || 'v1.0';
    versionEl.addEventListener('blur', handleVersionBlur);
    versionEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') versionEl.blur(); });
  }

  // Color dot — set background to project color and open picker on click
  const colorBtn = document.getElementById('project-color-btn');
  if (colorBtn) {
    colorBtn.style.background = p.color || '#4A90D9';
    colorBtn.addEventListener('click', openColorModal);
  }
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

// Re-render only the task list (called after every task mutation)
function renderTasks() {
  const tasks     = projectData.tasks || [];
  const active    = tasks.filter(t => !t.completed);
  const completed = tasks.filter(t => t.completed)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  const list = document.getElementById('task-list');
  if (!list) return;
  list.innerHTML = '';

  // Active tasks — first item is the "current task" (bolded); active tasks are draggable
  active.forEach((task, index) => list.appendChild(buildTaskItem(task, index === 0, true)));

  // Completed tasks section
  if (completed.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'completed-divider';
    divider.textContent = 'Completed';
    list.appendChild(divider);
    completed.forEach(task => list.appendChild(buildTaskItem(task, false, false)));
  }

  // Re-expand the task that was open before re-render
  if (expandedTaskId) {
    const el = list.querySelector(`[data-id="${expandedTaskId}"]`);
    if (el) el.classList.add('expanded');
  }

  // Wire up task drag-to-reorder on the active items
  initTaskDrag(list, active);
}

// Build a complete task item DOM element (row + expandable panel)
// isCurrent = true bolds the task text; isDraggable = true adds drag handle
function buildTaskItem(task, isCurrent = false, isDraggable = false) {
  const item = document.createElement('li');
  item.className = 'task-item' + (task.completed ? ' completed' : '');
  item.dataset.id = task.id;
  if (isDraggable) item.setAttribute('draggable', 'true');

  const dragHandle = isDraggable
    ? `<span class="task-drag-handle" title="Drag to reorder">⠿</span>`
    : '';

  // Normalize sub-items to object format (handles old plain-string format)
  task.subItems = (task.subItems || []).map(normalizeSubItem);
  const activeSubs    = task.subItems.filter(s => !s.completed);
  const completedSubs = task.subItems.filter(s =>  s.completed);
  // Within the active group, undated items sink to the bottom (display-only sort, does not mutate stored order)
  const sortedActiveSubs = [...activeSubs].sort((a, b) => {
    const ha = !!parseDueDate(a.dueDate), hb = !!parseDueDate(b.dueDate);
    if (ha && !hb) return -1;
    if (!ha && hb) return  1;
    return 0;
  });
  // Render active items first, then a divider, then completed items
  const separatorHtml = (activeSubs.length > 0 && completedSubs.length > 0)
    ? '<li class="sub-items-separator" aria-hidden="true"></li>' : '';
  const subItemsHtml =
    sortedActiveSubs.map((sub, i) => buildSubItemHtml(sub, i)).join('') +
    separatorHtml +
    completedSubs.map((sub, i) => buildSubItemHtml(sub, activeSubs.length + i)).join('');

  // Due date badge shown on the task row (always rendered; empty class when no date)
  const dueDateDisplay = formatDueDate(task.dueDate);
  const dueBadgeHTML = dueDateDisplay
    ? `<span class="task-due-badge">${dueDateDisplay}</span>`
    : `<span class="task-due-badge task-due-empty"></span>`;

  item.innerHTML = `
    <div class="task-row">
      ${dragHandle}
      <div class="task-checkbox ${task.completed ? 'checked' : ''}" title="Mark complete"></div>
      <span class="task-text${isCurrent ? ' task-current' : ''}">${escapeHtml(task.text)}</span>
      <button class="btn-task-delete" title="Delete task">&#x2715;</button>
      ${dueBadgeHTML}
      <span class="task-expand-icon">&#9660;</span>
    </div>
    <div class="task-panel">
      <div class="task-panel-inner">
        <div class="sub-item-add-row">
          <input class="sub-item-add-input" placeholder="Enter sub-item…">
          <div class="sub-add-date-group">
            <input class="sub-add-date-input" data-field="month" placeholder="MM" maxlength="2">
            <span class="task-due-sep">/</span>
            <input class="sub-add-date-input" data-field="day" placeholder="DD" maxlength="2">
            <span class="task-due-sep">/</span>
            <input class="sub-add-date-input sub-add-year" data-field="year" placeholder="YYYY" maxlength="4">
          </div>
          <button class="btn btn-secondary btn-sub-add">Add</button>
        </div>
        <ul class="sub-items-list">${subItemsHtml}</ul>
        <div class="task-notes-label">Notes</div>
        <textarea class="task-notes-input">${escapeHtml(task.notes || '')}</textarea>
      </div>
    </div>
  `;

  // Toggle checkbox
  item.querySelector('.task-checkbox').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTask(task.id);
  });

  // Toggle expand panel on row click (but not on interactive children)
  item.querySelector('.task-row').addEventListener('click', (e) => {
    if (e.target.closest('.task-checkbox, .btn-task-delete, .task-drag-handle, .task-due-badge, .task-due-edit-inline')) return;
    const wasExpanded = item.classList.contains('expanded');
    item.classList.toggle('expanded');
    expandedTaskId = wasExpanded ? null : task.id;
  });

  // Delete task
  item.querySelector('.btn-task-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task.id);
  });

  // Wire up sub-item interactions
  wireSubItemEvents(item, task);

  // Task notes: debounced save
  const notesInput = item.querySelector('.task-notes-input');
  notesInput.addEventListener('input', () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => updateTaskNotes(task.id, notesInput.value), 800);
  });
  notesInput.addEventListener('click', e => e.stopPropagation());

  // Due date badge: single click stops propagation (no expand); double-click opens inline editor
  const dueBadge = item.querySelector('.task-row .task-due-badge');
  dueBadge.addEventListener('click', e => e.stopPropagation());
  dueBadge.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    openDueDateInlineEdit(task.id, dueBadge);
  });

  // Double-click task text to edit inline
  item.querySelector('.task-text').addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const span = e.currentTarget;
    const currentText = task.text;
    const editInput = document.createElement('input');
    editInput.className = 'task-edit-input';
    editInput.value = currentText;
    span.replaceWith(editInput);
    editInput.focus();
    editInput.select();

    let committed = false;
    const commit = async () => {
      if (committed) return;
      committed = true;
      const newText = editInput.value.trim();
      if (newText && newText !== currentText) {
        pushUndo();
        const t = projectData.tasks.find(t => t.id === task.id);
        if (t) t.text = newText;
        expandedTaskId = task.id;
        await saveAndRender();
      } else {
        editInput.replaceWith(span);
      }
    };

    editInput.addEventListener('blur', commit);
    editInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); editInput.blur(); }
      if (e.key === 'Escape') { committed = true; editInput.replaceWith(span); }
    });
  });

  return item;
}

// Build the HTML string for a single sub-item row (sub is a normalized object)
function buildSubItemHtml(sub, index) {
  const checked   = sub.completed ? ' checked' : '';
  const textClass = sub.completed ? ' completed' : '';
  const dateBadge = sub.dueDate && formatDueDate(sub.dueDate)
    ? `<span class="sub-due-badge">${formatDueDate(sub.dueDate)}</span>` : '';
  return `
    <li class="sub-item-row${sub.completed ? ' completed' : ''}" draggable="true" data-sub-index="${index}" data-sub-id="${escapeHtml(sub.id)}">
      <span class="sub-drag-handle" title="Drag to reorder">⠿</span>
      <div class="sub-checkbox${checked}" title="Mark complete"></div>
      <span class="sub-item-text${textClass}">${escapeHtml(sub.text)}</span>
      ${dateBadge}
      <button class="btn-sub-delete" data-sub-id="${escapeHtml(sub.id)}" title="Remove">&#x2715;</button>
    </li>
  `;
}

// Wire all sub-item event listeners on a task item element
function wireSubItemEvents(item, task) {
  // Sub-item checkbox: toggle completed state
  item.querySelectorAll('.sub-checkbox').forEach(box => {
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      const subId = box.closest('.sub-item-row').dataset.subId;
      toggleSubItem(task.id, subId);
    });
  });

  // Sub-item text: double-click to enter inline edit mode
  item.querySelectorAll('.sub-item-text').forEach(span => {
    span.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const rowEl = span.closest('.sub-item-row');
      const subId = rowEl.dataset.subId;
      const t   = projectData.tasks.find(t => t.id === task.id);
      const sub = (t?.subItems || []).find(s => s.id === subId);
      if (sub) enterSubItemEdit(rowEl, task, sub);
    });
    span.addEventListener('click', e => e.stopPropagation());
  });

  // Sub-item delete
  item.querySelectorAll('.btn-sub-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSubItem(task.id, btn.dataset.subId);
    });
  });

  // Sub-item add on Enter or button click — panel stays open
  const subInput    = item.querySelector('.sub-item-add-input');
  const addSubBtn   = item.querySelector('.sub-item-add-row .btn');
  const addMonthIn  = item.querySelector('.sub-add-date-input[data-field="month"]');
  const addDayIn    = item.querySelector('.sub-add-date-input[data-field="day"]');
  const addYearIn   = item.querySelector('.sub-add-date-input[data-field="year"]');
  const addSub = () => {
    const text = subInput.value.trim();
    if (!text) return;
    const month = addMonthIn?.value.trim() || '';
    const day   = addDayIn?.value.trim()   || '';
    const year  = addYearIn?.value.trim()  || '';
    const dueDate = (month || day || year) ? { month, day, year } : null;
    expandedTaskId = task.id;
    addSubItem(task.id, text, dueDate);
    subInput.value = '';
    if (addMonthIn) addMonthIn.value = '';
    if (addDayIn)   addDayIn.value   = '';
    if (addYearIn)  addYearIn.value  = '';
  };
  subInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });
  subInput.addEventListener('click', e => e.stopPropagation());
  addSubBtn.addEventListener('click', (e) => { e.stopPropagation(); addSub(); });
  // Wire numeric validation on the add-row date inputs
  item.querySelectorAll('.sub-add-date-input').forEach(input => {
    wireDateInput(input);
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });
  });

  // Sub-item drag to reorder
  initSubItemDrag(item, task);
}

// Enter inline edit mode for a sub-item (triggered by double-click on text span)
function enterSubItemEdit(rowEl, task, sub) {
  // Replace text span with a text input
  const textSpan  = rowEl.querySelector('.sub-item-text');
  const textInput = document.createElement('input');
  textInput.className = 'sub-item-edit-input';
  textInput.value     = sub.text;
  textSpan.replaceWith(textInput);

  // Replace the due badge (if any) with editable date inputs, or insert them fresh
  const existingBadge = rowEl.querySelector('.sub-due-badge');
  const dateGroup = document.createElement('div');
  dateGroup.className = 'sub-date-group';
  dateGroup.innerHTML = `
    <input class="sub-due-input" data-field="month" placeholder="MM" maxlength="2" value="${escapeHtml(sub.dueDate?.month || '')}">
    <span class="task-due-sep">/</span>
    <input class="sub-due-input" data-field="day" placeholder="DD" maxlength="2" value="${escapeHtml(sub.dueDate?.day || '')}">
    <span class="task-due-sep">/</span>
    <input class="sub-due-input sub-due-year" data-field="year" placeholder="YYYY" maxlength="4" value="${escapeHtml(sub.dueDate?.year || '')}">
  `;
  if (existingBadge) {
    existingBadge.replaceWith(dateGroup);
  } else {
    rowEl.querySelector('.btn-sub-delete').before(dateGroup);
  }

  // Apply numeric-only validation to the new date inputs
  dateGroup.querySelectorAll('.sub-due-input').forEach(wireDateInput);

  textInput.focus();
  textInput.select();

  // Commit changes: save text + date back to the sub-item
  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const newText = textInput.value.trim();
    if (!newText) { expandedTaskId = task.id; await saveAndRender(); return; }
    const month = dateGroup.querySelector('[data-field="month"]').value.trim();
    const day   = dateGroup.querySelector('[data-field="day"]').value.trim();
    const year  = dateGroup.querySelector('[data-field="year"]').value.trim();
    pushUndo();
    const t   = projectData.tasks.find(t => t.id === task.id);
    const s   = (t?.subItems || []).find(s => s.id === sub.id);
    if (s) {
      s.text    = newText;
      s.dueDate = (month || day || year) ? { month, day, year } : null;
    }
    expandedTaskId = task.id;
    await saveAndRender();
  };

  // Use a short blur timer so focus can move freely between text and date inputs
  let blurTimer = null;
  const allInputs = [textInput, ...dateGroup.querySelectorAll('input')];
  allInputs.forEach(inp => {
    inp.addEventListener('blur',  () => { blurTimer = setTimeout(commit, 200); });
    inp.addEventListener('focus', () => { clearTimeout(blurTimer); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { committed = true; expandedTaskId = task.id; saveAndRender(); }
    });
    inp.addEventListener('click', e => e.stopPropagation());
  });
}

// ── Task drag-to-reorder ──────────────────────────────────────────────────────

// Wire HTML5 drag-and-drop on active task items to allow reordering
function initTaskDrag(list, activeTasks) {
  let draggedTaskId = null;

  const items = list.querySelectorAll('.task-item[draggable="true"]');
  items.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedTaskId = item.dataset.id;
      item.classList.add('task-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      draggedTaskId = null;
      list.querySelectorAll('.drop-before, .drop-after, .task-dragging')
        .forEach(el => el.classList.remove('drop-before', 'drop-after', 'task-dragging'));
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (item.dataset.id === draggedTaskId) return;
      // Determine above or below based on cursor Y relative to item midpoint
      const rect    = item.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;
      list.querySelectorAll('.drop-before, .drop-after')
        .forEach(el => el.classList.remove('drop-before', 'drop-after'));
      item.classList.add(isAbove ? 'drop-before' : 'drop-after');
    });

    item.addEventListener('dragleave', (e) => {
      if (!item.contains(e.relatedTarget)) {
        item.classList.remove('drop-before', 'drop-after');
      }
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const insertBefore = item.classList.contains('drop-before');
      item.classList.remove('drop-before', 'drop-after');
      if (!draggedTaskId || draggedTaskId === item.dataset.id) return;

      // Reorder only within the active tasks array
      const activeIds  = activeTasks.map(t => t.id);
      const fromIdx    = activeIds.indexOf(draggedTaskId);
      const toIdx      = activeIds.indexOf(item.dataset.id);
      if (fromIdx === -1 || toIdx === -1) return;

      // Splice out the dragged task, then insert before or after the target
      pushUndo();
      const allTasks       = projectData.tasks || [];
      const draggedObj     = allTasks.find(t => t.id === draggedTaskId);
      const withoutDragged = allTasks.filter(t => t.id !== draggedTaskId);
      const targetObj      = allTasks.find(t => t.id === item.dataset.id);
      const targetInAll    = withoutDragged.indexOf(targetObj);
      withoutDragged.splice(insertBefore ? targetInAll : targetInAll + 1, 0, draggedObj);
      projectData.tasks = withoutDragged;

      await saveAndRender();
    });
  });
}

// ── Sub-item drag-to-reorder ──────────────────────────────────────────────────

// Wire HTML5 drag-and-drop on sub-item rows to allow reordering
function initSubItemDrag(taskItemEl, task) {
  const subList = taskItemEl.querySelector('.sub-items-list');
  if (!subList) return;

  let draggedIndex = null;

  subList.querySelectorAll('.sub-item-row').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      draggedIndex = parseInt(row.dataset.subIndex, 10);
      row.classList.add('sub-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();  // don't trigger task drag
    });

    row.addEventListener('dragend', () => {
      draggedIndex = null;
      subList.querySelectorAll('.sub-dragging, .drop-before, .drop-after').forEach(el => {
        el.classList.remove('sub-dragging', 'drop-before', 'drop-after');
      });
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(row.dataset.subIndex, 10);
      if (idx === draggedIndex) return;
      // Clear previous indicators, then show above/below line based on cursor Y vs row midpoint
      subList.querySelectorAll('.drop-before, .drop-after').forEach(el => {
        el.classList.remove('drop-before', 'drop-after');
      });
      const rect    = row.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;
      row.classList.add(isAbove ? 'drop-before' : 'drop-after');
    });

    row.addEventListener('dragleave', (e) => {
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove('drop-before', 'drop-after');
      }
    });

    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const insertBefore = row.classList.contains('drop-before');
      row.classList.remove('drop-before', 'drop-after');
      const toIdx = parseInt(row.dataset.subIndex, 10);
      if (draggedIndex === null || draggedIndex === toIdx) return;

      const t = projectData.tasks.find(t => t.id === task.id);
      if (!t || !t.subItems) return;

      // Splice out the dragged item, adjust target index for the removal, then insert
      const subs = [...t.subItems];
      const [moved] = subs.splice(draggedIndex, 1);
      const adjustedToIdx = draggedIndex < toIdx ? toIdx - 1 : toIdx;
      subs.splice(insertBefore ? adjustedToIdx : adjustedToIdx + 1, 0, moved);
      t.subItems = subs;

      expandedTaskId = task.id;  // keep panel open
      await saveAndRender();
    });
  });
}

// ── Task mutations ────────────────────────────────────────────────────────────

// Add a new task with the given text
async function addTask(text, dueDate = null) {
  if (!text.trim()) return;
  pushUndo();
  projectData.tasks = projectData.tasks || [];
  projectData.tasks.push({
    id:          crypto.randomUUID(),
    text:        text.trim(),
    completed:   false,
    completedAt: null,
    notes:       '',
    subItems:    [],
    dueDate:     dueDate
  });
  await saveAndRender();
}

// Toggle the completed state of a task
async function toggleTask(taskId) {
  const task = projectData.tasks.find(t => t.id === taskId);
  if (!task) return;
  pushUndo();
  task.completed   = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  // If we just completed the expanded task, close the panel
  if (task.completed && expandedTaskId === taskId) expandedTaskId = null;
  await saveAndRender();
}

// Delete a task by id
async function deleteTask(taskId) {
  pushUndo();
  if (expandedTaskId === taskId) expandedTaskId = null;
  projectData.tasks = projectData.tasks.filter(t => t.id !== taskId);
  await saveAndRender();
}

// Toggle a sub-item's completed state by sub-item id; completed items sink to bottom
async function toggleSubItem(taskId, subId) {
  const task = projectData.tasks.find(t => t.id === taskId);
  if (!task) return;
  const sub = (task.subItems || []).find(s => s.id === subId);
  if (!sub) return;
  pushUndo();
  sub.completed = !sub.completed;
  // Keep completed sub-items below incomplete ones, preserving relative order within each group
  const active    = task.subItems.filter(s => !s.completed);
  const completed = task.subItems.filter(s => s.completed);
  task.subItems   = [...active, ...completed];
  expandedTaskId = taskId;
  await saveAndRender();
}

// Delete a sub-item by sub-item id
async function deleteSubItem(taskId, subId) {
  const task = projectData.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.subItems = (task.subItems || []).filter(s => s.id !== subId);
  expandedTaskId = taskId;
  await saveAndRender();
}

// Add a new sub-item (object format) to a task, with optional due date.
// Inserts before any completed items so new items always appear at the top of the list.
async function addSubItem(taskId, text, dueDate = null) {
  const task = projectData.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.subItems = (task.subItems || []).map(normalizeSubItem);
  const newSub = { id: crypto.randomUUID(), text, completed: false, dueDate };
  const firstCompletedIdx = task.subItems.findIndex(s => s.completed);
  if (firstCompletedIdx === -1) {
    task.subItems.push(newSub);
  } else {
    task.subItems.splice(firstCompletedIdx, 0, newSub);
  }
  await saveAndRender();
}

// Update task notes (called from debounce — no re-render needed)
async function updateTaskNotes(taskId, notes) {
  const task = projectData.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.notes = notes;
  try {
    projectData = await api.saveProject(projectId, projectData);
  } catch (err) {
    showToast('Could not save notes: ' + err.message, true);
  }
}

// Save projectData to the server, then re-render the task list only
async function saveAndRender() {
  // Read current textarea values before saving — prevents task saves from overwriting
  // purpose or notes that the user has typed but whose debounce hasn't fired yet
  const purposeEl = document.getElementById('project-purpose');
  if (purposeEl) projectData.purpose = purposeEl.value;
  const notesEl = document.getElementById('project-notes');
  if (notesEl) projectData.notes = notesEl.value;

  try {
    projectData = await api.saveProject(projectId, projectData);
    // Write the current task into sessionStorage so the dashboard picks it up immediately
    const currentTask = (projectData.tasks || []).find(t => !t.completed)?.text ?? null;
    sessionStorage.setItem('ct_' + projectId, JSON.stringify(currentTask));
    renderTasks();
  } catch (err) {
    showToast('Could not save: ' + err.message, true);
  }
}

// ── Notes ─────────────────────────────────────────────────────────────────────

// Render the project-level notes textarea and wire up debounced save
function renderNotes() {
  const textarea = document.getElementById('project-notes');
  if (!textarea) return;
  textarea.value = projectData.notes || '';
  textarea.addEventListener('input', () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(saveProjectNotes, 800);
  });
}

// Save only the notes field (no task re-render — prevents focus loss)
async function saveProjectNotes() {
  projectData.notes = document.getElementById('project-notes')?.value ?? '';
  try {
    projectData = await api.saveProject(projectId, projectData);
  } catch (err) {
    showToast('Could not save notes: ' + err.message, true);
  }
}

// ── Purpose ───────────────────────────────────────────────────────────────────

// Render the project purpose textarea and wire up debounced save
function renderPurpose() {
  const textarea = document.getElementById('project-purpose');
  if (!textarea) return;
  textarea.value = projectData.purpose || '';
  textarea.addEventListener('input', () => {
    // Cache the typed value immediately so the dashboard can read it even if the
    // debounced server save hasn't fired yet (e.g. user navigates back quickly)
    sessionStorage.setItem('purpose_' + projectId, textarea.value);
    clearTimeout(purposeTimer);
    purposeTimer = setTimeout(saveProjectPurpose, 800);
  });
}

// Save only the purpose field (no task re-render)
async function saveProjectPurpose() {
  projectData.purpose = document.getElementById('project-purpose')?.value ?? '';
  try {
    projectData = await api.saveProject(projectId, projectData);
  } catch (err) {
    showToast('Could not save purpose: ' + err.message, true);
  }
}

// ── Phase & Version ───────────────────────────────────────────────────────────

// Save when the phase dropdown changes
async function handlePhaseChange(e) {
  projectData.phase = e.target.value;
  try {
    projectData = await api.saveProject(projectId, projectData);
    showToast('Phase updated');
  } catch (err) {
    showToast('Could not save phase: ' + err.message, true);
  }
}

// Save when the version input loses focus
async function handleVersionBlur(e) {
  const newVersion = e.target.value.trim() || 'v1.0';
  e.target.value   = newVersion;
  if (newVersion === projectData.version) return;
  projectData.version = newVersion;
  try {
    projectData = await api.saveProject(projectId, projectData);
    showToast('Version updated');
  } catch (err) {
    showToast('Could not save version: ' + err.message, true);
  }
}

// ── Files ─────────────────────────────────────────────────────────────────────

// Render the file list and wire up upload area
function renderFiles() {
  renderFileList();

  const uploadArea  = document.getElementById('file-upload-area');
  const fileInput   = document.getElementById('file-input');
  if (!uploadArea || !fileInput) return;

  // Click the hidden file input when the area is clicked
  uploadArea.addEventListener('click', () => fileInput.click());

  // Drag-and-drop visual feedback
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  });

  // File selected via dialog
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileUpload(fileInput.files[0]);
    fileInput.value = '';  // reset so the same file can be re-uploaded
  });
}

// Upload a file and update the project file list
async function handleFileUpload(file) {
  try {
    await api.uploadFile(projectId, file);
    // Reload full project to get updated files array
    projectData = await api.getProject(projectId);
    renderFileList();
    showToast(`Uploaded ${file.name}`);
  } catch (err) {
    showToast('Upload failed: ' + err.message, true);
  }
}

// Render the list of uploaded files
function renderFileList() {
  const list = document.getElementById('file-list');
  if (!list) return;
  const files = projectData.files || [];

  if (files.length === 0) {
    list.innerHTML = '<li class="file-item"><span class="text-secondary text-sm">No files uploaded yet.</span></li>';
    return;
  }

  list.innerHTML = files.map(filename => `
    <li class="file-item">
      <a href="${api.getFileUrl(projectId, filename)}" target="_blank" rel="noopener">${escapeHtml(filename)}</a>
    </li>
  `).join('');
}

// ── Project color picker ──────────────────────────────────────────────────────

// Build the preset swatch grid and wire up the custom color button
function initProjectColorPicker() {
  const grid        = document.getElementById('color-picker-grid-project');
  const hiddenInput = document.getElementById('project-color-value');
  if (!grid || !hiddenInput) return;

  PRESET_COLORS.forEach((color, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch' + (index === 0 ? ' selected' : '');
    btn.style.background = color;
    btn.dataset.color = color;
    btn.title = color;
    btn.addEventListener('click', () => selectProjectSwatch(btn, color));
    grid.appendChild(btn);
  });

  // Open the floating custom color picker to the right of the modal
  document.getElementById('btn-custom-color-project')?.addEventListener('click', () => {
    const modal = document.querySelector('#modal-color .modal');
    createFloatingColorPicker(modal, hiddenInput.value || '#4A90D9', (hex) => {
      hiddenInput.value = hex;
      grid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      let customSwatch = grid.querySelector('.color-swatch-custom');
      if (!customSwatch) {
        customSwatch = document.createElement('button');
        customSwatch.type = 'button';
        customSwatch.className = 'color-swatch color-swatch-custom selected';
        customSwatch.title = 'Custom';
        customSwatch.addEventListener('click', () => selectProjectSwatch(customSwatch, customSwatch.dataset.color));
        grid.appendChild(customSwatch);
      }
      customSwatch.style.background = hex;
      customSwatch.dataset.color = hex;
      customSwatch.classList.add('selected');
    });
  });
}

// Select a swatch in the project color picker
function selectProjectSwatch(swatchEl, color) {
  const grid = document.getElementById('color-picker-grid-project');
  grid?.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  swatchEl.classList.add('selected');
  const hiddenInput = document.getElementById('project-color-value');
  if (hiddenInput) hiddenInput.value = color;
}

// Sync swatch selection to the current project color when opening the modal
function syncColorPickerSelection(color) {
  const grid = document.getElementById('color-picker-grid-project');
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
      customSwatch.addEventListener('click', () => selectProjectSwatch(customSwatch, customSwatch.dataset.color));
      grid.appendChild(customSwatch);
    }
    customSwatch.style.background = color;
    customSwatch.dataset.color = color;
    customSwatch.classList.add('selected');
  }
}

// Open the color modal and pre-select the current project color
function openColorModal() {
  const hiddenInput = document.getElementById('project-color-value');
  if (hiddenInput) hiddenInput.value = projectData.color || '#4A90D9';
  syncColorPickerSelection(projectData.color || '#4A90D9');
  document.getElementById('modal-color').classList.add('open');
}

// Close the color modal and remove any open custom color picker
function closeColorModal() {
  document.getElementById('ccp-panel')?.remove();
  document.getElementById('modal-color').classList.remove('open');
}

// Save the chosen color to the project
async function handleColorSave() {
  const color = document.getElementById('project-color-value')?.value;
  if (!color || color === projectData.color) { closeColorModal(); return; }
  projectData.color = color;
  try {
    projectData = await api.saveProject(projectId, projectData);
    // Update both the header swatch bar and the color dot
    const swatch = document.getElementById('project-color-swatch');
    if (swatch) swatch.style.background = projectData.color;
    const btn = document.getElementById('project-color-btn');
    if (btn) btn.style.background = projectData.color;
    closeColorModal();
    showToast('Color updated');
  } catch (err) {
    showToast('Could not save color: ' + err.message, true);
  }
}

// ── Delete project ────────────────────────────────────────────────────────────

// Open the delete confirmation modal
function openProjectDeleteModal() {
  document.getElementById('delete-project-name-detail').textContent = projectData.name;
  document.getElementById('modal-delete-project').classList.add('open');
}

// Close the delete confirmation modal
function closeProjectDeleteModal() {
  document.getElementById('modal-delete-project').classList.remove('open');
}

// Confirm deletion — delete project and navigate back to dashboard
async function handleDeleteProjectConfirm() {
  try {
    await api.deleteProject(projectId);
    window.location.href = 'index.html';
  } catch (err) {
    showToast('Could not delete project: ' + err.message, true);
    closeProjectDeleteModal();
  }
}

// ── Timeline ──────────────────────────────────────────────────────────────────

// Open the timeline modal and render it
function openTimeline() {
  const overlay = document.getElementById('modal-timeline');
  if (!overlay) return;
  overlay.style.display = 'flex';
  renderTimeline();
}

// Close the timeline modal
function closeTimeline() {
  const overlay = document.getElementById('modal-timeline');
  if (overlay) overlay.style.display = 'none';
}

// Compute cumulative animation delay for timeline items (slow start, fast finish)
// Same exponential curve as tasks.js but tuned for horizontal reveal
function tlCumulativeDelay(index) {
  let total = 0;
  for (let i = 0; i < index; i++) {
    total += Math.max(10, Math.round(120 * Math.pow(0.62, i)));
  }
  return total;
}

// Build and render all tasks + sub-items onto the timeline track
function renderTimeline() {
  const track = document.getElementById('timeline-track');
  if (!track) return;
  track.innerHTML = '';

  const projectColor = projectData.color || '#4A90D9';

  // Update modal title
  const titleEl = document.getElementById('timeline-modal-title');
  if (titleEl) titleEl.textContent = (projectData.name || 'Project') + ' — Timeline';

  // Collect all dated and undated items from tasks and sub-items
  const tasks = projectData.tasks || [];
  const datedItems   = []; // { type:'task'|'subtask', obj, parentObj|null, date }
  const undatedItems = []; // { type:'task'|'subtask', obj, parentObj|null }

  tasks.forEach(task => {
    const d = parseDueDate(task.dueDate);
    if (d) {
      datedItems.push({ type: 'task', obj: task, parent: null, date: d });
    } else {
      undatedItems.push({ type: 'task', obj: task, parent: null });
    }
    (task.subItems || []).forEach(sub => {
      const sd = parseDueDate(sub.dueDate);
      if (sd) {
        datedItems.push({ type: 'subtask', obj: sub, parent: task, date: sd });
      } else {
        undatedItems.push({ type: 'subtask', obj: sub, parent: task });
      }
    });
  });

  // Sort dated items chronologically for both layout and animation order
  datedItems.sort((a, b) => a.date - b.date);

  // ── Compute date range ───────────────────────────────────────────────────────

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let minDate, maxDate;
  if (datedItems.length === 0) {
    // No dates at all — fake a 30-day window centred on today
    minDate = new Date(today); minDate.setDate(minDate.getDate() - 7);
    maxDate = new Date(today); maxDate.setDate(maxDate.getDate() + 23);
  } else {
    minDate = new Date(datedItems[0].date);
    maxDate = new Date(datedItems[datedItems.length - 1].date);
    // Ensure today is always visible inside the range
    if (today < minDate) minDate = new Date(today);
    if (today > maxDate) maxDate = new Date(today);
    // Pad 10 days on each side for breathing room
    minDate.setDate(minDate.getDate() - 10);
    maxDate.setDate(maxDate.getDate() + 10);
  }

  const dayRange   = Math.max(30, Math.round((maxDate - minDate) / 86400000));
  const pxPerDay   = 80; // horizontal pixels per day
  const trackWidth = dayRange * pxPerDay;

  // Reserve space on the right for the undated zone
  const undatedZoneWidth = undatedItems.length > 0 ? 240 : 0;
  const totalWidth = trackWidth + undatedZoneWidth + 80;

  track.style.width  = totalWidth + 'px';
  track.style.height = ''; // will grow naturally

  // ── Baseline ─────────────────────────────────────────────────────────────────

  const baselineTop = 80; // px from top where the baseline sits

  const baseline = document.createElement('div');
  baseline.className = 'tl-baseline';
  baseline.style.top = baselineTop + 'px';
  track.appendChild(baseline);

  // ── Helper: convert a Date to a pixel X position ─────────────────────────────
  function dateToX(date) {
    const days = (date - minDate) / 86400000;
    return Math.round(days * pxPerDay);
  }

  // ── Axis labels (one per month boundary) ─────────────────────────────────────

  const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (cur <= maxDate) {
    const x = dateToX(cur);
    if (x >= 0 && x <= trackWidth) {
      const tick = document.createElement('div');
      tick.className = 'tl-axis-tick';
      tick.style.left   = x + 'px';
      tick.style.top    = (baselineTop - 6) + 'px';
      tick.style.height = '12px';
      track.appendChild(tick);

      const label = document.createElement('div');
      label.className = 'tl-axis-label';
      label.style.left = x + 'px';
      label.style.top  = (baselineTop + 14) + 'px';
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      label.textContent = monthNames[cur.getMonth()] + ' ' + cur.getFullYear();
      track.appendChild(label);
    }
    cur.setMonth(cur.getMonth() + 1);
  }

  // ── Today line ────────────────────────────────────────────────────────────────

  const todayX = dateToX(today);
  if (todayX >= 0 && todayX <= trackWidth) {
    const todayLine = document.createElement('div');
    todayLine.className = 'tl-today-line';
    todayLine.style.left   = todayX + 'px';
    todayLine.style.top    = (baselineTop - 52) + 'px';
    todayLine.style.height = (52 + 160) + 'px'; // extend above and below baseline

    const todayLabel = document.createElement('div');
    todayLabel.className   = 'tl-today-label';
    todayLabel.textContent = 'Today';
    todayLine.appendChild(todayLabel);
    track.appendChild(todayLine);
  }

  // ── Undated zone ─────────────────────────────────────────────────────────────

  if (undatedItems.length > 0) {
    const sepX = trackWidth + 40;

    const sepLine = document.createElement('div');
    sepLine.className  = 'tl-undated-line';
    sepLine.style.left = sepX + 'px';
    sepLine.style.top  = (baselineTop - 52) + 'px';
    sepLine.style.height = (52 + 160) + 'px';

    const sepLabel = document.createElement('div');
    sepLabel.className   = 'tl-undated-label';
    sepLabel.textContent = 'No Due Date';
    sepLine.appendChild(sepLabel);
    track.appendChild(sepLine);
  }

  // ── Place dated items on the timeline ─────────────────────────────────────────
  // Track used columns per X bucket to avoid vertical overlap
  const colMap = {}; // key = Math.round(x / 20) → next available top offset

  function reserveSlot(x) {
    const bucket = Math.round(x / 20);
    if (!colMap[bucket]) colMap[bucket] = 0;
    const slot = colMap[bucket];
    colMap[bucket]++;
    return slot;
  }

  const allAnimItems = []; // collect in date order for staggered animation

  datedItems.forEach(item => {
    const x    = dateToX(item.date);
    const slot = reserveSlot(x);
    const isTask    = item.type === 'task';
    const itemHeight = isTask ? 58 : 42;
    const gap        = 10;
    // Tasks sit above baseline, sub-tasks sit below
    const topPx = isTask
      ? baselineTop - itemHeight - gap - slot * (itemHeight + gap)
      : baselineTop + gap + slot * (itemHeight + gap);

    const el = document.createElement('div');
    el.className = isTask ? 'tl-task' : 'tl-subtask';
    if (item.obj.completed) el.classList.add('tl-completed');
    el.style.setProperty('--tl-color', projectColor);
    el.style.left = x + 'px';
    el.style.top  = topPx + 'px';
    el.style.transform = 'translateX(-50%)'; // centre on date

    const nameSpan = document.createElement('div');
    nameSpan.textContent = item.obj.text || '';
    el.appendChild(nameSpan);

    if (item.date) {
      const dateSpan = document.createElement('div');
      dateSpan.className   = isTask ? 'tl-task-date' : 'tl-subtask-date';
      dateSpan.textContent = formatDueDate(item.obj.dueDate) || '';
      el.appendChild(dateSpan);
    }

    track.appendChild(el);
    allAnimItems.push({ el, x });
  });

  // ── Place undated items in the undated zone ───────────────────────────────────

  const undatedStartX = trackWidth + 40 + 20;
  let undatedTop = baselineTop - 58 - 10;

  undatedItems.forEach(item => {
    const isTask = item.type === 'task';
    const el = document.createElement('div');
    el.className = isTask ? 'tl-task' : 'tl-subtask';
    if (item.obj.completed) el.classList.add('tl-completed');
    el.style.setProperty('--tl-color', projectColor);
    el.style.left = undatedStartX + 'px';
    el.style.top  = undatedTop + 'px';

    const nameSpan = document.createElement('div');
    nameSpan.textContent = item.obj.text || '';
    el.appendChild(nameSpan);

    track.appendChild(el);
    allAnimItems.push({ el, x: undatedStartX });

    undatedTop -= (isTask ? 58 : 42) + 10;
    // Wrap downward after several items
    if (undatedTop < baselineTop - 58 - 10 - 4 * 68) undatedTop = baselineTop + 10;
  });

  // ── Apply staggered animation (left to right, slow start → fast finish) ───────

  // Sort all items by x position so animation sweeps left to right
  allAnimItems.sort((a, b) => a.x - b.x);
  allAnimItems.forEach(({ el }, i) => {
    // Completed items use the faded animation so they settle at reduced opacity
    const animName = el.classList.contains('tl-completed') ? 'tl-pop-in-faded' : 'tl-pop-in';
    el.style.animationName  = animName;
    el.style.animationDelay = tlCumulativeDelay(i) + 'ms';
  });
}

// ── Task add form ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initProjectColorPicker();

  document.getElementById('btn-cancel-color')
    ?.addEventListener('click', closeColorModal);
  document.getElementById('btn-save-color')
    ?.addEventListener('click', handleColorSave);
  document.getElementById('modal-color')
    ?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeColorModal(); });

  // Task add form — reads optional due date inputs alongside task text
  const input  = document.getElementById('task-add-input');
  const addBtn = document.getElementById('btn-add-task');

  const submitAdd = () => {
    const text = input?.value.trim();
    if (!text) return;
    const month = document.getElementById('add-month')?.value.trim() || '';
    const day   = document.getElementById('add-day')?.value.trim() || '';
    const year  = document.getElementById('add-year')?.value.trim() || '';
    const dueDate = (month || day || year) ? { month, day, year } : null;
    addTask(text, dueDate);
    if (input) input.value = '';
    ['add-month', 'add-day', 'add-year'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  };

  addBtn?.addEventListener('click', submitAdd);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdd(); });

  // Wire numeric-only validation on the add-task date inputs
  ['add-month', 'add-day', 'add-year'].forEach(id => {
    const el = document.getElementById(id);
    if (el) wireDateInput(el);
  });

  // Undo and Order by Date buttons
  document.getElementById('btn-undo')?.addEventListener('click', undoLastAction);
  document.getElementById('btn-order-by-date')?.addEventListener('click', orderByDate);

  // Timeline button
  document.getElementById('btn-timeline')?.addEventListener('click', openTimeline);
  document.getElementById('btn-close-timeline')?.addEventListener('click', closeTimeline);
  document.getElementById('modal-timeline')
    ?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeTimeline(); });

  // Delete project modal
  document.getElementById('btn-delete-project')
    ?.addEventListener('click', openProjectDeleteModal);
  document.getElementById('btn-cancel-delete-project')
    ?.addEventListener('click', closeProjectDeleteModal);
  document.getElementById('btn-confirm-delete-project')
    ?.addEventListener('click', handleDeleteProjectConfirm);
  document.getElementById('modal-delete-project')
    ?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeProjectDeleteModal(); });
});

