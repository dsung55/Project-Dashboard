// tasks.js — Global (miscellaneous) tasks page logic
// Handles: add, edit (dbl-click), delete, complete/uncomplete, archive/unarchive,
//          drag-to-reorder, pop-in animation

// ── State ─────────────────────────────────────────────────────────────────────
let tasks = [];                 // full array of task objects { id, text, completed, archived, createdAt }
let savePending      = false;   // debounce guard for save calls
let archivedExpanded = false;   // whether the "Archived (n)" section is open

// Drag state
let draggedId      = null;  // id of the task being dragged
let dropTargetEl   = null;  // <li> element being hovered
let dropInsertAbove = true; // true = insert above target, false = below

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    tasks = await api.getTasks();
    renderList(/* animate */ true);
  } catch (err) {
    showToast('Could not load tasks: ' + err.message, true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();

  // Add task on button click or Enter key in the input
  document.getElementById('tasks-add-btn')
    .addEventListener('click', handleAdd);
  document.getElementById('tasks-add-input')
    .addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAdd(); });
});

// ── Render ────────────────────────────────────────────────────────────────────

// Rebuild the entire list; animate=true triggers the pop-in stagger on each item
function renderList(animate) {
  const list = document.getElementById('tasks-list');
  if (!list) return;
  list.innerHTML = '';

  if (tasks.length === 0) {
    list.innerHTML = '<li class="tasks-empty">No tasks yet.<br>Add one above to get started.</li>';
    return;
  }

  // Partition: archived tasks live in their own collapsible section at the bottom
  const archived  = tasks.filter(t =>  t.archived);
  const visible   = tasks.filter(t => !t.archived);
  const active    = visible.filter(t => !t.completed);
  const completed = visible.filter(t =>  t.completed);

  // Precompute all delays in one O(n) pass instead of O(n²) per-item calls
  const delays = animate ? buildCumulativeDelays(active.length + completed.length) : null;

  active.forEach((task, index) => {
    const item = buildItem(task);
    if (animate) {
      item.style.animationName  = 'task-pop-in';
      item.style.animationDelay = delays[index] + 'ms';
    }
    list.appendChild(item);
  });

  // Separator between active and completed
  if (active.length > 0 && completed.length > 0) {
    const hr = document.createElement('hr');
    hr.className = 'gt-completed-divider';
    list.appendChild(hr);
  }

  completed.forEach((task, index) => {
    const item = buildItem(task);
    if (animate) {
      item.style.animationName  = 'task-pop-in';
      item.style.animationDelay = delays[active.length + index] + 'ms';
    }
    list.appendChild(item);
  });

  // Archived section — only present when at least one task is archived
  if (archived.length > 0) {
    list.appendChild(buildArchiveToggle(archived.length));
    if (archivedExpanded) {
      archived.forEach(task => list.appendChild(buildArchivedItem(task)));
    }
  }

  initDragAndDrop();
}

// Build an array of cumulative animation delays for `count` items in a single O(n) pass
// Returns delays[i] = ms before item i should appear; avoids the O(n²) cost of per-item loops
function buildCumulativeDelays(count) {
  const delays = new Array(count);
  let total = 0;
  for (let i = 0; i < count; i++) {
    delays[i] = total;
    total += Math.max(10, Math.round(120 * Math.pow(0.82, i)));
  }
  return delays;
}

// Build and return a single task <li> element
function buildItem(task) {
  const li = document.createElement('li');
  li.className  = 'gt-item' + (task.completed ? ' gt-done' : '');
  li.dataset.id = task.id;
  li.setAttribute('draggable', 'true');

  // Archive button is only offered for completed tasks — its purpose is to tuck
  // finished work away rather than to park active items
  const archiveBtnHtml = task.completed
    ? `<button class="gt-icon-btn gt-archive-btn" data-id="${task.id}" title="Archive task">
         <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <rect x="2.5" y="4" width="19" height="5" rx="1"></rect>
           <path d="M4.5 9v10.5h15V9"></path>
           <path d="M10 13h4"></path>
         </svg>
       </button>`
    : '';

  li.innerHTML = `
    <span class="gt-drag-handle" title="Drag to reorder">⠿</span>
    <div class="gt-checkbox${task.completed ? ' checked' : ''}" data-id="${task.id}" title="${task.completed ? 'Mark incomplete' : 'Mark complete'}"></div>
    <span class="gt-text" title="Double-click to edit">${escapeHtml(task.text)}</span>
    ${archiveBtnHtml}
    <button class="gt-delete-btn" data-id="${task.id}" title="Delete task">&#x2715;</button>
  `;

  // Checkbox toggles completion
  li.querySelector('.gt-checkbox').addEventListener('click', () => toggleComplete(task.id));

  // Archive button (only present for completed tasks)
  const archiveBtn = li.querySelector('.gt-archive-btn');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      archiveTask(task.id);
    });
  }

  // Delete button removes the task
  li.querySelector('.gt-delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task.id);
  });

  // Double-click the text to edit it inline
  const textSpan = li.querySelector('.gt-text');
  textSpan.addEventListener('dblclick', () => startEdit(task, textSpan, li));

  return li;
}

// Build the "Archived (n)" toggle row that opens/closes the archived section
function buildArchiveToggle(count) {
  const li = document.createElement('li');
  li.className = 'gt-archive-toggle' + (archivedExpanded ? ' expanded' : '');
  li.innerHTML = `
    <span class="gt-archive-caret">&#x25B8;</span>
    <span class="gt-archive-toggle-label">Archived (${count})</span>
  `;
  li.addEventListener('click', () => {
    archivedExpanded = !archivedExpanded;
    renderList(false);
  });
  return li;
}

// Build a row inside the archived section — restore + delete only, no drag/checkbox
function buildArchivedItem(task) {
  const li = document.createElement('li');
  li.className = 'gt-archived-item' + (task.completed ? ' gt-done' : '');
  li.dataset.id = task.id;

  li.innerHTML = `
    <span class="gt-text">${escapeHtml(task.text)}</span>
    <button class="gt-icon-btn gt-unarchive-btn" data-id="${task.id}" title="Restore from archive">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7h18v14H3z"></path>
        <path d="M12 18v-7"></path>
        <path d="M9 14l3-3 3 3"></path>
      </svg>
    </button>
    <button class="gt-delete-btn" data-id="${task.id}" title="Delete task">&#x2715;</button>
  `;

  li.querySelector('.gt-unarchive-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    unarchiveTask(task.id);
  });
  li.querySelector('.gt-delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task.id);
  });

  return li;
}

// ── Inline edit ───────────────────────────────────────────────────────────────

// Replace the text span with an input; commit on Enter/blur, cancel on Escape.
// Empty-after-trim values are treated as a cancel so a task is never silently emptied.
function startEdit(task, textSpan, li) {
  if (li.querySelector('.gt-edit-input')) return; // already editing

  const input = document.createElement('input');
  input.type      = 'text';
  input.className = 'gt-edit-input';
  input.value     = task.text;

  // Disable drag while editing so a click-drag inside the input doesn't pick the row up
  li.setAttribute('draggable', 'false');
  textSpan.replaceWith(input);
  input.focus();
  input.select();

  let done = false;

  const commit = () => {
    if (done) return;
    done = true;
    const newText = input.value.trim();
    if (newText && newText !== task.text) {
      task.text = newText;
      debounceSave();
    }
    renderList(false);
  };

  const cancel = () => {
    if (done) return;
    done = true;
    renderList(false);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')       { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

// ── Add task ──────────────────────────────────────────────────────────────────

function handleAdd() {
  const input = document.getElementById('tasks-add-input');
  const text  = input.value.trim();
  if (!text) return;

  const task = {
    id:        crypto.randomUUID(),
    text,
    completed: false,
    archived:  false,
    createdAt: new Date().toISOString()
  };

  tasks.push(task);
  input.value = '';

  // Re-render without stagger animation, then animate just the new item
  renderList(false);
  const newEl = document.querySelector(`.gt-item[data-id="${task.id}"]`);
  if (newEl) {
    newEl.style.animationName  = 'task-pop-in';
    newEl.style.animationDelay = '0ms';
  }

  debounceSave();
}

// ── Toggle complete ───────────────────────────────────────────────────────────

function toggleComplete(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  renderList(false);
  debounceSave();
}

// ── Archive / unarchive ───────────────────────────────────────────────────────

function archiveTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.archived = true;
  renderList(false);
  debounceSave();
}

function unarchiveTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.archived = false;
  renderList(false);
  debounceSave();
}

// ── Delete task ───────────────────────────────────────────────────────────────

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  renderList(false);
  debounceSave();
}

// ── Save ──────────────────────────────────────────────────────────────────────

// Debounce saves so rapid interactions don't flood the server
function debounceSave() {
  if (savePending) return;
  savePending = true;
  setTimeout(async () => {
    savePending = false;
    try {
      await api.saveTasks(tasks);
    } catch (err) {
      showToast('Could not save tasks: ' + err.message, true);
    }
  }, 400);
}

// ── Drag and drop ─────────────────────────────────────────────────────────────

// Wire drag events onto active/completed task items only — archived rows and the
// archive-toggle row must not participate in reordering
function initDragAndDrop() {
  document.querySelectorAll('.gt-item').forEach(item => {
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend',   handleDragEnd);
    item.addEventListener('dragover',  handleDragOver);
    item.addEventListener('dragleave', handleDragLeave);
    item.addEventListener('drop',      handleDrop);
  });
}

function handleDragStart(e) {
  draggedId = this.dataset.id;
  this.classList.add('gt-dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd() {
  draggedId = null;
  clearDragStyles();
}

function handleDragOver(e) {
  e.preventDefault();
  if (!draggedId || this.dataset.id === draggedId) return;
  e.dataTransfer.dropEffect = 'move';

  const rect   = this.getBoundingClientRect();
  const isAbove = e.clientY < rect.top + rect.height / 2;

  clearDragIndicators();
  this.classList.add(isAbove ? 'drop-above' : 'drop-below');
  dropTargetEl    = this;
  dropInsertAbove = isAbove;
}

function handleDragLeave(e) {
  if (!this.contains(e.relatedTarget)) {
    this.classList.remove('drop-above', 'drop-below');
    if (dropTargetEl === this) dropTargetEl = null;
  }
}

function handleDrop(e) {
  e.preventDefault();
  if (!draggedId || !dropTargetEl) return;

  const fromIdx  = tasks.findIndex(t => t.id === draggedId);
  const targetId = dropTargetEl.dataset.id;
  const toIdx    = tasks.findIndex(t => t.id === targetId);

  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

  // Splice the dragged task out and re-insert at the target position
  const [moved] = tasks.splice(fromIdx, 1);
  const newToIdx = tasks.findIndex(t => t.id === targetId);
  tasks.splice(dropInsertAbove ? newToIdx : newToIdx + 1, 0, moved);

  clearDragStyles();
  renderList(false);
  debounceSave();
}

// ── Drag helpers ──────────────────────────────────────────────────────────────

function clearDragIndicators() {
  document.querySelectorAll('.gt-item.drop-above, .gt-item.drop-below')
    .forEach(el => el.classList.remove('drop-above', 'drop-below'));
}

function clearDragStyles() {
  document.querySelectorAll('.gt-item.gt-dragging')
    .forEach(el => el.classList.remove('gt-dragging'));
  clearDragIndicators();
  dropTargetEl = null;
}
