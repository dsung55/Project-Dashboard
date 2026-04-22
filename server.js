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
const DATA_DIR     = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const PROJECTS_IDX = path.join(DATA_DIR, 'projects.json');
const CONFIG_FILE  = path.join(DATA_DIR, 'config.json');
const TASKS_FILE   = path.join(DATA_DIR, 'tasks.json');

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
  const c2 = daysFrom(now, -300, 14, 30).toISOString();  // ~10 months ago
  const c3 = daysFrom(now, -240, 11,  0).toISOString();  // ~8 months ago
  const c4 = daysFrom(now, -180, 20,  0).toISOString();  // ~6 months ago
  const c5 = daysFrom(now, -120,  8,  0).toISOString();  // ~4 months ago
  const c6 = daysFrom(now,  -60,  7, 45).toISOString();  // ~2 months ago

  // dueDate values ({ month, day, year } — the format the UI reads and writes)
  const d1 = toDateObj(daysFrom(now,   30, 10,  0));  // ~1 month out
  const d2 = toDateObj(daysFrom(now,   60,  0,  0));  // ~2 months out
  const d3 = toDateObj(daysFrom(now,  120,  0,  0));  // ~4 months out
  const d4 = toDateObj(daysFrom(now,  210,  0,  0));  // ~7 months out
  const d5 = toDateObj(daysFrom(now,  365,  0,  0));  // ~1 year out

  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: '[Example] Diet App',
    color: '#30D158',
    phase: 'In Progress',
    version: 'v1.0',
    status: 'ongoing',
    notes: '',
    purpose: 'Track daily nutrition, build healthy meal habits, and monitor weight loss progress over 90 days.',
    createdAt: daysFrom(now, -365, 10, 0).toISOString(),
    files: [],
    tasks: [
      // ── Completed ───────────────────────────────────────────────────────────
      {
        id: 'ex-task-001', text: 'Define daily calorie and macro goals',
        completed: true, completedAt: c1, notes: '',
        subItems: [
          { id: 'ex-sub-001a', text: 'Use a TDEE calculator to find maintenance calories', completed: true, dueDate: null },
          { id: 'ex-sub-001b', text: 'Set protein / carb / fat ratios (40/35/25)', completed: true, dueDate: null }
        ]
      },
      {
        id: 'ex-task-002', text: 'Research meal tracking apps for inspiration',
        completed: true, completedAt: c2, notes: '',
        subItems: []
      },
      {
        id: 'ex-task-003', text: 'Build a weekly grocery list template',
        completed: true, completedAt: c3, notes: '',
        subItems: [
          { id: 'ex-sub-003a', text: 'List lean protein sources', completed: true, dueDate: null },
          { id: 'ex-sub-003b', text: 'List vegetables and fruits for the week', completed: true, dueDate: null },
          { id: 'ex-sub-003c', text: 'List pantry staples to always keep stocked', completed: true, dueDate: null }
        ]
      },
      {
        id: 'ex-task-004', text: 'Log every meal for the first two weeks',
        completed: true, completedAt: c4, notes: '',
        subItems: []
      },
      {
        id: 'ex-task-005', text: 'Set up a weekly weigh-in routine',
        completed: true, completedAt: c5, notes: '',
        subItems: [
          { id: 'ex-sub-005a', text: 'Pick a consistent day and time (Sunday morning)', completed: true, dueDate: null },
          { id: 'ex-sub-005b', text: 'Create a spreadsheet to log weekly results', completed: true, dueDate: null }
        ]
      },
      {
        id: 'ex-task-006', text: 'Identify go-to high-protein breakfast options',
        completed: true, completedAt: c6, notes: '',
        subItems: []
      },
      // ── Incomplete ──────────────────────────────────────────────────────────
      {
        id: 'ex-task-007', text: 'Plan and prep meals every Sunday for the week ahead',
        completed: false, completedAt: null, notes: '', dueDate: d1,
        subItems: [
          { id: 'ex-sub-007a', text: 'Write out 5 dinners and their macros', completed: false, dueDate: d1 },
          { id: 'ex-sub-007b', text: 'Batch cook grains and proteins for the week', completed: false, dueDate: d1 }
        ]
      },
      {
        id: 'ex-task-008', text: 'Track daily water intake (target: 3L per day)',
        completed: false, completedAt: null, notes: '', dueDate: d2,
        subItems: []
      },
      {
        id: 'ex-task-009', text: 'Research healthy restaurant options near the office',
        completed: false, completedAt: null, notes: '', dueDate: d3,
        subItems: [
          { id: 'ex-sub-009a', text: 'Find 3 lunch spots that publish nutrition info', completed: false, dueDate: d3 },
          { id: 'ex-sub-009b', text: 'Identify the safest menu items at each spot', completed: false, dueDate: d3 },
          { id: 'ex-sub-009c', text: 'Set a 700 cal max for any eating-out lunch', completed: false, dueDate: d3 }
        ]
      },
      {
        id: 'ex-task-010', text: 'Define cheat meal rules and frequency',
        completed: false, completedAt: null, notes: '', dueDate: d4,
        subItems: []
      },
      {
        id: 'ex-task-011', text: 'Review 30-day progress and adjust the plan',
        completed: false, completedAt: null, notes: '', dueDate: d5,
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

// Exported so electron.js can call startServer(callback) and open the window
// only after Express is confirmed listening — avoids a race condition on load.
function startServer(callback) {
  bootstrap();
  migrateIndex();
  migrateDueDates();
  app.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
    if (callback) callback();
  });
}

// When run directly with `node server.js`, start immediately
if (require.main === module) {
  startServer();
}

module.exports = { startServer };
