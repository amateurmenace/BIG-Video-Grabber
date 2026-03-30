# BIG Video Grabber

A comprehensive video downloading and broadcast conversion desktop app for **Brookline Interactive Group (BIG)**, a community media center in Brookline, MA.

## What This App Does

1. **Meeting Vacuum** — Searches the Brookline CivicClerk API for town meeting recordings (Zoom), downloads them via Puppeteer headless browser automation
2. **URL Downloader** — Downloads videos from YouTube, Vimeo, and 1000+ sites using yt-dlp (nightly builds, auto-updated). Forces H.264+AAC output for universal playback.
3. **Broadcast Converter** — Converts any video to cable broadcast standard with customizable resolution, frame rate, speed, quality, and optional loudness normalization. Supports drag-and-drop of external files. Hardware acceleration auto-detected (NVENC, VideoToolbox, QSV, AMF).
4. **Automation Scheduler** — Recurring schedules that auto-vacuum meetings from CivicClerk and optionally auto-convert to broadcast. Runs to a separate output folder to keep automated work clean from manual workflow.
5. **Activity Log** — Real-time event stream at the bottom of the app showing all downloads, conversions, FFmpeg commands, and errors.

## Architecture

```
Frontend (React 19 + Vite 6 + Tailwind CSS 4)
  └── src/App.tsx               — Tabbed shell (Meeting Vacuum | Download | Broadcast Converter | Automation)
  └── src/components/
      ├── Header.tsx            — Rainbow gradient header, yt-dlp status badge, download path
      ├── MeetingsTab.tsx       — CivicClerk API search + Zoom download via Puppeteer
      ├── DownloadTab.tsx       — URL input, instant thumbnail preview, yt-dlp downloads
      ├── LibraryTab.tsx        — Broadcast converter settings, drag-and-drop, file table, conversion queue
      ├── AutomationTab.tsx     — Recurring schedule manager for auto meeting vacuum + convert
      └── ActivityLog.tsx       — Fixed bottom panel with live server event stream

Backend (Express, runs inside Electron or standalone)
  └── server.ts                 — All API endpoints, download queues, conversion queue, automation scheduler, activity log
  └── lib/
      ├── ytdlp-manager.ts     — Binary download/update from GitHub nightly releases
      └── ytdlp-runner.ts      — Spawn wrapper, progress parsing, metadata extraction

Electron
  └── main.ts                   — App entry, starts Express server, initializes yt-dlp, error handling
  └── electron/main.ts          — Legacy entry (not used in current build)
  └── build/entitlements.mac.plist — macOS hardened runtime entitlements for code signing
```

## Key Technologies

- **React 19** with **shadcn/ui** (base-nova style, base-ui/react primitives)
- **Vite 6** for dev server and builds
- **Tailwind CSS 4** with oklch color space theming
- **Express** backend with Puppeteer (Zoom) and yt-dlp (everything else)
- **fluent-ffmpeg** + **@ffmpeg-installer/ffmpeg** for broadcast conversion
- **Electron 41** for desktop packaging (Windows NSIS, macOS DMG)
- **esbuild** bundles server code as CJS (not ESM) for Electron compatibility

## Brand Colors (from BIG rainbow logo)

- Navy: `#1a1464` — Primary color, used for buttons, headings, tab indicators
- Pink: `#e84c8a` — Accent, used for highlights and the Download All button
- Orange: `#f5a623` — Chart/status accent, conversion progress
- Yellow: `#f7d547` — Chart/status accent, automation icon
- Rainbow gradient: `linear-gradient(90deg, navy, pink, orange, yellow)` — Header bar, progress bars

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/default-directory` | GET | Default download path |
| `/api/choose-directory` | GET | Electron native folder picker |
| `/api/open-folder` | POST | Open folder in OS file manager |
| `/api/files` | POST | List video files in download directory (excludes in-progress broadcast files) |
| `/api/download` | POST | Queue Zoom download (Puppeteer) |
| `/api/downloads/status` | GET | All download progress (Zoom + yt-dlp unified) |
| `/api/downloads/clear` | POST | Clear completed downloads |
| `/api/convert` | POST | Queue broadcast conversion with custom resolution/framerate/quality |
| `/api/convert-external` | POST | Convert a file from any path (for drag-and-drop) |
| `/api/ytdlp-quick-info` | POST | Fast metadata (title, thumbnail, duration) via yt-dlp --print |
| `/api/ytdlp-info` | POST | Full metadata with all format options via yt-dlp --dump-json |
| `/api/ytdlp-download` | POST | Queue yt-dlp download (starts immediately, metadata in background) |
| `/api/ytdlp-status` | GET | yt-dlp binary status and version |
| `/api/ytdlp-update` | POST | Force update yt-dlp nightly |
| `/api/activity-log` | GET | Recent activity events (supports `?since=` for incremental polling) |
| `/api/automation/schedules` | GET/POST | List or create automation schedules |
| `/api/automation/schedules/:id/toggle` | POST | Enable/disable a schedule |
| `/api/automation/schedules/:id/run` | POST | Manually trigger a schedule |
| `/api/automation/schedules/:id` | DELETE | Delete a schedule |

## Development

```bash
npm install
npm run dev        # Starts Express + Vite dev server on port 3000
```

## Building

```bash
npm run build:electron   # Build frontend + bundle server as CJS
npm run pack:mac         # Package signed macOS DMGs (arm64 + x64)
npm run pack:win         # Package Windows NSIS installer
```

## Code Signing & Notarization

macOS apps are signed with Developer ID Application certificate and notarized with Apple:
```bash
# Notarize (credentials stored in keychain as "BIG-Video-Grabber")
xcrun notarytool submit "release/BIG Video Grabber-1.0.0-arm64.dmg" --keychain-profile "BIG-Video-Grabber" --wait
xcrun stapler staple "release/BIG Video Grabber-1.0.0-arm64.dmg"
```

## Key Design Decisions

- **esbuild outputs CJS (not ESM)** — Electron's main process doesn't support ESM. Output files are `.cjs` to avoid conflict with `"type": "module"` in package.json. Never use `import.meta.url` in server/main code.
- **yt-dlp forces H.264 codec** — YouTube defaults to AV1 which QuickTime can't play. Uses `-S vcodec:h264,acodec:m4a` to prefer H.264, and `--recode-video mp4` as fallback to re-encode if AV1 slips through.
- **yt-dlp binary is downloaded at runtime** (not bundled) to `bin/` directory. Auto-updates nightly. Keeps the app small.
- **Instant URL cards** — When user pastes a YouTube URL, the card with thumbnail appears immediately (thumbnail from `i.ytimg.com`, no yt-dlp needed). Title/duration fill in from yt-dlp in background. User can click Download without waiting.
- **Downloads start immediately** — The download endpoint does NOT block on metadata. It fires yt-dlp right away and resolves the filename from stdout.
- **Puppeteer kept for Zoom** because Zoom's download flow requires browser automation that yt-dlp can't handle (passcodes, disclaimers, dynamic download buttons).
- **Single Express server** serves both the API and the Vite-built frontend.
- **2-second polling** for download/conversion status (not WebSocket) to keep the architecture simple.
- **Hardware encoder detection** runs a quick test encode before each conversion. VideoToolbox uses quality-based encoding (`-q:v`) instead of fixed bitrate to avoid file bloat.
- **Broadcast files hidden during conversion** — The `/api/files` endpoint filters out `_broadcast.mp4` files whose source is actively converting, so they don't appear in "Broadcast Ready" prematurely.
- **Automation uses separate output folders** to keep automated downloads/conversions isolated from manual workflow.

## Broadcast Conversion Specs

Default output format for cable TV (all customizable in the UI):
- Resolution: 1920x1080 (also 720p, 4K, SD NTSC available)
- Frame rate: 29.97fps (also 25fps PAL, 23.976fps Film, 30fps, 59.94fps)
- Video: H.264 (hardware accelerated when available)
- Audio: AAC, 48kHz, 192kbps
- Optional: Loudness normalization to -24 LUFS (broadcast standard) via ffmpeg loudnorm filter
- Pixel format: yuv420p
- Container: MP4
- Speed presets: Ultrafast, Fast, Medium, Slow
- Quality presets: High Quality (CRF 18), Broadcast Standard (CRF 23), Compact (CRF 28)

## File Conventions

- Downloaded files go to the user-selected download directory
- Broadcast-converted files get `_broadcast` suffix (e.g., `meeting_broadcast.mp4`)
- Automated downloads go to the schedule's configured output folder (separate from main downloads)
- yt-dlp binary stored in `bin/` (gitignored)
- yt-dlp version tracked in `bin/yt-dlp-version.txt`

## Known Issues & Gotchas

- `yt-dlp --print` and `--dump-json` are both slow (~15-90 seconds) because yt-dlp must extract the full page. The instant card UX works around this by showing placeholder data immediately.
- Zoom's web interface changes frequently — Puppeteer selectors in `server.ts` may need updating when Zoom redesigns their recording page.
- Windows builds are unsigned (no Windows code signing certificate). Users will see SmartScreen warnings.
- The `electron/main.ts` file is a legacy entry point and is NOT used by the current build. The active Electron entry is `main.ts` at project root.
