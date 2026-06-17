// tasks.js — Global (miscellaneous) tasks page logic
// Handles: add, edit (dbl-click), delete, complete/uncomplete, archive/unarchive,
//          move-to-project, grouping, drag-to-reorder, pop-in animation

// ── State ─────────────────────────────────────────────────────────────────────
let tasks = [];                 // full array of task objects { id, text, completed, archived, createdAt, groupId, groupName }
let savePending      = false;   // debounce guard for save calls
let archivedExpanded = false;   // whether the "Archived (n)" section is open

// Drag state
let draggedId      = null;  // id of the task being dragged
let dropTargetEl   = null;  // <li> element being hovered
let dropInsertAbove = true; // true = insert above target, false = below

// Selection / grouping state
let selectionMode = false;            // whether the user is picking tasks to group
let selectedIds   = new Set();        // ids of tasks currently selected for grouping

// Move-to-project state
let pendingMoveId = null;             // id of the task awaiting a destination project

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

  // Grouping: enter selection mode, then create or cancel
  document.getElementById('tasks-group-btn')
    .addEventListener('click', enterSelectionMode);
  document.getElementById('tasks-selection-cancel')
    .addEventListener('click', exitSelectionMode);
  document.getElementById('tasks-selection-create')
    .addEventListener('click', openGroupModal);

  // Group-name modal
  document.getElementById('btn-cancel-group')
    .addEventListener('click', closeGroupModal);
  document.getElementById('btn-confirm-group')
    .addEventListener('click', confirmCreateGroup);
  document.getElementById('group-name-input')
    .addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmCreateGroup(); });

  // Move-to-project modal
  document.getElementById('btn-cancel-move')
    .addEventListener('click', closeMoveModal);
  document.getElementById('btn-confirm-move')
    .addEventListener('click', confirmMove);
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

  // Precompute all delays in one O(n) pass instead of O(n²) per-item calls.
  // A single running index is incremented as each row is built so that grouped
  // rows (which render inside a wrapper) still stagger in document order.
  const delays = animate ? buildCumulativeDelays(active.length + completed.length) : null;
  const anim   = { delays, index: 0 };

  // Active tasks — cluster grouped tasks into a translucent box at the position
  // of the group's first member; ungrouped tasks render inline.
  const placed = new Set();
  active.forEach(task => {
    if (placed.has(task.id)) return;
    if (task.groupId) {
      const members = active.filter(t => t.groupId === task.groupId);
      members.forEach(m => placed.add(m.id));
      list.appendChild(buildGroup(task.groupId, task.groupName, members, animate, anim));
    } else {
      placed.add(task.id);
      list.appendChild(buildItem(task, animate, anim));
    }
  });

  // Separator between active and completed
  if (active.length > 0 && completed.length > 0) {
    const hr = document.createElement('hr');
    hr.className = 'gt-completed-divider';
    list.appendChild(hr);
  }

  // Completed tasks render flat (grouping is only an active-task affordance)
  completed.forEach(task => {
    list.appendChild(buildItem(task, animate, anim));
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

// Build and return a single task <li> element.
// animate + anim (a { delays, index } counter) drive the staggered pop-in.
function buildItem(task, animate, anim) {
  const li = document.createElement('li');
  li.className  = 'gt-item' + (task.completed ? ' gt-done' : '');
  li.dataset.id = task.id;

  // In selection mode, active tasks become pickable rows — no drag, no inline
  // controls; clicking anywhere on the row toggles its selection.
  const selectable = selectionMode && !task.completed;
  if (selectable) {
    if (selectedIds.has(task.id)) li.classList.add('gt-selected');
    li.setAttribute('draggable', 'false');
    li.innerHTML = `
      <div class="gt-select-box${selectedIds.has(task.id) ? ' checked' : ''}"></div>
      <span class="gt-text">${escapeHtml(task.text)}</span>
    `;
    li.addEventListener('click', () => toggleSelect(task.id));
    applyPopIn(li, animate, anim);
    return li;
  }

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

  // Move button is only offered for active tasks — it relocates the task into a
  // chosen project's task list
  const moveBtnHtml = !task.completed
    ? `<button class="gt-icon-btn gt-move-btn" data-id="${task.id}" title="Move to a project">
         <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3z"></path>
           <path d="M13 13h5"></path>
           <path d="M16 11l2 2-2 2"></path>
         </svg>
       </button>`
    : '';

  li.innerHTML = `
    <span class="gt-drag-handle" title="Drag to reorder">⠿</span>
    <div class="gt-checkbox${task.completed ? ' checked' : ''}" data-id="${task.id}" title="${task.completed ? 'Mark incomplete' : 'Mark complete'}"></div>
    <span class="gt-text" title="Double-click to edit">${escapeHtml(task.text)}</span>
    ${moveBtnHtml}
    ${archiveBtnHtml}
    <button class="gt-delete-btn" data-id="${task.id}" title="Delete task">&#x2715;</button>
  `;

  // Checkbox toggles completion
  li.querySelector('.gt-checkbox').addEventListener('click', () => toggleComplete(task.id));

  // Move button (only present for active tasks) opens the project picker
  const moveBtn = li.querySelector('.gt-move-btn');
  if (moveBtn) {
    moveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMoveModal(task.id);
    });
  }

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

  applyPopIn(li, animate, anim);
  return li;
}

// Apply the staggered pop-in animation to a row and advance the shared counter
function applyPopIn(el, animate, anim) {
  if (!animate || !anim) return;
  el.style.animationName  = 'task-pop-in';
  el.style.animationDelay = anim.delays[anim.index] + 'ms';
  anim.index++;
}

// Build a translucent group box wrapping all active tasks that share a groupId
function buildGroup(groupId, groupName, members, animate, anim) {
  const wrap = document.createElement('li');
  wrap.className = 'gt-group';
  wrap.dataset.groupId = groupId;

  const header = document.createElement('div');
  header.className = 'gt-group-header';
  header.innerHTML = `
    <span class="gt-group-name">${escapeHtml(groupName || 'Group')}</span>
    <button class="gt-ungroup-btn" title="Ungroup">Ungroup</button>
  `;
  header.querySelector('.gt-ungroup-btn').addEventListener('click', () => ungroup(groupId));
  wrap.appendChild(header);

  const ul = document.createElement('ul');
  ul.className = 'gt-group-items';
  members.forEach(m => ul.appendChild(buildItem(m, animate, anim)));
  wrap.appendChild(ul);

  return wrap;
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

  // New tasks land at the top of the list so the most recent is seen first
  tasks.unshift(task);
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

// ── Grouping ──────────────────────────────────────────────────────────────────

// Enter selection mode: active tasks become pickable so the user can group them
function enterSelectionMode() {
  selectionMode = true;
  selectedIds.clear();
  document.getElementById('tasks-toolbar').setAttribute('hidden', '');
  document.getElementById('tasks-selection-bar').removeAttribute('hidden');
  updateSelectionBar();
  renderList(false);
}

// Leave selection mode without creating a group
function exitSelectionMode() {
  selectionMode = false;
  selectedIds.clear();
  document.getElementById('tasks-selection-bar').setAttribute('hidden', '');
  document.getElementById('tasks-toolbar').removeAttribute('hidden');
  renderList(false);
}

// Toggle whether a task is part of the pending selection
function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else                     selectedIds.add(id);
  updateSelectionBar();
  renderList(false);
}

// Reflect the current selection count; the create button needs at least 2 tasks
function updateSelectionBar() {
  const count = selectedIds.size;
  document.getElementById('tasks-selection-count').textContent =
    count === 1 ? '1 selected' : `${count} selected`;
  document.getElementById('tasks-selection-create').disabled = count < 2;
}

// Open the modal that asks for the new group's name
function openGroupModal() {
  if (selectedIds.size < 2) return;
  const input = document.getElementById('group-name-input');
  input.value = '';
  document.getElementById('modal-group').classList.add('open');
  input.focus();
}

// Close the group-name modal without creating a group
function closeGroupModal() {
  document.getElementById('modal-group').classList.remove('open');
}

// Assign a shared groupId + name to every selected task, then exit selection mode
function confirmCreateGroup() {
  const name = document.getElementById('group-name-input').value.trim();
  if (!name) { showToast('Please enter a group name', true); return; }
  if (selectedIds.size < 2) return;

  const groupId = crypto.randomUUID();
  const count   = selectedIds.size;
  tasks.forEach(t => {
    if (selectedIds.has(t.id)) {
      t.groupId   = groupId;
      t.groupName = name;
    }
  });

  closeGroupModal();
  exitSelectionMode();      // also re-renders (clears selectedIds)
  debounceSave();
  showToast(`Grouped ${count} tasks into "${name}"`);
}

// Remove the group assignment from every task in the given group
function ungroup(groupId) {
  tasks.forEach(t => {
    if (t.groupId === groupId) {
      t.groupId   = null;
      t.groupName = null;
    }
  });
  renderList(false);
  debounceSave();
}

// ── Move to project ───────────────────────────────────────────────────────────

// Open the project picker for a given task; bail with a toast if no projects exist
async function openMoveModal(id) {
  let projects = [];
  try {
    projects = await api.getProjects();
  } catch (err) {
    showToast('Could not load projects: ' + err.message, true);
    return;
  }
  if (!projects.length) {
    showToast('No projects yet — create one first', true);
    return;
  }

  pendingMoveId = id;
  const select = document.getElementById('move-project-select');
  select.innerHTML = projects
    .map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join('');
  document.getElementById('modal-move').classList.add('open');
}

// Close the move modal and clear the pending task
function closeMoveModal() {
  document.getElementById('modal-move').classList.remove('open');
  pendingMoveId = null;
}

// Move the pending task into the chosen project as a new project task, then
// remove it from the global list
async function confirmMove() {
  const select    = document.getElementById('move-project-select');
  const projectId = select.value;
  const task      = tasks.find(t => t.id === pendingMoveId);
  if (!task || !projectId) { closeMoveModal(); return; }

  try {
    const project = await api.getProject(projectId);
    project.tasks = project.tasks || [];
    // Match the project-task shape used by project.js addTask
    project.tasks.push({
      id:          crypto.randomUUID(),
      text:        task.text,
      completed:   false,
      completedAt: null,
      notes:       '',
      subItems:    [],
      dueDate:     null
    });
    await api.saveProject(projectId, project);

    tasks = tasks.filter(t => t.id !== pendingMoveId);
    closeMoveModal();
    renderList(false);
    debounceSave();
    showToast(`Moved to "${project.name}"`);
  } catch (err) {
    showToast('Could not move task: ' + err.message, true);
  }
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

  // Snapshot positions BEFORE the DOM changes so we can FLIP-animate them
  const list       = document.getElementById('tasks-list');
  const allEls     = [...list.querySelectorAll('.gt-item')];
  const beforeRects = new Map(allEls.map(el => [el.dataset.id, el.getBoundingClientRect()]));
  const movedId    = draggedId;

  // Splice the dragged task out and re-insert at the target position
  const [moved] = tasks.splice(fromIdx, 1);
  const newToIdx = tasks.findIndex(t => t.id === targetId);
  tasks.splice(dropInsertAbove ? newToIdx : newToIdx + 1, 0, moved);

  clearDragStyles();
  renderList(false);

  // FLIP: animate each row from its old position to its new position
  const newEls = [...list.querySelectorAll('.gt-item')];
  newEls.forEach(el => {
    const before = beforeRects.get(el.dataset.id);
    if (!before) return;
    const after = el.getBoundingClientRect();
    const dy    = before.top - after.top;

    if (el.dataset.id === movedId) {
      // Dropped item: bubble-in spring
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = 'card-bubble 300ms cubic-bezier(0.34, 1.4, 0.64, 1) both';
    } else if (Math.abs(dy) >= 0.5) {
      // Neighboring items that shifted: slide to their new spot
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
