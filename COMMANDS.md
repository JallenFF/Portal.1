# Portal — Commands & Quick Reference

## Easiest Way: Use the Launcher

Double-click **`portal-launcher.bat`** in the project root. It gives you a numbered menu — just pick what you want.

---

## What Runs Where

| Thing | Port | What it does |
|-------|------|-------------|
| **Hub Server** | 3141 | The brain — API, database, file vault |
| **UI Dev Server** | 5173 | The visual canvas you see in the browser |
| **Tauri App** | — | Desktop window (wraps the UI + auto-starts hub) |

---

## Manual Commands (if you prefer terminal)

Open a terminal/PowerShell in the `Portal.1` folder, then:

### Start the Hub server
```
npx tsx packages/hub/src/server.ts
```
Runs until you press `Ctrl+C`. Must be running before the UI works.

### Start the UI
```
npm run dev:ui
```
Opens a dev server at `http://localhost:5173`. The UI proxies API calls to the hub on port 3141.

### Start both at once
Run these in **two separate terminals** (or use the launcher which does this for you):

Terminal 1:
```
npx tsx packages/hub/src/server.ts
```

Terminal 2:
```
npm run dev:ui
```

Then open `http://localhost:5173` in your browser.

### Check if the Hub is alive
```
curl http://127.0.0.1:3141/health
```
If it returns JSON, the hub is running.

### Install dependencies (first time or after pulling updates)
```
npm install
```

### Start the Tauri desktop app
```
npm run tauri dev
```
This starts the full desktop application (requires Rust/Tauri toolchain installed).

---

## Hub API Endpoints (for testing)

You can hit these directly in your browser or with curl while the hub is running:

| URL | What it shows |
|-----|--------------|
| `http://127.0.0.1:3141/health` | Is the hub alive? |
| `http://127.0.0.1:3141/projects` | List all projects |
| `http://127.0.0.1:3141/diagnostics` | System report + DB stats |
| `http://127.0.0.1:3141/diagnostics/events` | System event log |
| `http://127.0.0.1:3141/events` | Domain events |

---

## Troubleshooting

**"command not found" or "npx is not recognized"**
→ Node.js isn't installed or isn't in your PATH. Install from https://nodejs.org (LTS version).

**Hub won't start / port in use**
→ Something else is using port 3141. Use the launcher's "Stop All" option (8), or run `taskkill /f /im node.exe` in PowerShell.

**UI shows blank page or errors**
→ Make sure the hub is running first. The UI needs the hub's API to load projects.

**"Cannot find module" errors**
→ Run `npm install` first. Dependencies might not be installed yet.

---

## npm Scripts (in package.json)

| Script | Command | What it does |
|--------|---------|-------------|
| `dev:ui` | `npm run dev:ui` | Start Vite UI dev server |
| `build:ui` | `npm run build:ui` | Build UI for production |
| `hub` | `npm run hub` | Start the Fastify hub server |
| `dev` | `npm run dev` | Start hub + UI together |
| `tauri` | `npm run tauri` | Tauri CLI |

> **Note:** The `hub` and `dev` scripts require updating `package.json`. See the updated version below.

---

## Updated package.json scripts

Add these to your `package.json` scripts section:

```json
"scripts": {
  "hub": "npx tsx packages/hub/src/server.ts",
  "dev": "npx tsx packages/hub/src/server.ts & npm run dev:ui",
  "dev:ui": "vite",
  "build:ui": "vite build",
  "tauri": "tauri"
}
```

On Windows, the `&` in `dev` may not work. Use the launcher instead, or install `concurrently`:
```
npm install -D concurrently
```
Then change `dev` to:
```json
"dev": "concurrently \"npx tsx packages/hub/src/server.ts\" \"npm run dev:ui\""
```
