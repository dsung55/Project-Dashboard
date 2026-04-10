# Changelog

> Entries are added only when a version number is specified. Content is auto-generated.
> New entries go here AND in the Settings → Update Log tab in `settings.html`.

## v1.4.1 — Sub-task Improvements & Date Validation

- **Sub-task completion:** Sub-items now have checkboxes — click to mark them done, completed sub-items appear grayed out with a strikethrough
- **Due dates on sub-tasks:** Double-click any sub-item to edit it; inline Month/Day/Year inputs let you set a due date, shown as a badge on the row when set
- **Double-click to edit sub-tasks:** Sub-items are read-only by default — double-click to enter edit mode for the text and date fields; press Enter or click away to save
- **Add sub-items below the entry box:** New sub-items now appear in the list below the input row instead of above it
- **Cleaner sub-item design:** Removed the individual white boxes around sub-items — they now display as clean, borderless rows that highlight subtly on hover
- **Month input wider:** The "Month" placeholder in all due-date boxes no longer gets clipped
- **Date inputs: numbers only:** Month, Day, and Year boxes now reject non-numeric input; Month is clamped to 1–12 and Day to 1–31 on blur

## v1.4 — Due Dates, Undo, & Task Editing

- **Due dates on tasks:** Each task now supports a due date entered via Month/Day/Year boxes in the expanded panel — a badge displays the date on the task row when set
- **Due date on task creation:** The add-task row includes Month/Day/Year inputs so you can set a due date when creating a task
- **Order by Date:** New button in the project header sorts unfinished tasks by due date (closest first), undated tasks fall to the bottom
- **Undo:** New Undo button in the project header reverts the last action — works for adding, deleting, completing, dragging, renaming, and sorting tasks (up to 20 steps)
- **Inline task editing:** Double-click any task name to edit it in place; press Enter to save or Escape to cancel
- **Delete Project button:** Removed red styling — now matches the other secondary buttons
- **Sidebar tab outlines:** Navigation tabs in the left sidebar now have a subtle border for better visual definition

## v1.3.1 — Bug Fixes & Color Change

- **Change project color:** Project detail page now shows a clickable color dot next to the version field — click it to change the project's color at any time using the same picker as project creation
- **Color picker centering:** The custom color dialog now opens in the center of the screen instead of the corner
- **Purpose display fix:** Project purpose on dashboard cards now always reads live from the project file, so it's always in sync after editing — no more "No purpose set" when a purpose exists

## v1.3 — Drag & Drop + Phase Fix

- **Task drag-to-reorder:** Active tasks can be dragged up and down to change their order using the ⠿ handle
- **Sub-task outlines:** Sub-items now each have an individual bordered card — no longer plain bullet points
- **Sub-task panel stays open:** Adding a sub-item no longer closes the task panel; add multiple sub-items without re-expanding
- **Sub-task drag-to-reorder:** Sub-items within a task can be reordered by dragging the ⠿ handle
- **Phase placement fix:** Projects created in "In Progress" or "Testing" phase now correctly appear in the In Progress section even with no tasks
- **"In Progress" rename:** Dashboard "Ongoing" section renamed to "In Progress" to match the phase names
- **Card drag within section:** Project cards can be dragged to reorder them within their section; order persists to the server
- **Card drag between sections:** Drag a card from one section to another to automatically update its phase and status

## v1.2.3 — Bug Fix
- **Dashboard auto-refresh:** Dashboard re-fetches projects on every page navigation (link clicks, back button, bfcache), tab switches, and window refocus — current task and status changes appear immediately
- **Bfcache stale-data fix:** Reset the refresh guard on `pageshow` so back-forward cache restores always fetch fresh data
- **No-cache header:** `GET /api/projects` sends `Cache-Control: no-store` so the browser never serves a stale project list from cache

## v1.2.2 — Bug Fixes
- **Current task data migration:** Server rebuilds stale `projects.json` index entries on startup — fixes cards showing "No active tasks" when the entry predated the `currentTask` field
- **Dark mode primary button:** Primary buttons now render black background + white text in dark mode (was near-invisible)

## v1.2.1 — Bug Fixes & Polish
- **Smaller color swatches:** Reduced from 36px to 22px; palette updated to 15 visually distinct hues
- **Default version pre-filled:** New project modal pre-fills "v1.0"
- **Dark mode hover fixes:** Sidebar nav, ghost buttons, card menus use white-tinted hover states in dark mode
- **Lighter section fill:** Section boxes use `#FAFAFA` / `#212123` so border stands out over fill
- **Hide empty sections:** Status sections hidden entirely when empty; search also hides empty sections

## v1.2 — UI Polish & Search
- **Color picker:** Google Calendar-style swatch grid + custom color option
- **Section boxes:** Outline border and background added to dashboard sections and page header
- **Larger card title:** 19px / weight 700
- **Search bar:** Real-time filter by project name
- **Purpose panel fix:** 3-dot expand panel now shows a "Purpose" heading

## v1.1
- Light / Dark / System theme toggle
- Project Purpose field
- Dashboard cards show current (first incomplete) task
- First incomplete task bolded on project detail page
- 3-dot card button expands to show purpose
- Delete project from detail page
- Update Log added to Settings

## v1.0 — Initial Release
- Full scaffold: all HTML, CSS, JS, and server files
- Home dashboard with Not Started / Ongoing / Completed sections
- Project cards with name, version badge, phase, current task
- Create and delete projects
- Project detail: tasks, sub-bullets, task notes, project notes, purpose
- Phase selector, version field, file upload/download
- Settings page with editable phase list
- Apple-inspired UI with dark mode support
- Windows launch scripts (`launch.vbs`, `stop.vbs`)