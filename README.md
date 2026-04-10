# Project Dashboard

A private, offline project tracker that runs entirely on your computer — no internet, no accounts.

---

## First-time setup

You only need to do this once.

**1. Install Node.js** (if you haven't already)
- Download from [nodejs.org](https://nodejs.org) — choose the **LTS** version
- Run the installer with default options

**2. Install the app's dependencies**
- Open the folder this README is in
- Click in the address bar at the top of the Explorer window, type `cmd`, and press Enter — this opens a Command Prompt in the right folder
- Type the following and press Enter:
  ```
  npm install
  ```
- Wait for it to finish (you'll see a `node_modules` folder appear)
- Your `data/` folder and default files are created automatically the first time you start the app — nothing extra needed

---

## Starting the app

**Option A — Easy launcher (recommended)**
- Double-click `launch.vbs` in this folder
- The server starts silently in the background and your browser opens automatically
- To create a desktop shortcut: right-click `launch.vbs` → Create Shortcut → move the shortcut to your Desktop

**Option B — Terminal**
- Open a Command Prompt in this folder (same as step 2 above)
- Type `node server.js` and press Enter
- Open your browser and go to `http://localhost:3000`

---

## Stopping the app

**If you used launch.vbs:** double-click `stop.vbs` — a confirmation dialog will appear and the server will stop.

> Note: `stop.vbs` stops all Node.js processes on your computer. This is fine for everyday use since this is the only Node app you're likely running.

**If you used the terminal:** click in the terminal window and press `Ctrl + C`.

---

## Using the app

- **Home page** — shows all your projects grouped by status (Not Started, Ongoing, Completed)
- **Create a project** — click the **+ New Project** button in the top right
- **Open a project** — click any project card
- **Delete a project** — hover over a card and click the ✕ button (a confirmation prompt will appear)
- **Project detail page:**
  - Add tasks with the input at the top of the Tasks section
  - Click a task to expand it — you can add sub-items and notes
  - Check a task's checkbox to mark it complete — it moves to the Completed section
  - Upload files by clicking the upload area or dragging a file onto it
  - Change the phase or version in the header area
- **Settings** — click Settings in the sidebar to manage the phase list

---

## Where is my data?

All data is saved as plain text files in the `data/` folder inside this directory:

- `data/projects.json` — list of all projects
- `data/projects/<project-id>/project.json` — all details for one project
- `data/projects/<project-id>/files/` — uploaded files for that project

You can back up your data by copying the entire `data/` folder anywhere you like.

---

## Troubleshooting

**Browser shows "This site can't be reached"**
- The server isn't running. Start it with `launch.vbs` or `node server.js`.

**"npm is not recognized" error**
- Node.js isn't installed, or you need to restart your computer after installing it.

**Port 3000 is already in use**
- Another app is using port 3000. Run `stop.vbs` to kill any existing Node process, then try again.
