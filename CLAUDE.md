# Project Dashboard

## Overview

Local, single-user project management dashboard. Vanilla HTML/CSS/JS frontend + minimal Node.js/Express backend for file I/O. Runs on Windows at `localhost:3000`. No accounts, no cloud. Data stored as local JSON under `/data/`.

Target user is non-technical — keep explanations clear, code well-commented. Design reference: Apple.com (generous whitespace, clean type, subtle borders).

**Out of scope:** user auth, cloud sync, mobile layout, markdown rendering, multi-user, frontend frameworks, CSS frameworks, jQuery.

## Tech Stack & Constraints

- **Frontend:** Vanilla HTML/CSS/JS — no framework, no build step, no CDN
- **Backend:** Node.js + Express (`server.js` only)
- **Storage:** Local JSON files under `/data/`
- **OS:** Windows — `path.join()` everywhere, never hardcode `/`
- **Dependencies:** Express, Multer only — must run fully offline after `npm install`

## Project Structure

```
project-root/
├── index.html              # Home dashboard
├── project.html            # Project detail view
├── settings.html           # Settings (phases, theme, update log)
├── styles/
│   ├── main.css            # Design tokens, layout, shared styles
│   └── project.css         # Project detail styles
├── scripts/
│   ├── api.js              # All fetch() calls — only file allowed to use fetch()
│   ├── dashboard.js        # Home page logic
│   ├── project.js          # Project detail logic
│   └── settings.js         # Settings logic
├── server.js               # Express server — all file I/O endpoints
├── data/
│   ├── config.json         # Global config (phases, theme)
│   ├── projects.json       # Lightweight project index
│   └── projects/<id>/
│       ├── project.json    # Full project data
│       └── files/          # Uploaded files
├── CHANGELOG.md            # Version history
└── package.json
```

## Design & UI

- **Colors:** `#FFFFFF`/`#F5F5F7` bg, `#1D1D1F` text, `#E0E0E0` borders
- **Dark mode:** `[data-theme="dark"]` on `<html>`; hover states use `rgba(255,255,255,...)` not `rgba(0,0,0,...)`
- **Typography:** `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- **Project color:** Left-border accent on cards only — not a full fill
- **Section boxes:** `#FAFAFA` (light) / `#212123` (dark) fill
- **Interactions:** 100–150ms ease; custom modals, never `alert()`/`confirm()`

## Code Style

- Readability over cleverness; every function gets a one-line comment
- `camelCase` JS; `kebab-case` CSS classes and file names
- `api.js` is the only file that calls `fetch()` — all others use `window.api`
- UUIDs via `crypto.randomUUID()`
- Errors as toast notifications, never `alert()`
- No inline styles in HTML

## Data Shapes

**`data/projects.json`** — index used by dashboard:
`id, name, color, phase, version, status, purpose, currentTask, taskCount, completedTaskCount, createdAt`

**`data/projects/<id>/project.json`** — full project:
`id, name, color, phase, version, status, notes, purpose, createdAt, tasks[], files[]`

Each task: `id, text, completed, completedAt, notes, subItems[]`

**`data/config.json`:** `{ phases: [...], theme: "system" }`

## API Endpoints

| Method | Path | Purpose |
|-|-|-|
| GET | `/api/projects` | List all projects (index) |
| POST | `/api/projects` | Create new project |
| DELETE | `/api/projects/:id` | Delete project + folder |
| GET | `/api/projects/:id` | Get full project data |
| PUT | `/api/projects/:id` | Save full project data |
| POST | `/api/projects/:id/files` | Upload a file |
| GET | `/api/projects/:id/files/:filename` | Serve a file |
| GET | `/api/config` | Get global config |
| PUT | `/api/config` | Save global config |

## Versioning

Version history lives in `CHANGELOG.md` and in Settings → Update Log in `settings.html`.
Add entries only when the user specifies a version number — auto-generate the content.