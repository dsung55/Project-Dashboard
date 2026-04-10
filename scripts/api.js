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
  saveConfig
};
