// api.js — All fetch() calls to the local server.
// Every other script imports from window.api — this is the only file allowed to use fetch().

// Show a toast notification (auto-dismisses after 3 seconds)
function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' toast-error' : '');
  toast.textContent = message;
  container.appendChild(toast);

  // Remove the toast element after animation completes
  setTimeout(() => toast.remove(), 3100);
}

// Make window.showToast available globally
window.showToast = showToast;

// Escape HTML special characters to prevent XSS (shared by all pages)
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Make window.escapeHtml available globally
window.escapeHtml = escapeHtml;

// ── API methods ───────────────────────────────────────────────────────────────

// Return all projects from the index
async function getProjects() {
  const res = await fetch('/api/projects', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load projects');
  return res.json();
}

// Create a new project with the given data object
async function createProject(data) {
  const res = await fetch('/api/projects', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create project');
  }
  return res.json();
}

// Delete a project by id
async function deleteProject(id) {
  const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete project');
  return res.json();
}

// Return the full data for a single project
async function getProject(id) {
  const res = await fetch(`/api/projects/${id}`);
  if (!res.ok) throw new Error('Project not found');
  return res.json();
}

// Save full project data (PUT replaces the entire project)
async function saveProject(id, data) {
  const res = await fetch(`/api/projects/${id}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to save project');
  return res.json();
}

// Upload a file to a project (multipart/form-data)
async function uploadFile(id, file) {
  const form = new FormData();
  form.append('file', file);
  // No Content-Type header — browser sets it with the correct multipart boundary
  const res = await fetch(`/api/projects/${id}/files`, {
    method: 'POST',
    body:   form
  });
  if (!res.ok) throw new Error('Failed to upload file');
  return res.json();
}

// Return the URL for downloading a project file
function getFileUrl(id, filename) {
  return `/api/projects/${id}/files/${encodeURIComponent(filename)}`;
}

// Reorder the project index by sending an ordered array of project ids
async function reorderProjects(ids) {
  const res = await fetch('/api/projects/reorder', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ids })
  });
  if (!res.ok) throw new Error('Failed to reorder projects');
  return res.json();
}

// Return global config (phase list, etc.)
async function getConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('Failed to load config');
  return res.json();
}

// Save global config
async function saveConfig(data) {
  const res = await fetch('/api/config', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to save config');
  return res.json();
}

// Return all global (miscellaneous) tasks
async function getTasks() {
  const res = await fetch('/api/tasks', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load tasks');
  return res.json();
}

// Save the full global tasks list (replaces all)
async function saveTasks(tasks) {
  const res = await fetch('/api/tasks', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(tasks)
  });
  if (!res.ok) throw new Error('Failed to save tasks');
  return res.json();
}

// ── Background image API ───────────────────────────────────────────────────────

// Upload the global background image (accepts File or Blob)
async function uploadGlobalBackground(file) {
  const form = new FormData();
  // Provide a filename so multer can detect the extension; use .jpg for resized blobs
  const name = file instanceof File ? file.name : 'background.jpg';
  form.append('image', file, name);
  const res = await fetch('/api/backgrounds/global', { method: 'POST', body: form });
  if (!res.ok) {
    let msg = 'Failed to upload background';
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Remove the global background image from server and localStorage
async function removeGlobalBackground() {
  const res = await fetch('/api/backgrounds/global', { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to remove background');
  localStorage.removeItem('dashboardGlobalBg');
  applyGlobalBackground();
  return res.json();
}

// Upload a per-project background image (accepts File or Blob)
async function uploadProjectBackground(id, file) {
  const form = new FormData();
  const name = file instanceof File ? file.name : 'background.jpg';
  form.append('image', file, name);
  const res = await fetch(`/api/projects/${id}/background`, { method: 'POST', body: form });
  if (!res.ok) {
    let msg = 'Failed to upload project background';
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Remove a per-project background image
async function removeProjectBackground(id) {
  const res = await fetch(`/api/projects/${id}/background`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to remove project background');
  localStorage.removeItem('dashboardProjectBg_' + id);
  return res.json();
}

// ── Background application ────────────────────────────────────────────────────

// Apply (or clear) the global background from localStorage on any page
function applyGlobalBackground() {
  const bg = localStorage.getItem('dashboardGlobalBg');
  if (bg) {
    document.documentElement.style.setProperty('--page-bg-image', `url('${bg}')`);
    document.documentElement.classList.add('has-bg');
  } else {
    document.documentElement.style.removeProperty('--page-bg-image');
    document.documentElement.classList.remove('has-bg');
  }
}

// Apply a project-specific background (overrides global on the project page)
function applyProjectBackground(projectId) {
  const bg = localStorage.getItem('dashboardProjectBg_' + projectId);
  if (bg) {
    document.documentElement.style.setProperty('--page-bg-image', `url('${bg}')`);
    document.documentElement.classList.add('has-bg');
  }
}

// Auto-apply the global background on every page load
document.addEventListener('DOMContentLoaded', applyGlobalBackground);

// Expose all API functions on the global window.api object
window.api = {
  getProjects,
  createProject,
  deleteProject,
  getProject,
  saveProject,
  reorderProjects,
  uploadFile,
  getFileUrl,
  getConfig,
  saveConfig,
  getTasks,
  saveTasks,
  uploadGlobalBackground,
  removeGlobalBackground,
  uploadProjectBackground,
  removeProjectBackground,
  applyGlobalBackground,
  applyProjectBackground
};
