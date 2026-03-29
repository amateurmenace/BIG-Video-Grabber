import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { startServer } from './server.js';
import { getYtDlpPath, checkForUpdate, updateYtDlp } from './lib/ytdlp-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let serverInstance: any = null;
let serverPort: number = 3000;

async function initYtDlp() {
  try {
    const ytdlpPath = await getYtDlpPath();
    process.env.YTDLP_PATH = ytdlpPath;
    console.log(`yt-dlp ready at: ${ytdlpPath}`);

    // Auto-update if stale (>24h)
    if (checkForUpdate()) {
      console.log("yt-dlp nightly update available, downloading...");
      await updateYtDlp().catch(e => console.error("yt-dlp update failed:", e.message));
    }
  } catch (e) {
    console.error("yt-dlp initialization failed (will retry on first use):", e);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'BIG Video Grabber',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  // Initialize yt-dlp in background
  initYtDlp();

  // Periodic yt-dlp update check every 24 hours
  setInterval(() => {
    if (checkForUpdate()) {
      updateYtDlp().catch(e => console.error("yt-dlp periodic update failed:", e.message));
    }
  }, 24 * 60 * 60 * 1000);

  // Start the Express server if not already running
  if (!serverInstance) {
    try {
      const result = await startServer();
      serverInstance = result.server;
      serverPort = result.port;
    } catch (e) {
      console.error("Failed to start server:", e);
    }
  }

  // Load the app
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
