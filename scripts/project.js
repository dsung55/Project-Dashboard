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
let notesTimer    = null;     // debounce timer for project-level notes autosave
let taskNotesTimer = null;   // debounce timer for per-task notes autosave (separate to avoid cross-cancellation)
let purposeTimer  = null;    // debounce timer for purpose autosave
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

  // Delete task — confirm first if task has sub-items
  item.querySelector('.btn-task-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    const hasSubItems = task.subItems && task.subItems.length > 0;
    if (hasSubItems) {
      confirmDeleteTask(task.id, task.text);
    } else {
      deleteTask(task.id);
    }
  });

  // Wire up sub-item interactions
  wireSubItemEvents(item, task);

  // Task notes: debounced save
  const notesInput = item.querySelector('.task-notes-input');
  notesInput.addEventListener('input', () => {
    clearTimeout(taskNotesTimer);
    taskNotesTimer = setTimeout(() => updateTaskNotes(task.id, notesInput.value), 800);
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
  let lastDropTarget = null; // track the highlighted element to avoid querySelectorAll on every dragover

  const items = list.querySelectorAll('.task-item[draggable="true"]');
  items.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedTaskId = item.dataset.id;
      item.classList.add('task-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      draggedTaskId = null;
      if (lastDropTarget) {
        lastDropTarget.classList.remove('drop-before', 'drop-after');
        lastDropTarget = null;
      }
      list.querySelectorAll('.task-dragging')
        .forEach(el => el.classList.remove('task-dragging'));
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (item.dataset.id === draggedTaskId) return;
      // Determine above or below based on cursor Y relative to item midpoint
      const rect    = item.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;
      // Clear only the previously highlighted element — no full-list querySelectorAll
      if (lastDropTarget && lastDropTarget !== item) {
        lastDropTarget.classList.remove('drop-before', 'drop-after');
      }
      item.classList.toggle('drop-before',  isAbove);
      item.classList.toggle('drop-after',  !isAbove);
      lastDropTarget = item;
    });

    item.addEventListener('dragleave', (e) => {
      if (!item.contains(e.relatedTarget)) {
        item.classList.remove('drop-before', 'drop-after');
        if (lastDropTarget === item) lastDropTarget = null;
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

      // Snapshot task positions BEFORE the DOM changes so we can FLIP-animate them
      const taskList    = document.getElementById('task-list');
      const allItemEls  = [...taskList.querySelectorAll('.task-item')];
      const beforeRects = new Map(allItemEls.map(el => [el.dataset.id, el.getBoundingClientRect()]));
      const movedId     = draggedTaskId;

      // Splice out the dragged task, then insert before or after the target
      pushUndo();
      const allTasks       = projectData.tasks || [];
      const draggedObj     = allTasks.find(t => t.id === draggedTaskId);
      const withoutDragged = allTasks.filter(t => t.id !== draggedTaskId);
      const targetObj      = allTasks.find(t => t.id === item.dataset.id);
      const targetInAll    = withoutDragged.indexOf(targetObj);
      withoutDragged.splice(insertBefore ? targetInAll : targetInAll + 1, 0, draggedObj);
      projectData.tasks = withoutDragged;

      // Re-render the task list first so the DOM reflects the new order
      renderTasks();

      // FLIP: animate each task from its captured position to its new position
      const newItemEls = [...taskList.querySelectorAll('.task-item')];
      newItemEls.forEach(el => {
        const before = beforeRects.get(el.dataset.id);
        if (!before) return;
        const after = el.getBoundingClientRect();
        const dy    = before.top - after.top;

        if (el.dataset.id === movedId) {
          // Dropped task: bubble-in from its old slot
          el.style.animation = 'none';
          void el.offsetWidth;
          el.style.animation = 'task-bubble 300ms cubic-bezier(0.34, 1.4, 0.64, 1) both';
        } else if (Math.abs(dy) >= 0.5) {
          // Neighboring task that shifted: slide to new position
          el.style.transition = 'none';
          el.style.transform  = `translateY(${dy}px)`;
          void el.offsetWidth;
          el.style.transition = 'transform 280ms cubic-bezier(0.25, 1, 0.5, 1)';
          el.style.transform  = '';
          el.addEventListener('transitionend', () => {
            el.style.transition = '';
            el.style.transform  = '';
          }, { once: true });
        }
      });

      // Update session storage and save — no re-render needed (already rendered above)
      const currentTask = (projectData.tasks || []).find(t => !t.completed)?.text ?? null;
      sessionStorage.setItem('ct_' + projectId, JSON.stringify(currentTask));
      await saveProject();
    });
  });
}

// ── Sub-item drag-to-reorder ──────────────────────────────────────────────────

// Wire HTML5 drag-and-drop on sub-item rows to allow reordering
function initSubItemDrag(taskItemEl, task) {
  const subList = taskItemEl.querySelector('.sub-items-list');
  if (!subList) return;

  let draggedSubId = null;
  let lastSubDropTarget = null; // track the highlighted row to avoid querySelectorAll on every dragover

  subList.querySelectorAll('.sub-item-row').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      draggedSubId = row.dataset.subId;
      row.classList.add('sub-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();  // don't trigger task drag
    });

    row.addEventListener('dragend', () => {
      draggedSubId = null;
      if (lastSubDropTarget) {
        lastSubDropTarget.classList.remove('drop-before', 'drop-after');
        lastSubDropTarget = null;
      }
      subList.querySelectorAll('.sub-dragging')
        .forEach(el => el.classList.remove('sub-dragging'));
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (row.dataset.subId === draggedSubId) return;
      // Clear only the previously highlighted row — no full-list querySelectorAll
      if (lastSubDropTarget && lastSubDropTarget !== row) {
        lastSubDropTarget.classList.remove('drop-before', 'drop-after');
      }
      const rect    = row.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + row.offsetHeight / 2;
      row.classList.toggle('drop-before',  isAbove);
      row.classList.toggle('drop-after',  !isAbove);
      lastSubDropTarget = row;
    });

    row.addEventListener('dragleave', (e) => {
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove('drop-before', 'drop-after');
        if (lastSubDropTarget === row) lastSubDropTarget = null;
      }
    });

    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const insertBefore = row.classList.contains('drop-before');
      row.classList.remove('drop-before', 'drop-after');
      const dropSubId = row.dataset.subId;
      if (draggedSubId === null || draggedSubId === dropSubId) return;

      const t = projectData.tasks.find(t => t.id === task.id);
      if (!t || !t.subItems) return;

      // Look up positions by ID so display-order sorts don't corrupt the storage order
      const subs    = [...t.subItems];
      const fromIdx = subs.findIndex(s => s.id === draggedSubId);
      const toIdx   = subs.findIndex(s => s.id === dropSubId);
      if (fromIdx === -1 || toIdx === -1) return;

      // Splice out the dragged item, adjust target index for the removal, then insert
      const [moved] = subs.splice(fromIdx, 1);
      const adjustedToIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
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

// Open the delete-task confirmation modal; stores the pending task id on the confirm button
function confirmDeleteTask(taskId, taskText) {
  document.getElementById('delete-task-name').textContent = taskText;
  const confirmBtn = document.getElementById('btn-confirm-delete-task');
  confirmBtn.dataset.pendingId = taskId;
  document.getElementById('modal-delete-task').classList.add('open');
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

  // Render immediately from in-memory state — no need to wait for the network round-trip
  const currentTask = (projectData.tasks || []).find(t => !t.completed)?.text ?? null;
  sessionStorage.setItem('ct_' + projectId, JSON.stringify(currentTask));
  renderTasks();

  try {
    projectData = await api.saveProject(projectId, projectData);
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

// Module-level state — persists across renders so zoom/pan survives re-renders
let tlViewStart = 0;    // fraction of data range visible at left edge of viewport
let tlViewEnd   = 1;    // fraction of data range visible at right edge of viewport
let tlMinDate   = null; // cached earliest task date (Date object)
let tlMaxDate   = null; // cached latest task date (Date object)
let tlRange     = 0;    // tlMaxDate - tlMinDate in ms
let tlDragState = null; // { x, viewStart, viewEnd } while dragging, null otherwise

// Geometry constants shared by renderTimeline and repositionTimeline
const TL_STEM_BASE  = 40; // minimum stem height in px
const TL_LEVEL_STEP = 78; // additional px per collision level
const TL_LABEL_H    = 52; // approximate label height in px
const TL_EDGE_PAD   = 28; // breathing room above/below the outermost labels

// Compute stem/level geometry scaled so the track fits within availH.
// Returns { stemBase, levelStep, aboveH, belowH, trackH, baselineY }.
function computeTlGeometry(maxAbove, maxBelow, availH) {
  let stemBase  = TL_STEM_BASE;
  let levelStep = TL_LEVEL_STEP;

  const rawAboveH = TL_EDGE_PAD + TL_LABEL_H + stemBase + maxAbove * levelStep;
  const rawBelowH = TL_EDGE_PAD + TL_LABEL_H + stemBase + maxBelow * levelStep;
  const rawH      = rawAboveH + rawBelowH + 4;

  // Scale down so the track never exceeds the visible area
  if (availH > 0 && rawH > availH) {
    const scale = availH / rawH;
    stemBase  = Math.max(14, Math.round(TL_STEM_BASE  * scale));
    levelStep = Math.max(TL_LABEL_H + 4, Math.round(TL_LEVEL_STEP * scale));
  }

  const aboveH    = TL_EDGE_PAD + TL_LABEL_H + stemBase + maxAbove * levelStep;
  const belowH    = TL_EDGE_PAD + TL_LABEL_H + stemBase + maxBelow * levelStep;
  const trackH    = aboveH + belowH + 4;
  const baselineY = aboveH;
  return { stemBase, levelStep, aboveH, belowH, trackH, baselineY };
}

// DOM references cached on initial render — updated by repositionTimeline without rebuilding
let tlPinEls     = []; // pin elements index-aligned with tlDatedItems
let tlLabelEls   = []; // label elements, stored in a separate overlay so they always render above stems
let tlTickEls    = []; // [{ el, date }] for every month-boundary tick
let tlTodayEl    = null;
let tlTodayBadge = null; // "Today" chip — separate element so it can be above label boxes
let tlBaselineEl = null;
let tlDatedItems = []; // sorted dated items cached for reposition passes

// Open the timeline modal — resets zoom/pan so all tasks are visible
function openTimeline() {
  const overlay = document.getElementById('modal-timeline');
  if (!overlay) return;
  tlViewStart = 0;
  tlViewEnd   = 1;
  overlay.style.display = 'flex';
  renderTimeline();
}

// Close the timeline modal
function closeTimeline() {
  const overlay = document.getElementById('modal-timeline');
  if (overlay) overlay.style.display = 'none';
}

// Build cumulative animation delays for `count` timeline items in a single O(n) pass
function buildTlDelays(count) {
  const delays = new Array(count);
  let total = 0;
  for (let i = 0; i < count; i++) {
    delays[i] = total;
    total += Math.max(10, Math.round(120 * Math.pow(0.82, i)));
  }
  return delays;
}

// Assign a { side, level } to each item using a greedy collision-avoidance algorithm.
// Items too close horizontally at the same side+level get bumped to the next level.
function computePlacements(datedItems, dateToPct, trackW) {
  const LABEL_W_PX = 184; // estimated max label pixel width + gap so boxes never touch
  const placed = [];       // { pct, side, level } for already-assigned items

  return datedItems.map((item, idx) => {
    const pct        = dateToPct(item.date);
    const minGapPct  = (LABEL_W_PX / trackW) * 100;
    const preferSide = idx % 2 === 0 ? 'above' : 'below';
    const sides      = [preferSide, preferSide === 'above' ? 'below' : 'above'];

    for (let level = 0; level < 8; level++) {
      for (const side of sides) {
        const hasConflict = placed.some(p =>
          p.side === side && p.level === level && Math.abs(p.pct - pct) < minGapPct
        );
        if (!hasConflict) {
          placed.push({ pct, side, level });
          return { item, pct, side, level };
        }
      }
    }
    // Absolute fallback — should never be reached in practice
    placed.push({ pct, side: preferSide, level: 7 });
    return { item, pct, side: preferSide, level: 7 };
  });
}

// Build and render all tasks onto the timeline.
// Called only on initial open — sets up DOM and runs the staggered intro animation.
// For zoom/pan updates use repositionTimeline() which moves existing elements without rebuilding.
function renderTimeline() {
  const track = document.getElementById('timeline-track');
  if (!track) return;
  track.innerHTML = '';

  // Reset cached DOM references so repositionTimeline starts clean
  tlPinEls     = [];
  tlLabelEls   = [];
  tlTickEls    = [];
  tlTodayEl    = null;
  tlTodayBadge = null;
  tlBaselineEl = null;
  tlDatedItems = [];

  const wrap = track.closest('.timeline-scroll-wrap');
  wrap?.querySelector('.tl-undated-section')?.remove();

  const projectColor = projectData.color || '#4A90D9';

  // Update modal title
  const titleEl = document.getElementById('timeline-modal-title');
  if (titleEl) titleEl.textContent = (projectData.name || 'Project') + ' — Timeline';

  // Collect dated and undated items from tasks and sub-items
  const tasks        = projectData.tasks || [];
  const datedItems   = [];
  const undatedItems = [];

  tasks.forEach(task => {
    const d = parseDueDate(task.dueDate);
    if (d) datedItems.push({ type: 'task', obj: task, date: d, taskId: task.id });
    else   undatedItems.push({ type: 'task', obj: task });
    (task.subItems || []).forEach(sub => {
      const sd = parseDueDate(sub.dueDate);
      if (sd) datedItems.push({ type: 'subtask', obj: sub, date: sd, parentId: task.id });
      else    undatedItems.push({ type: 'subtask', obj: sub });
    });
  });

  datedItems.sort((a, b) => a.date - b.date);

  // ── Empty state ───────────────────────────────────────────────────────────────

  if (datedItems.length === 0) {
    const empty = document.createElement('div');
    empty.className   = 'tl-empty';
    empty.textContent = 'No tasks have due dates yet. Add a due date to any task to see it on the timeline.';
    track.appendChild(empty);
    if (undatedItems.length > 0 && wrap) wrap.appendChild(buildUndatedSection(undatedItems));
    return;
  }

  // ── Cache date range — always include today so the today line stays visible ──

  const todayAnchor = new Date(); todayAnchor.setHours(0, 0, 0, 0);
  tlMinDate = new Date(Math.min(datedItems[0].date.getTime(), todayAnchor.getTime()));
  tlMaxDate = new Date(Math.max(datedItems[datedItems.length - 1].date.getTime(), todayAnchor.getTime()));
  tlRange   = tlMaxDate - tlMinDate;

  // Convert a Date to a percentage position within the current viewport
  function dateToPct(date) {
    if (tlRange === 0) return 50;
    const frac = (date - tlMinDate) / tlRange;
    return ((frac - tlViewStart) / (tlViewEnd - tlViewStart)) * 100;
  }

  // ── Track pixel width — used for collision detection in pixel space ───────────

  const hPad   = 64; // horizontal padding each side (matches CSS)
  const trackW = Math.max(400, (wrap?.clientWidth || 900) - hPad * 2);

  // ── Compute placements with vertical collision avoidance ──────────────────────

  tlDatedItems = datedItems; // cache for repositionTimeline
  const placements = computePlacements(datedItems, dateToPct, trackW);

  // ── Dynamic track height based on max levels used ────────────────────────────

  let maxAbove = 0, maxBelow = 0;
  placements.forEach(p => {
    if (p.side === 'above') maxAbove = Math.max(maxAbove, p.level);
    else                    maxBelow = Math.max(maxBelow, p.level);
  });

  // Auto-scale geometry so all stacked labels fit without overflowing the modal
  const availH = (wrap?.clientHeight || 600) - 48; // subtract vertical padding
  const { stemBase, levelStep, aboveH, belowH, trackH, baselineY } =
    computeTlGeometry(maxAbove, maxBelow, availH);

  track.style.height = trackH + 'px';

  // ── Baseline (thick horizontal center line) ───────────────────────────────────

  tlBaselineEl = Object.assign(document.createElement('div'), { className: 'tl-baseline' });
  tlBaselineEl.style.top = baselineY + 'px';
  track.appendChild(tlBaselineEl);

  // ── Month tick marks — ALL month boundaries created upfront so repositionTimeline
  //    can show/hide them as the viewport shifts without rebuilding the DOM ─────────

  const firstTick = new Date(tlMinDate.getFullYear(), tlMinDate.getMonth() + 1, 1);
  for (let d = new Date(firstTick); d <= tlMaxDate; d.setMonth(d.getMonth() + 1)) {
    const tickDate = new Date(d);
    const tickPct  = dateToPct(tickDate);
    const tick = document.createElement('div');
    tick.className  = 'tl-month-tick';
    tick.style.left = tickPct + '%';
    tick.style.top  = (baselineY - 4) + 'px';
    track.appendChild(tick);
    tlTickEls.push({ el: tick, date: tickDate });
  }

  // ── Today vertical line + badge — created as two separate elements so the badge
  //    can sit at z-index 5 (above label boxes) while the line stays at z-index 0 ──

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayPct = dateToPct(today);

  const todayLine = document.createElement('div');
  todayLine.className    = 'tl-today-line';
  todayLine.style.left   = todayPct + '%';
  todayLine.style.height = trackH + 'px';
  if (todayPct < -2 || todayPct > 102) todayLine.style.display = 'none';
  track.appendChild(todayLine);
  tlTodayEl = todayLine;

  // Badge is a sibling of the line (not a child) so it has its own z-index
  const todayBadge = document.createElement('div');
  todayBadge.className   = 'tl-today-badge';
  todayBadge.textContent = 'Today';
  todayBadge.style.left  = todayPct + '%';
  if (todayPct < -2 || todayPct > 102) todayBadge.style.display = 'none';
  track.appendChild(todayBadge);
  tlTodayBadge = todayBadge;

  // ── Place pins using computed collision-free positions ────────────────────────

  // ── Per-task accent colors — subtasks inherit their parent task's color ──────
  // Palette cycles through distinct hues so sibling tasks are visually distinct.
  const TASK_PALETTE = [
    '#4A90D9', '#E8734A', '#5BAD6F', '#9B6DD4',
    '#D4A843', '#4ABCB8', '#D45E8A', '#7A9E4A',
  ];
  const taskColorMap = {}; // taskId -> color
  tasks.forEach((task, i) => {
    taskColorMap[task.id] = TASK_PALETTE[i % TASK_PALETTE.length];
  });

  const allAnimPins = [];

  // All pins are added to the DOM upfront — off-screen ones are hidden so
  // repositionTimeline() can reveal them on zoom/pan without a DOM rebuild.
  placements.forEach(({ item, pct, side, level }) => {
    // Parent tasks use their assigned palette color; subtasks match their parent
    const pinColor = item.type === 'subtask'
      ? (taskColorMap[item.parentId] || projectColor)
      : (taskColorMap[item.taskId]   || projectColor);

    const stemH = stemBase + level * levelStep;
    const pin   = buildPin({
      pct,
      isAbove:    side === 'above',
      nameText:   item.obj.text || '',
      dateText:   formatDueDate(item.obj.dueDate) || null,
      color:      pinColor,
      completed:  !!item.obj.completed,
      baselineY,
      stemH,
      isSubtask:  item.type === 'subtask',
    });

    const isVisible = pct >= -30 && pct <= 130;
    if (!isVisible) pin.style.display = 'none'; // hidden until panned/zoomed into view

    track.appendChild(pin);
    tlPinEls.push(pin); // store reference for incremental updates
    if (isVisible) allAnimPins.push({ el: pin, pct });
  });

  // ── Move labels into a shared overlay so they always paint above all stems ────
  // Each label is repositioned from pin-relative coords to track-absolute coords.
  // This eliminates cross-pin z-index fights caused by each pin's animation stacking context.

  const labelOverlay = document.createElement('div');
  labelOverlay.className = 'tl-label-overlay';
  track.appendChild(labelOverlay);

  placements.forEach(({ pct, side, level }, i) => {
    const pin   = tlPinEls[i];
    const label = pin?.querySelector('.tl-pin-label');
    if (!label) { tlLabelEls.push(null); return; }

    const stemH   = stemBase + level * levelStep;
    const isAbove = side === 'above';

    // Rewrite position from pin-relative to track-absolute using bottom (above) or top (below)
    label.style.left   = pct + '%';
    label.style.bottom = isAbove ? (trackH - baselineY + stemH + 12) + 'px' : 'auto';
    label.style.top    = isAbove ? 'auto' : (baselineY + stemH + 12) + 'px';

    if (pin.style.display === 'none') label.style.display = 'none';

    labelOverlay.appendChild(label);
    tlLabelEls.push(label);
  });

  // ── Undated items listed below the track ─────────────────────────────────────

  if (undatedItems.length > 0 && wrap) wrap.appendChild(buildUndatedSection(undatedItems));

  // ── Staggered fade-in left → right ───────────────────────────────────────────

  allAnimPins.sort((a, b) => a.pct - b.pct);
  const tlDelays = buildTlDelays(allAnimPins.length);
  allAnimPins.forEach(({ el }, i) => {
    const isFaded = el.classList.contains('tl-completed');
    el.style.animationName  = isFaded ? 'tl-pin-in-faded' : 'tl-pin-in';
    el.style.animationDelay = tlDelays[i] + 'ms';
    // Also animate the label (now in overlay, not inside pin, so needs its own animation)
    const label = tlLabelEls[tlPinEls.indexOf(el)];
    if (label) {
      label.style.animationName           = isFaded ? 'tl-label-in-faded' : 'tl-label-in';
      label.style.animationDelay          = tlDelays[i] + 'ms';
      label.style.animationDuration       = '280ms';
      label.style.animationFillMode       = 'forwards';
      label.style.animationTimingFunction = 'ease-out';
    }
  });
}

// Update all pin/tick/today positions after a zoom or pan without rebuilding the DOM.
// This avoids re-triggering the intro animation and keeps interaction smooth.
function repositionTimeline() {
  const track = document.getElementById('timeline-track');
  if (!track || tlPinEls.length === 0) return; // fall back to nothing if not yet built

  const wrap   = track.closest('.timeline-scroll-wrap');
  const hPad   = 64;
  const trackW = Math.max(400, (wrap?.clientWidth || 900) - hPad * 2);

  // Recompute dateToPct with current viewport state
  function dateToPct(date) {
    if (tlRange === 0) return 50;
    const frac = (date - tlMinDate) / tlRange;
    return ((frac - tlViewStart) / (tlViewEnd - tlViewStart)) * 100;
  }

  // Re-run collision avoidance — positions change relative to each other when zooming
  const placements = computePlacements(tlDatedItems, dateToPct, trackW);

  // Recalculate track height based only on visible items — off-screen items can have
  // extreme levels that over-compress the geometry and cause labels to overlap
  let maxAbove = 0, maxBelow = 0;
  placements.forEach(p => {
    if (p.pct < -30 || p.pct > 130) return; // skip off-screen items
    if (p.side === 'above') maxAbove = Math.max(maxAbove, p.level);
    else                    maxBelow = Math.max(maxBelow, p.level);
  });
  // Auto-scale geometry to fit within the visible area (same logic as renderTimeline)
  const repositionAvailH = (wrap?.clientHeight || 600) - 48;
  const { stemBase, levelStep, aboveH, belowH, trackH, baselineY } =
    computeTlGeometry(maxAbove, maxBelow, repositionAvailH);

  track.style.height = trackH + 'px';
  if (tlBaselineEl) tlBaselineEl.style.top = baselineY + 'px';

  // Update month tick positions — show/hide based on current viewport
  tlTickEls.forEach(({ el, date }) => {
    const pct = dateToPct(date);
    if (pct < -1 || pct > 101) {
      el.style.display = 'none';
    } else {
      el.style.display = '';
      el.style.left    = pct + '%';
      el.style.top     = (baselineY - 4) + 'px';
    }
  });

  // Update today line + badge positions
  if (tlTodayEl || tlTodayBadge) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const pct = dateToPct(today);
    const hide = pct < -2 || pct > 102;
    if (tlTodayEl) {
      tlTodayEl.style.display = hide ? 'none' : '';
      if (!hide) { tlTodayEl.style.left = pct + '%'; tlTodayEl.style.height = trackH + 'px'; }
    }
    if (tlTodayBadge) {
      tlTodayBadge.style.display = hide ? 'none' : '';
      if (!hide) tlTodayBadge.style.left = pct + '%';
    }
  }

  // Update each pin's position, side, and stem height — no animation
  placements.forEach(({ pct, side, level }, i) => {
    const pin   = tlPinEls[i];
    const label = tlLabelEls[i]; // labels live in overlay, not inside the pin
    if (!pin) return;

    const isVisible = pct >= -30 && pct <= 130;
    if (!isVisible) {
      pin.style.display = 'none';
      if (label) label.style.display = 'none';
      return;
    }

    pin.style.display = '';
    pin.style.left    = pct + '%';
    pin.style.top     = baselineY + 'px';

    const isAbove = side === 'above';
    pin.classList.toggle('tl-above', isAbove);
    pin.classList.toggle('tl-below', !isAbove);

    const stemH = stemBase + level * levelStep;
    const stem  = pin.querySelector('.tl-pin-stem');

    if (stem) {
      stem.style.height = stemH + 'px';
      stem.style.bottom = isAbove ? '8px' : 'auto';
      stem.style.top    = isAbove ? 'auto' : '8px';
    }
    if (label) {
      label.style.display = '';
      label.style.left    = pct + '%';
      label.style.bottom  = isAbove ? (trackH - baselineY + stemH + 12) + 'px' : 'auto';
      label.style.top     = isAbove ? 'auto' : (baselineY + stemH + 12) + 'px';
    }
  });
}

// Create one pin element (dot + stem + label) with dynamic vertical sizing.
// baselineY: pixel distance from track top to the horizontal baseline.
// stemH: stem pixel height for this pin's level.
function buildPin({ pct, isAbove, nameText, dateText, color, completed, baselineY, stemH, isSubtask }) {
  const pin = document.createElement('div');
  pin.className = 'tl-pin ' + (isAbove ? 'tl-above' : 'tl-below');
  if (completed)  pin.classList.add('tl-completed');
  if (isSubtask)  pin.classList.add('tl-subtask');
  if (color)      pin.style.setProperty('--tl-color', color);
  pin.style.left = pct + '%';
  pin.style.top  = baselineY + 'px';

  const dot = document.createElement('div');
  dot.className = 'tl-pin-dot';

  const stem = document.createElement('div');
  stem.className    = 'tl-pin-stem';
  stem.style.height = stemH + 'px';
  // Inline styles override the CSS defaults and apply the correct level offset
  if (isAbove) {
    stem.style.bottom = '8px';
    stem.style.top    = 'auto';
  } else {
    stem.style.top    = '8px';
    stem.style.bottom = 'auto';
  }

  const label = document.createElement('div');
  label.className = 'tl-pin-label';
  if (isAbove) {
    label.style.bottom = (stemH + 12) + 'px';
    label.style.top    = 'auto';
  } else {
    label.style.top    = (stemH + 12) + 'px';
    label.style.bottom = 'auto';
  }

  const name = document.createElement('div');
  name.className   = 'tl-pin-name';
  name.textContent = nameText;
  label.appendChild(name);

  if (dateText) {
    const dateEl = document.createElement('div');
    dateEl.className   = 'tl-pin-date';
    dateEl.textContent = dateText;
    label.appendChild(dateEl);
  }

  // Visual order: above pins render label→stem→dot top-to-bottom; below is reversed
  if (isAbove) {
    pin.appendChild(label);
    pin.appendChild(stem);
    pin.appendChild(dot);
  } else {
    pin.appendChild(dot);
    pin.appendChild(stem);
    pin.appendChild(label);
  }

  return pin;
}

// Zoom the timeline in or out around the cursor position using the scroll wheel
function handleTlWheel(e) {
  const overlay = document.getElementById('modal-timeline');
  if (!overlay || overlay.style.display === 'none') return;
  if (tlMinDate === null) return; // no dated tasks loaded yet
  e.preventDefault();

  const wrap   = e.currentTarget;
  const rect   = wrap.getBoundingClientRect();
  const hPad   = 64;
  // Cursor position as a 0–1 fraction across the inner track width
  const cursorFrac = Math.max(0, Math.min(1, (e.clientX - rect.left - hPad) / (rect.width - hPad * 2)));

  const factor     = e.deltaY > 0 ? 1.04 : 0.962; // scroll down = zoom out, up = zoom in (low sensitivity)
  const visible    = tlViewEnd - tlViewStart;
  const newVisible = Math.min(1, Math.max(0.04, visible * factor)); // max = 1 (can't zoom past data range)

  if (newVisible >= 1) {
    // At max zoom out: show exactly the data range, no overscroll
    tlViewStart = 0;
    tlViewEnd   = 1;
  } else {
    // Zoom around the cursor — keep the date under the cursor stationary
    const center = tlViewStart + cursorFrac * visible;
    let newStart = center - cursorFrac * newVisible;
    let newEnd   = center + (1 - cursorFrac) * newVisible;

    // Hard-clamp to the data edges — don't allow panning past earliest/latest task
    newStart = Math.max(0, newStart);
    newEnd   = Math.min(1, newEnd);

    tlViewStart = newStart;
    tlViewEnd   = newEnd;
  }
  repositionTimeline();
}

// Begin a click-drag pan on the timeline
function handleTlDragStart(e) {
  const overlay = document.getElementById('modal-timeline');
  if (!overlay || overlay.style.display === 'none') return;
  if (e.button !== 0) return;
  if (tlMinDate === null) return;

  const wrap = document.querySelector('.timeline-scroll-wrap');
  if (!wrap || !wrap.contains(e.target)) return;

  e.preventDefault();
  tlDragState = { x: e.clientX, viewStart: tlViewStart, viewEnd: tlViewEnd };
  wrap.style.cursor = 'grabbing';
}

// Pan the timeline as the pointer moves during a drag
function handleTlDragMove(e) {
  if (!tlDragState) return;
  const wrap = document.querySelector('.timeline-scroll-wrap');
  if (!wrap) return;

  // No panning when fully zoomed out (data range fully visible)
  if (tlViewEnd - tlViewStart >= 1) return;

  const rect   = wrap.getBoundingClientRect();
  const trackW = Math.max(1, rect.width - 128);
  const dxFrac = (e.clientX - tlDragState.x) / trackW;
  const vis    = tlDragState.viewEnd - tlDragState.viewStart;

  // Moving right shifts the viewport left (dates shift right on screen)
  let newStart = tlDragState.viewStart - dxFrac * vis;
  let newEnd   = tlDragState.viewEnd   - dxFrac * vis;

  // Clamp to data edges — don't pan past the earliest or latest task
  if (newStart < 0) { newEnd -= newStart; newStart = 0; }
  if (newEnd   > 1) { newStart -= (newEnd - 1); newEnd = 1; }

  tlViewStart = newStart;
  tlViewEnd   = newEnd;
  repositionTimeline();
}

// End the drag-to-pan operation
function handleTlDragEnd() {
  if (!tlDragState) return;
  tlDragState = null;
  const wrap = document.querySelector('.timeline-scroll-wrap');
  if (wrap) wrap.style.cursor = '';
}

// Build the "No Due Date" section rendered below the track
function buildUndatedSection(undatedItems) {
  const section = document.createElement('div');
  section.className = 'tl-undated-section';

  const title = document.createElement('div');
  title.className   = 'tl-undated-title';
  title.textContent = 'No Due Date';
  section.appendChild(title);

  const list = document.createElement('div');
  list.className = 'tl-undated-list';
  undatedItems.forEach(item => {
    const chip = document.createElement('div');
    chip.className   = 'tl-undated-chip' + (item.obj.completed ? ' tl-completed' : '');
    chip.textContent = (item.type === 'subtask' ? '↳ ' : '') + (item.obj.text || '');
    list.appendChild(chip);
  });
  section.appendChild(list);

  return section;
}

// ── Mini date-picker calendar (add-task row) ──────────────────────────────────

function initTaskCalendar() {
  const trigger  = document.getElementById('btn-cal-trigger');
  const popup    = document.getElementById('dcal-popup');
  const daysEl   = document.getElementById('dcal-days');
  const monthSel = document.getElementById('dcal-month-sel');
  const yearSel  = document.getElementById('dcal-year-sel');
  const prevBtn  = document.getElementById('dcal-prev');
  const nextBtn  = document.getElementById('dcal-next');
  const clearBtn = document.getElementById('dcal-clear-btn');
  const badge    = document.getElementById('cal-date-badge');

  if (!trigger || !popup) return;

  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];

  const today  = new Date();
  let curYear  = today.getFullYear();
  let curMonth = today.getMonth(); // 0-based
  let selYear  = null;
  let selMonth = null; // 0-based
  let selDay   = null;

  // Populate month dropdown
  MONTHS.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = name;
    monthSel.appendChild(opt);
  });

  // Populate year dropdown (last year through 6 years out)
  for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 6; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    yearSel.appendChild(opt);
  }

  // Sync select elements to current viewed month/year
  function syncSelects() {
    monthSel.value = curMonth;
    yearSel.value  = curYear;
  }

  // Rebuild the day-grid for the currently viewed month
  function renderDays() {
    syncSelects();
    daysEl.innerHTML = '';

    const firstWeekday = new Date(curYear, curMonth, 1).getDay(); // 0=Sun
    const daysInMonth  = new Date(curYear, curMonth + 1, 0).getDate();

    // Empty offset cells before the first day of the month
    for (let i = 0; i < firstWeekday; i++) {
      const cell = document.createElement('button');
      cell.className = 'dcal-day empty';
      cell.type = 'button';
      daysEl.appendChild(cell);
    }

    // One button per calendar day
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement('button');
      cell.className = 'dcal-day';
      cell.type = 'button';
      cell.textContent = d;

      const isToday = d === today.getDate() &&
                      curMonth === today.getMonth() &&
                      curYear  === today.getFullYear();
      if (isToday) cell.classList.add('today');

      const isSel = selDay === d && selMonth === curMonth && selYear === curYear;
      if (isSel) cell.classList.add('selected');

      cell.addEventListener('click', () => {
        selDay   = d;
        selMonth = curMonth;
        selYear  = curYear;
        syncHiddenInputs();
        updateBadge();
        closePopup();
      });

      daysEl.appendChild(cell);
    }
  }

  // Write the selected date into the hidden inputs that submitAdd reads
  function syncHiddenInputs() {
    const mEl = document.getElementById('add-month');
    const dEl = document.getElementById('add-day');
    const yEl = document.getElementById('add-year');
    if (mEl) mEl.value = selDay !== null ? String(selMonth + 1) : '';
    if (dEl) dEl.value = selDay !== null ? String(selDay)       : '';
    if (yEl) yEl.value = selDay !== null ? String(selYear)      : '';
  }

  // Show or clear the date badge on the trigger button
  function updateBadge() {
    if (selDay !== null) {
      badge.textContent = MONTHS[selMonth].slice(0, 3) + ' ' + selDay;
      trigger.classList.add('has-date');
    } else {
      badge.textContent = '';
      trigger.classList.remove('has-date');
    }
  }

  function openPopup()  { popup.classList.add('open');    renderDays(); }
  function closePopup() { popup.classList.remove('open'); }

  // Toggle popup on trigger click
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.classList.contains('open') ? closePopup() : openPopup();
  });

  // Previous month
  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (--curMonth < 0) { curMonth = 11; curYear--; }
    renderDays();
  });

  // Next month
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (++curMonth > 11) { curMonth = 0; curYear++; }
    renderDays();
  });

  monthSel.addEventListener('change', (e) => { curMonth = parseInt(e.target.value); renderDays(); });
  yearSel.addEventListener('change',  (e) => { curYear  = parseInt(e.target.value); renderDays(); });

  // Clear selection
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    selDay = selMonth = selYear = null;
    syncHiddenInputs();
    updateBadge();
    closePopup();
  });

  // Close when clicking anywhere outside the picker
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('btn-cal-trigger')?.closest('.task-add-cal-wrap');
    if (wrap && !wrap.contains(e.target)) closePopup();
  });

  // Expose reset so submitAdd can clear the picker after adding a task
  window._resetTaskCalendar = () => {
    selDay = selMonth = selYear = null;
    syncHiddenInputs();
    updateBadge();
  };
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
    // Reset the calendar picker (clears hidden inputs + resets badge)
    window._resetTaskCalendar?.();
  };

  addBtn?.addEventListener('click', submitAdd);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdd(); });

  // Initialise the mini calendar date picker on the add-task row
  initTaskCalendar();

  // Undo and Order by Date buttons
  document.getElementById('btn-undo')?.addEventListener('click', undoLastAction);
  document.getElementById('btn-order-by-date')?.addEventListener('click', orderByDate);

  // Timeline button and close
  document.getElementById('btn-timeline')?.addEventListener('click', openTimeline);
  document.getElementById('btn-close-timeline')?.addEventListener('click', closeTimeline);
  document.getElementById('modal-timeline')
    ?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeTimeline(); });

  // Timeline zoom (wheel) and pan (drag) — attached once here, guarded inside handlers
  const tlWrap = document.querySelector('.timeline-scroll-wrap');
  if (tlWrap) {
    tlWrap.addEventListener('wheel', handleTlWheel, { passive: false });
    tlWrap.addEventListener('mousedown', handleTlDragStart);
  }
  document.addEventListener('mousemove', handleTlDragMove);
  document.addEventListener('mouseup',   handleTlDragEnd);

  // Delete project modal
  document.getElementById('btn-delete-project')
    ?.addEventListener('click', openProjectDeleteModal);
  document.getElementById('btn-cancel-delete-project')
    ?.addEventListener('click', closeProjectDeleteModal);
  document.getElementById('btn-confirm-delete-project')
    ?.addEventListener('click', handleDeleteProjectConfirm);
  document.getElementById('modal-delete-project')
    ?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeProjectDeleteModal(); });

  // Delete task confirmation modal
  document.getElementById('btn-cancel-delete-task')
    ?.addEventListener('click', () => document.getElementById('modal-delete-task').classList.remove('open'));
  document.getElementById('btn-confirm-delete-task')
    ?.addEventListener('click', (e) => {
      const taskId = e.currentTarget.dataset.pendingId;
      document.getElementById('modal-delete-task').classList.remove('open');
      if (taskId) deleteTask(taskId);
    });
  document.getElementById('modal-delete-task')
    ?.addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });
});

