// tasks.js — Global (miscellaneous) tasks page logic
// Handles: add, delete, complete/uncomplete, drag-to-reorder, pop-in animation

// ── State ─────────────────────────────────────────────────────────────────────
let tasks = [];          // full array of task objects { id, text, completed, createdAt }
let savePending = false; // debounce guard for save calls

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

  // Split into active and completed; keep original order within each group
  const active    = tasks.filter(t => !t.completed);
  const completed = tasks.filter(t =>  t.completed);

  active.forEach((task, index) => {
    const item = buildItem(task);
    if (animate) {
      const offsetMs = calculateCumulativeDelay(index);
      item.style.animationName  = 'task-pop-in';
      item.style.animationDelay = offsetMs + 'ms';
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
      const offsetMs = calculateCumulativeDelay(active.length + index);
      item.style.animationName  = 'task-pop-in';
      item.style.animationDelay = offsetMs + 'ms';
    }
    list.appendChild(item);
  });

  initDragAndDrop();
}

// Compute the start time for item at a given index by summing up prior item delays
// Starts slow (120ms first slot) and accelerates rapidly — minimum slot 10ms
function calculateCumulativeDelay(index) {
  let total = 0;
  for (let i = 0; i < index; i++) {
    // Each slot shrinks by 62% — steep curve so later items blur together
    total += Math.max(10, Math.round(120 * Math.pow(0.62, i)));
  }
  return total;
}

// Build and return a single task <li> element
function buildItem(task) {
  const li = document.createElement('li');
  li.className  = 'gt-item' + (task.completed ? ' gt-done' : '');
  li.dataset.id = task.id;
  li.setAttribute('draggable', 'true');

  li.innerHTML = `
    <span class="gt-drag-handle" title="Drag to reorder">⠿</span>
    <div class="gt-checkbox${task.completed ? ' checked' : ''}" data-id="${task.id}" title="${task.completed ? 'Mark incomplete' : 'Mark complete'}"></div>
    <span class="gt-text">${escapeHtml(task.text)}</span>
    <button class="gt-delete-btn" data-id="${task.id}" title="Delete task">&#x2715;</button>
  `;

  // Checkbox toggles completion
  li.querySelector('.gt-checkbox').addEventListener('click', () => toggleComplete(task.id));

  // Delete button removes the task
  li.querySelector('.gt-delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task.id);
  });

  return li;
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

// Wire drag events onto all rendered task items
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
  document.querySelectorAll('.task-item.drop-above, .task-item.drop-below')
    .forEach(el => el.classList.remove('drop-above', 'drop-below'));
}

function clearDragStyles() {
  document.querySelectorAll('.gt-item.gt-dragging')
    .forEach(el => el.classList.remove('gt-dragging'));
  clearDragIndicators();
  dropTargetEl = null;
}
