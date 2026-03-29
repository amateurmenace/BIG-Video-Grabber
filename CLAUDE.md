# BIG Video Grabber

A comprehensive video downloading and broadcast conversion desktop app for **Brookline Interactive Group (BIG)**, a community media center in Brookline, MA.

## What This App Does

1. **Meeting Vacuum** — Searches the Brookline CivicClerk API for town meeting recordings (Zoom), downloads them via Puppeteer headless browser automation
2. **URL Downloader** — Downloads videos from YouTube, Vimeo, and 1000+ sites using yt-dlp (nightly builds, auto-updated)
3. **Broadcast Conversion** — Converts any downloaded video to cable broadcast standard: 1920x1080, 29.97fps, H.264/AAC with hardware acceleration detection (NVENC, VideoToolbox, QSV, AMF)

## Architecture

```
Frontend (React 19 + Vite 6 + Tailwind CSS 4)
  └── src/App.tsx          — Tabbed shell (Meeting Vacuum | Download | Library)
  └── src/components/
      ├── Header.tsx       — Rainbow gradient header, yt-dlp status badge, download path
      ├── MeetingsTab.tsx   — CivicClerk API search + Zoom download via Puppeteer
      ├── DownloadTab.tsx   — URL input, metadata preview, yt-dlp downloads
      └── LibraryTab.tsx    — Local files table, FFmpeg broadcast conversion

Backend (Express, runs inside Electron or standalone)
  └── server.ts            — All API endpoints, download queues, conversion queue
  └── lib/
      ├── ytdlp-manager.ts — Binary download/update from GitHub nightly releases
      └── ytdlp-runner.ts  — Spawn wrapper, progress parsing, metadata extraction

Electron
  └── main.ts              — App entry, starts Express server, initializes yt-dlp
  └── electron/main.ts     — Legacy entry (not used in current build)
```

## Key Technologies

- **React 19** with **shadcn/ui** (base-nova style, base-ui/react primitives)
- **Vite 6** for dev server and builds
- **Tailwind CSS 4** with oklch color space theming
- **Express** backend with Puppeteer (Zoom) and yt-dlp (everything else)
- **fluent-ffmpeg** + **@ffmpeg-installer/ffmpeg** for broadcast conversion
- **Electron 41** for desktop packaging (Windows NSIS, macOS DMG)

## Brand Colors (from BIG rainbow logo)

- Navy: `#1a1464` — Primary color, used for buttons, headings, tab indicators
- Pink: `#e84c8a` — Accent, used for highlights and the Download All button
- Orange: `#f5a623` — Chart/status accent
- Yellow: `#f7d547` — Chart/status accent
- Rainbow gradient: `linear-gradient(90deg, navy, pink, orange, yellow)` — Header bar, progress bars

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/default-directory` | GET | Default download path |
| `/api/choose-directory` | GET | Electron native folder picker |
| `/api/open-folder` | POST | Open folder in OS file manager |
| `/api/files` | POST | List video files in download directory |
| `/api/download` | POST | Queue Zoom download (Puppeteer) |
| `/api/downloads/status` | GET | All download progress |
| `/api/downloads/clear` | POST | Clear completed downloads |
| `/api/convert` | POST | Queue broadcast conversion (FFmpeg) |
| `/api/ytdlp-info` | POST | Get video metadata via yt-dlp |
| `/api/ytdlp-download` | POST | Queue yt-dlp download |
| `/api/ytdlp-status` | GET | yt-dlp binary status and version |
| `/api/ytdlp-update` | POST | Force update yt-dlp nightly |

## Development

```bash
npm install
npm run dev        # Starts Express + Vite dev server on port 3000
```

## Building

```bash
npm run build:electron   # Build frontend + server
npm run pack:mac         # Package macOS DMG
npm run pack:win         # Package Windows NSIS installer
```

## Key Design Decisions

- **yt-dlp binary is downloaded at runtime** (not bundled) to `bin/` directory. This keeps the app small and lets users always have the latest nightly.
- **Puppeteer kept for Zoom** because Zoom's download flow requires browser automation that yt-dlp can't handle (passcodes, disclaimers, dynamic download buttons).
- **Single Express server** serves both the API and the Vite-built frontend, simplifying the Electron integration.
- **2-second polling** for download/conversion status (not WebSocket) to keep the architecture simple.
- **Hardware encoder detection** runs a quick test encode before each conversion to verify the GPU encoder actually works on the current machine.

## Broadcast Conversion Specs

Output format for cable TV:
- Resolution: 1920x1080 (scaled and padded to maintain aspect ratio)
- Frame rate: 29.97fps (30000/1001)
- Video: H.264 (hardware accelerated when available)
- Audio: AAC, 48kHz, 192kbps
- Pixel format: yuv420p
- Container: MP4

## File Conventions

- Downloaded files go to the user-selected download directory
- Broadcast-converted files get `_broadcast` suffix (e.g., `meeting_broadcast.mp4`)
- yt-dlp binary stored in `bin/` (gitignored)
- yt-dlp version tracked in `bin/yt-dlp-version.txt`
