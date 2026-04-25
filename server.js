// Dashboard v1.0 — Express server (file I/O only)
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = 3000;

// ── Path constants ────────────────────────────────────────────────────────────
// When running inside Electron, DATA_DIR is set to app.getPath('userData')/data
// so data survives in a writable OS folder rather than next to the packaged exe.
const DATA_DIR        = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROJECTS_DIR    = path.join(DATA_DIR, 'projects');
const PROJECTS_IDX    = path.join(DATA_DIR, 'projects.json');
const CONFIG_FILE     = path.join(DATA_DIR, 'config.json');
const TASKS_FILE      = path.join(DATA_DIR, 'tasks.json');
const BACKGROUNDS_DIR = path.join(DATA_DIR, 'backgrounds');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Read and parse a JSON file; returns defaultValue if file is missing or corrupt
function readJSON(filePath, defaultValue = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

// Write data to a JSON file with pretty-printing
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Create per-project directory structure (idempotent)
function ensureProjectDir(id) {
  fs.mkdirSync(path.join(PROJECTS_DIR, id, 'files'), { recursive: true });
}

// Compute project status from its tasks and phase (server-side — never trust client)
function computeStatus(project) {
  const phase = (project.phase || '').toLowerCase();
  if (phase === 'completed') return 'completed';
  const tasks = project.tasks || [];
  const done = tasks.filter(t => t.completed).length;
  if (done > 0) return 'ongoing';
  // Phases that signal active work — treat as in-progress even with no completed tasks
  if (phase === 'in progress') return 'ongoing';
  return 'not-started';
}

// Build the lightweight index entry for projects.json from a full project object
function toIndexEntry(project) {
  const tasks       = project.tasks || [];
  const completed   = tasks.filter(t => t.completed).length;
  const currentTask = tasks.find(t => !t.completed)?.text || null;
  return {
    id:                 project.id,
    name:               project.name,
    color:              project.color,
    phase:              project.phase,
    version:            project.version,
    status:             project.status,
    purpose:            project.purpose || '',
    currentTask:        currentTask,
    taskCount:          tasks.length,
    completedTaskCount: completed,
    createdAt:          project.createdAt
  };
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));  // serves HTML/CSS/JS files

// ── Multer — file upload config ───────────────────────────────────────────────
const storage = multer.diskStorage({
  // Save files into the project's /files/ subdirectory
  destination(req, _file, cb) {
    const dest = path.join(PROJECTS_DIR, req.params.id, 'files');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  // Keep the original filename
  filename(_req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

// Multer for global background — saved as backgrounds/global.<ext>
const bgStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    try { fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true }); } catch (e) { return cb(e); }
    cb(null, BACKGROUNDS_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, 'global' + ext);
  }
});
const bgUpload = multer({ storage: bgStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// Multer for per-project background — saved as projects/<id>/background.<ext>
const projBgStorage = multer.diskStorage({
  destination(req, _file, cb) {
    const dest = path.join(PROJECTS_DIR, req.params.id);
    try { fs.mkdirSync(dest, { recursive: true }); } catch (e) { return cb(e); }
    cb(null, dest);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, 'background' + ext);
  }
});
const projBgUpload = multer({ storage: projBgStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/projects — return all projects from the index, with currentTask computed live from each project file
app.get('/api/projects', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');  // always serve fresh data — never let the browser cache the project list
  const index = readJSON(PROJECTS_IDX, []);
  // Re-derive currentTask directly from each project file so it is always in sync,
  // regardless of any index staleness (e.g. from bfcache / mid-flight saves).
  const projects = index.map(entry => {
    const projPath = path.join(PROJECTS_DIR, entry.id, 'project.json');
    const project  = readJSON(projPath);
    if (!project) return entry;
    const tasks       = project.tasks || [];
    const currentTask = tasks.find(t => !t.completed)?.text || null;
    return { ...entry, currentTask, purpose: project.purpose || '' };
  });
  res.json(projects);
});

// POST /api/projects — create a new project
app.post('/api/projects', (req, res) => {
  const { id, name, color, phase, version } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name are required' });

  ensureProjectDir(id);

  const now     = new Date().toISOString();
  const project = {
    id,
    name,
    color:   color   || '#4A90D9',
    phase:   phase   || 'Planning',
    version: version || 'v1.0',
    status:  'not-started',  // overwritten by computeStatus below
    notes:   '',
    purpose: '',
    createdAt: now,
    tasks:   [],
    files:   []
  };

  // Compute the correct initial status based on the chosen phase
  project.status = computeStatus(project);

  writeJSON(path.join(PROJECTS_DIR, id, 'project.json'), project);

  const index = readJSON(PROJECTS_IDX, []);
  index.push(toIndexEntry(project));
  writeJSON(PROJECTS_IDX, index);

  res.status(201).json(project);
});

// DELETE /api/projects/:id — delete project and its data folder
app.delete('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  const index  = readJSON(PROJECTS_IDX, []);
  const updated = index.filter(p => p.id !== id);

  if (updated.length === index.length) {
    return res.status(404).json({ error: 'Project not found' });
  }

  writeJSON(PROJECTS_IDX, updated);
  fs.rmSync(path.join(PROJECTS_DIR, id), { recursive: true, force: true });

  res.json({ ok: true });
});

// GET /api/projects/:id — return full project data
app.get('/api/projects/:id', (req, res) => {
  const filePath = path.join(PROJECTS_DIR, req.params.id, 'project.json');
  const project  = readJSON(filePath);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// PUT /api/projects/reorder — reorder the projects index given an array of ids
// Must be declared BEFORE /api/projects/:id so Express doesn't treat "reorder" as an id
app.put('/api/projects/reorder', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  const index   = readJSON(PROJECTS_IDX, []);
  const byId    = Object.fromEntries(index.map(p => [p.id, p]));
  // Put entries in the requested order; append any that weren't in ids (safety net)
  const ordered = ids.map(id => byId[id]).filter(Boolean);
  const rest    = index.filter(p => !ids.includes(p.id));
  writeJSON(PROJECTS_IDX, [...ordered, ...rest]);
  res.json({ ok: true });
});

// PUT /api/projects/:id — save full project data, recompute status
app.put('/api/projects/:id', (req, res) => {
  const { id }   = req.params;
  const filePath = path.join(PROJECTS_DIR, id, 'project.json');

  const existing = readJSON(filePath);
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  // Merge incoming data, then recompute status server-side
  const project  = { ...existing, ...req.body, id };
  project.status = computeStatus(project);

  writeJSON(filePath, project);

  // Sync the lightweight index entry
  const index   = readJSON(PROJECTS_IDX, []);
  const idx     = index.findIndex(p => p.id === id);
  const entry   = toIndexEntry(project);
  if (idx >= 0) index[idx] = entry; else index.push(entry);
  writeJSON(PROJECTS_IDX, index);

  res.json(project);
});

// POST /api/projects/:id/files — upload a file
app.post('/api/projects/:id/files', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { id }   = req.params;
  const filePath = path.join(PROJECTS_DIR, id, 'project.json');
  const project  = readJSON(filePath);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Add filename to project.files if not already present
  if (!project.files.includes(req.file.originalname)) {
    project.files.push(req.file.originalname);
    writeJSON(filePath, project);
  }

  res.json({ filename: req.file.originalname });
});

// GET /api/projects/:id/files/:filename — download/serve a file
app.get('/api/projects/:id/files/:filename', (req, res) => {
  const filePath = path.join(PROJECTS_DIR, req.params.id, 'files', req.params.filename);
  res.sendFile(filePath);  // sendFile requires an absolute path — path.join(__dirname,...) gives us that
});

// GET /api/config — return global config
app.get('/api/config', (_req, res) => {
  const config = readJSON(CONFIG_FILE, { phases: ['Planning', 'Planned', 'In Progress', 'Completed'] });
  res.json(config);
});

// PUT /api/config — save global config
app.put('/api/config', (req, res) => {
  writeJSON(CONFIG_FILE, req.body);
  res.json(req.body);
});

// GET /api/tasks — return all global (miscellaneous) tasks
app.get('/api/tasks', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const tasks = readJSON(TASKS_FILE, []);
  res.json(tasks);
});

// PUT /api/tasks — save all global tasks (full replacement)
app.put('/api/tasks', (req, res) => {
  const tasks = Array.isArray(req.body) ? req.body : [];
  writeJSON(TASKS_FILE, tasks);
  res.json(tasks);
});

// ── Background images ─────────────────────────────────────────────────────────

// Helper: find an existing background file with any common image extension
const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

function findBackground(dir, name) {
  for (const ext of IMG_EXTS) {
    const f = path.join(dir, name + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// DELETE old global background files with different extensions before a new upload
function cleanOldBackgrounds(dir, name, keepExt) {
  for (const ext of IMG_EXTS) {
    if (ext === keepExt) continue;
    const f = path.join(dir, name + ext);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

// POST /api/backgrounds/global — upload global background image
app.post('/api/backgrounds/global', (req, res) => {
  bgUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    cleanOldBackgrounds(BACKGROUNDS_DIR, 'global', ext);
    res.json({ ok: true, url: '/api/backgrounds/global' });
  });
});

// GET /api/backgrounds/global — serve the global background image
app.get('/api/backgrounds/global', (_req, res) => {
  const found = findBackground(BACKGROUNDS_DIR, 'global');
  if (!found) return res.status(404).json({ error: 'No global background set' });
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(found);
});

// DELETE /api/backgrounds/global — remove global background
app.delete('/api/backgrounds/global', (_req, res) => {
  const found = findBackground(BACKGROUNDS_DIR, 'global');
  if (found) fs.unlinkSync(found);
  res.json({ ok: true });
});

// POST /api/projects/:id/background — upload per-project background
app.post('/api/projects/:id/background', (req, res) => {
  projBgUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    cleanOldBackgrounds(path.join(PROJECTS_DIR, req.params.id), 'background', ext);
    res.json({ ok: true, url: '/api/projects/' + req.params.id + '/background' });
  });
});

// GET /api/projects/:id/background — serve per-project background
app.get('/api/projects/:id/background', (req, res) => {
  const found = findBackground(path.join(PROJECTS_DIR, req.params.id), 'background');
  if (!found) return res.status(404).json({ error: 'No project background set' });
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(found);
});

// DELETE /api/projects/:id/background — remove per-project background
app.delete('/api/projects/:id/background', (req, res) => {
  const found = findBackground(path.join(PROJECTS_DIR, req.params.id), 'background');
  if (found) fs.unlinkSync(found);
  res.json({ ok: true });
});

// ── First-run bootstrap ───────────────────────────────────────────────────────

// Returns a Date offset by `days` from a base date at a fixed time.
function daysFrom(base, days, hours = 9, minutes = 0) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

// Converts a Date to the { month, day, year } object the UI uses for due dates.
function toDateObj(d) {
  return { month: String(d.getMonth() + 1), day: String(d.getDate()), year: String(d.getFullYear()) };
}

// Builds the example project with all dates computed relative to today so they
// always look realistic regardless of when the app is first installed.
// Completed tasks span from ~1 year ago up to recently; incomplete tasks have
// due dates spread from near-term out to ~1 year in the future.
function buildExampleProject() {
  const now = new Date();

  // completedAt values (ISO strings — sorted newest-first in the UI)
  const c1 = daysFrom(now, -365, 9,  15).toISOString();  // ~1 year ago
  const c2 = daysFrom(now, -330, 16,  0).toISOString();  // ~11 months ago
  const c3 = daysFrom(now, -300, 14, 30).toISOString();  // ~10 months ago
  const c4 = daysFrom(now, -240, 11,  0).toISOString();  // ~8 months ago
  const c5 = daysFrom(now, -180, 20,  0).toISOString();  // ~6 months ago
  const c6 = daysFrom(now, -150,  9,  0).toISOString();  // ~5 months ago
  const c7 = daysFrom(now, -120,  8,  0).toISOString();  // ~4 months ago
  const c8 = daysFrom(now,  -75, 12,  0).toISOString();  // ~2.5 months ago
  const c9 = daysFrom(now,  -30,  7, 45).toISOString();  // ~1 month ago

  // dueDate values for completed tasks (set a few days before their completedAt)
  const cd1 = toDateObj(daysFrom(now, -370,  0,  0));  // due before task-001 completion
  const cd2 = toDateObj(daysFrom(now, -335,  0,  0));  // due before task-002 completion
  const cd3 = toDateObj(daysFrom(now, -305,  0,  0));  // due before task-003 completion
  const cd4 = toDateObj(daysFrom(now, -245,  0,  0));  // due before task-004 completion
  const cd5 = toDateObj(daysFrom(now, -185,  0,  0));  // due before task-005 completion
  const cd6 = toDateObj(daysFrom(now, -155,  0,  0));  // due before task-006 completion

  // dueDate values ({ month, day, year } — spread from near-term to ~6 months out)
  const d1  = toDateObj(daysFrom(now,    3,  0,  0));  // ~3 days out
  const d2  = toDateObj(daysFrom(now,    5,  0,  0));  // ~5 days out
  const d3  = toDateObj(daysFrom(now,   11,  0,  0));  // ~1.5 weeks out
  const d4  = toDateObj(daysFrom(now,   18,  0,  0));  // ~2.5 weeks out
  const d5  = toDateObj(daysFrom(now,   28,  0,  0));  // ~1 month out
  const d6  = toDateObj(daysFrom(now,   40,  0,  0));  // ~6 weeks out
  const d7  = toDateObj(daysFrom(now,   54,  0,  0));  // ~8 weeks out
  const d8  = toDateObj(daysFrom(now,   70,  0,  0));  // ~10 weeks out
  const d9  = toDateObj(daysFrom(now,   89,  0,  0));  // ~3 months out
  const d10 = toDateObj(daysFrom(now,  115,  0,  0));  // ~4 months out
  const d11 = toDateObj(daysFrom(now,  145,  0,  0));  // ~5 months out
  const d12 = toDateObj(daysFrom(now,  176,  0,  0));  // ~6 months out

  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: '[Example] Diet App',
    color: '#30D158',
    phase: 'In Progress',
    version: 'v1.0',
    status: 'ongoing',
    notes: '',
    purpose: 'Track daily nutrition, build healthy meal habits, and monitor weight loss progress over 90 days.',
    createdAt: daysFrom(now, -52, 10, 0).toISOString(),
    files: [],
    tasks: [
      // ── Incomplete (with due dates — appear on the timeline) ────────────────
      {
        id: 'ex-task-010', text: 'Track daily water intake (target: 3L per day)',
        completed: false, completedAt: null, notes: '', dueDate: d1,
        subItems: []
      },
      {
        id: 'ex-task-011', text: 'Plan and prep meals every Sunday for the week ahead',
        completed: false, completedAt: null, notes: '', dueDate: d2,
        subItems: [
          { id: 'ex-sub-011a', text: 'Write out 5 dinners and their macros', completed: false, dueDate: d2 },
          { id: 'ex-sub-011b', text: 'Batch cook grains and proteins for the week', completed: false, dueDate: d2 }
        ]
      },
      {
        id: 'ex-task-012', text: 'Define cheat meal rules and frequency',
        completed: false, completedAt: null, notes: '', dueDate: d3,
        subItems: []
      },
      {
        id: 'ex-task-013', text: 'Research healthy restaurant options near the office',
        completed: false, completedAt: null, notes: '', dueDate: d4,
        subItems: [
          { id: 'ex-sub-013a', text: 'Find 3 lunch spots that publish nutrition info', completed: false, dueDate: d4 },
          { id: 'ex-sub-013b', text: 'Identify the safest menu items at each spot', completed: false, dueDate: d4 },
          { id: 'ex-sub-013c', text: 'Set a 700 cal max for any eating-out lunch', completed: false, dueDate: d4 }
        ]
      },
      {
        id: 'ex-task-014', text: 'Complete 30-day progress review and adjust targets',
        completed: false, completedAt: null, notes: '', dueDate: d5,
        subItems: []
      },
      {
        id: 'ex-task-015', text: 'Incorporate 30 minutes of light exercise 3x per week',
        completed: false, completedAt: null, notes: '', dueDate: d6,
        subItems: []
      },
      {
        id: 'ex-task-016', text: 'Try a 2-week intermittent fasting (16:8) experiment',
        completed: false, completedAt: null, notes: '', dueDate: d7,
        subItems: [
          { id: 'ex-sub-016a', text: 'Pick an eating window (12pm–8pm)', completed: false, dueDate: d7 },
          { id: 'ex-sub-016b', text: 'Track energy levels and hunger through the trial', completed: false, dueDate: d7 }
        ]
      },
      {
        id: 'ex-task-017', text: 'Take 3-month progress photos and measurements',
        completed: false, completedAt: null, notes: '', dueDate: d8,
        subItems: []
      },
      {
        id: 'ex-task-018', text: 'Complete full 90-day diet challenge and debrief',
        completed: false, completedAt: null, notes: '', dueDate: d9,
        subItems: []
      },
      {
        id: 'ex-task-019', text: 'Plan summer BBQ and social-eating strategies',
        completed: false, completedAt: null, notes: '', dueDate: d10,
        subItems: []
      },
      {
        id: 'ex-task-020', text: 'Set next-phase goals and adjust macros for maintenance',
        completed: false, completedAt: null, notes: '', dueDate: d11,
        subItems: []
      },
      {
        id: 'ex-task-021', text: 'Complete 6-month full progress review',
        completed: false, completedAt: null, notes: '', dueDate: d12,
        subItems: []
      },
      // ── Completed ───────────────────────────────────────────────────────────
      {
        id: 'ex-task-001', text: 'Define daily calorie and macro goals',
        completed: true, completedAt: c1, notes: '', dueDate: cd1,
        subItems: [
          { id: 'ex-sub-001a', text: 'Use a TDEE calculator to find maintenance calories', completed: true, dueDate: null },
          { id: 'ex-sub-001b', text: 'Set protein / carb / fat ratios (40/35/25)', completed: true, dueDate: null }
        ]
      },
      {
        id: 'ex-task-002', text: 'Take starting photos and body measurements',
        completed: true, completedAt: c2, notes: '', dueDate: cd2,
        subItems: []
      },
      {
        id: 'ex-task-003', text: 'Build a weekly grocery list template',
        completed: true, completedAt: c3, notes: '', dueDate: cd3,
        subItems: [
          { id: 'ex-sub-003a', text: 'List lean protein sources', completed: true, dueDate: null },
          { id: 'ex-sub-003b', text: 'List vegetables and fruits for the week', completed: true, dueDate: null },
          { id: 'ex-sub-003c', text: 'List pantry staples to always keep stocked', completed: true, dueDate: null }
        ]
      },
      {
        id: 'ex-task-004', text: 'Log every meal for the first two weeks',
        completed: true, completedAt: c4, notes: '', dueDate: cd4,
        subItems: []
      },
      {
        id: 'ex-task-005', text: 'Set up a weekly weigh-in routine',
        completed: true, completedAt: c5, notes: '', dueDate: cd5,
        subItems: [
          { id: 'ex-sub-005a', text: 'Pick a consistent day and time (Sunday morning)', completed: true, dueDate: null },
          { id: 'ex-sub-005b', text: 'Create a spreadsheet to log weekly results', completed: true, dueDate: null }
        ]
      },
      {
        id: 'ex-task-006', text: 'Identify go-to high-protein breakfast options',
        completed: true, completedAt: c6, notes: '', dueDate: cd6,
        subItems: []
      }
    ]
  };
}

// Creates the /data/ folder structure and default files on a fresh install.
// Safe to run every startup — skips anything that already exists.
function bootstrap() {
  // Ensure /data/projects/ directory exists
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });

  // Create default config.json if missing
  if (!fs.existsSync(CONFIG_FILE)) {
    writeJSON(CONFIG_FILE, {
      phases: ['Planning', 'Planned', 'In Progress', 'Completed'],
      theme: 'system'
    });
    console.log('Created default data/config.json');
  }

  // Seed projects.json and example project on a brand-new install
  if (!fs.existsSync(PROJECTS_IDX)) {
    // Build example project with dates relative to today and seed it
    const exampleProject = buildExampleProject();
    ensureProjectDir(exampleProject.id);
    writeJSON(path.join(PROJECTS_DIR, exampleProject.id, 'project.json'), exampleProject);

    // Write the index with just the example project entry
    writeJSON(PROJECTS_IDX, [toIndexEntry(exampleProject)]);
    console.log('Seeded example project on first run.');
  }
}

// ── Startup migration ─────────────────────────────────────────────────────────

// Rebuild any index entries that predate the currentTask / purpose fields.
// Runs once at startup — harmless if everything is already up-to-date.
function migrateIndex() {
  const index = readJSON(PROJECTS_IDX, []);
  let changed = false;

  const updated = index.map(entry => {
    // If this entry already has currentTask as an own property, it's current
    if (Object.prototype.hasOwnProperty.call(entry, 'currentTask')) return entry;

    // Otherwise load the full project and rebuild from scratch
    const projPath = path.join(PROJECTS_DIR, entry.id, 'project.json');
    const project  = readJSON(projPath);
    if (!project) return entry;  // project folder missing — leave as-is

    changed = true;
    return toIndexEntry(project);
  });

  if (changed) {
    writeJSON(PROJECTS_IDX, updated);
    console.log('Index migrated: rebuilt stale entries with currentTask field.');
  }
}

// Converts an ISO date string to a { month, day, year } object the UI expects.
function isoToDateObj(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return { month: String(d.getMonth() + 1), day: String(d.getDate()), year: String(d.getFullYear()) };
}

// One-time fix: scan every project file and convert any dueDate stored as an
// ISO string into the { month, day, year } shape the UI reads and writes.
function migrateDueDates() {
  const index = readJSON(PROJECTS_IDX, []);
  for (const entry of index) {
    const projPath = path.join(PROJECTS_DIR, entry.id, 'project.json');
    const project  = readJSON(projPath);
    if (!project) continue;

    let changed = false;
    const fixDate = (obj) => {
      if (typeof obj.dueDate === 'string') {
        obj.dueDate = isoToDateObj(obj.dueDate);
        changed = true;
      }
    };

    for (const task of (project.tasks || [])) {
      fixDate(task);
      for (const sub of (task.subItems || [])) fixDate(sub);
    }

    if (changed) {
      writeJSON(projPath, project);
      console.log(`Migrated dueDate format in project ${entry.id}`);
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

// Exported so electron.js can call startServer(port, callback) and open the window
// only after Express is confirmed listening — avoids a race condition on load.
// Pass port 0 to let the OS pick a free port; the callback receives the actual port.
function startServer(port, callback) {
  bootstrap();
  migrateIndex();
  migrateDueDates();
  const server = app.listen(port, () => {
    const actualPort = server.address().port;
    console.log(`Dashboard running at http://localhost:${actualPort}`);
    if (callback) callback(actualPort);
  });

  // Only reachable when a fixed port was requested (e.g. dev via `node server.js`);
  // Electron uses port 0 so the OS always picks a free port and this never fires.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const msg = `Port ${port} is already occupied.\n\nClose any other instance of Project Dashboard (or the dev server) and try again.`;
      console.error(`\nPort Already In Use\n${msg}`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}

// When run directly with `node server.js`, try the preferred port then fall back to any free port
if (require.main === module) {
  const net = require('net');
  const tester = net.createServer();
  tester.once('error', () => {
    tester.close(() => startServer(0));
  });
  tester.once('listening', () => {
    tester.close(() => startServer(PORT));
  });
  tester.listen(PORT);
}

module.exports = { startServer };
