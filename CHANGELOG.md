# Changelog

> Entries are added only when a version number is specified. Content is auto-generated.
> New entries go here AND in the Settings → Update Log tab in `settings.html`.

## v1.5.4 — CI/CD Build Pipeline Fixes

- **GitHub Actions builds now succeed:** Switched from a custom `GH_TOKEN` secret (which required manual setup) to the auto-provided `GITHUB_TOKEN`, so the Windows and Mac build jobs no longer fail on tag pushes
- **Single Mac universal binary:** The Mac release now ships one `Project Dashboard (Mac).dmg` file that runs natively on both Intel and Apple Silicon, instead of two separate arch-specific downloads
- **Cleaner release file names:** Downloads on the GitHub release page are now labeled exactly `Project Dashboard (Windows).exe` and `Project Dashboard (Mac).dmg`
- **Auto-update channel files included in releases:** `latest.yml` and `latest-mac.yml` are now uploaded alongside the installers, which is what electron-updater needs to detect new versions inside the running app
- **`dist/` added to .gitignore:** Build output no longer shows up as untracked changes after running a local build

## v1.5.3 — FLIP Animations & Delete Confirmation

- **FLIP task reorder animation:** Tasks animate smoothly into their new positions when dragged to reorder — each row slides from where it was to where it ends up instead of snapping instantly
- **FLIP card reorder animation:** Dashboard project cards animate into new positions when dragged within or between sections, using the same FLIP technique
- **Sibling departure animation:** When a task is deleted or a card is removed, neighboring items smoothly slide to fill the gap rather than jumping
- **Delete confirmation for tasks with sub-tasks:** Deleting a task that has sub-tasks now shows a confirmation popup listing the task name — prevents accidental deletion of tasks with nested work

## v1.5.2 — Calendar Picker, Timeline Spacing & UI Modernization

- **Calendar date picker:** The three MM/DD/YYYY inputs in the add-task row are replaced with a calendar icon button. Clicking it opens a mini inline calendar with month/year dropdowns and a grid of days. Selecting a day sets the due date and closes the picker. A "Clear" link resets it. (Existing task date editing is unchanged.)
- **Timeline label spacing:** Increased the minimum horizontal gap between pin label boxes so they no longer crowd each other at zoomed-out zoom levels
- **Cleaner section backgrounds:** Project phase sections and the page header now use a plain white background instead of the previous grey fill, giving the layout a lighter, more modern feel
- **Card shadows:** Project cards now have a subtle resting shadow that grows noticeably on hover, replacing the flat border-only look and adding visual depth

## v1.5.1 — Timeline Polish & Version Field Removal

- **Version field removed:** Version numbers no longer appear on project cards or the project detail page — add it to the project title if needed
- **Smaller card titles:** Project card names on the dashboard are now 19px (down from 25px) for a cleaner, less crowded look
- **Thicker timeline baseline:** The horizontal timeline axis is now 5px thick (up from 3px)
- **Larger timeline dots:** Pin dots are 16px (up from 11px) for main tasks; sub-task dots remain smaller (10px) to stay visually distinct
- **More vertical spacing on timeline:** Stems are taller (STEM_BASE 40px, LEVEL_STEP 78px) so items have more breathing room
- **Zoom-out limit:** Timeline can no longer be zoomed out past showing the full date range (oldest task at left, newest at right)
- **Halved zoom sensitivity:** Scroll-to-zoom is half as fast, making precise zooming easier
- **Month tick marks:** Unlabelled tick marks appear on the timeline baseline at each month boundary within the project date range
- **Sub-task pin sizing:** Sub-tasks appear with smaller dots and smaller label text than main tasks, making the hierarchy visually clear

## v1.5 — Timeline View & UI Polish

- **Timeline view:** New "Timeline" button in the project header opens a full-width modal showing all tasks and sub-tasks plotted on a horizontal date axis
- **Task vs sub-task sizing:** Tasks appear as larger boxes with the project color bar; sub-tasks are smaller and more subtle
- **Completed task styling:** Completed items animate in greyed out (45% opacity) — still legible, clearly distinct from active tasks
- **Today line:** A blue vertical "Today" line shows where the current date falls relative to all task due dates
- **Undated zone:** Tasks and sub-tasks without a due date appear in a separated "No Due Date" zone on the right
- **Timeline animation:** Items reveal left to right with a spring pop-in that starts slow and accelerates — mirrors the Tasks page stagger style
- **"Order by Date" relocated:** Moved from the project header to the top-right corner of the Tasks section card
- **"Timeline" button placement:** Sits in the project header to the right of "Undo", where "Order by Date" previously was
- **Fix — version badge overlap:** The delete × button on dashboard card hover no longer overlaps the version badge (added right margin to the header-right area)
- **Fix — color swatch height:** The vertical project color bar on the detail page now stretches to match the full height of the project name and metadata row
- **Tasks page animation tuned:** Stagger starts at 120ms (up from 60ms) and decays at 0.62× (down from 0.72×) for a slower, more dramatic acceleration

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