import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { startServer } from './server.js';
import { getYtDlpPath, checkForUpdate, updateYtDlp } from './lib/ytdlp-manager.js';

let mainWindow: BrowserWindow | null = null;
let serverInstance: any = null;
let serverPort: number = 3000;

// Catch all unhandled errors so the app doesn't crash silently
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  dialog.showErrorBox('BIG Video Grabber Error', `${error.name}: ${error.message}\n\n${error.stack || ''}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

async function initYtDlp() {
  try {
    const ytdlpPath = await getYtDlpPath();
    process.env.YTDLP_PATH = ytdlpPath;
    console.log(`yt-dlp ready at: ${ytdlpPath}`);

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

  // Initialize yt-dlp in background (don't block window creation)
  initYtDlp().catch(() => {});

  // Periodic yt-dlp update check every 24 hours
  setInterval(() => {
    if (checkForUpdate()) {
      updateYtDlp().catch(e => console.error("yt-dlp periodic update failed:", e.message));
    }
  }, 24 * 60 * 60 * 1000);

  // Start the Express server
  if (!serverInstance) {
    try {
      const result = await startServer();
      serverInstance = result.server;
      serverPort = result.port;
      console.log(`Server started on port ${serverPort}`);
    } catch (e: any) {
      console.error("Failed to start server:", e);
      dialog.showErrorBox('Server Error', `Failed to start the backend server: ${e.message}`);
      return;
    }
  }

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow).catch((e) => {
  console.error("App failed to start:", e);
});

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
