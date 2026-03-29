import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // In development, load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle download requests
ipcMain.handle('download-zoom', async (event, url) => {
  if (!mainWindow) return { success: false, error: 'No main window' };

  // Ask user for download directory
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Download Folder',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Download cancelled' };
  }

  const downloadPath = result.filePaths[0];

  // Create a hidden window to load the Zoom page
  const hiddenWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // Set download path for this session
  hiddenWindow.webContents.session.on('will-download', (event, item, webContents) => {
    // Set the save path, making Electron not to prompt a save dialog.
    item.setSavePath(path.join(downloadPath, item.getFilename()));
    
    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        console.log('Download is interrupted but can be resumed');
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          console.log('Download is paused');
        } else {
          console.log(`Received bytes: ${item.getReceivedBytes()}`);
        }
      }
    });
    
    item.once('done', (event, state) => {
      if (state === 'completed') {
        console.log('Download successfully');
      } else {
        console.log(`Download failed: ${state}`);
      }
    });
  });

  try {
    await hiddenWindow.loadURL(url);
    
    // Wait for the download button to appear and click it
    await hiddenWindow.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        let attempts = 0;
        const interval = setInterval(() => {
          attempts++;
          const btn = document.querySelector('a[aria-label="Download"], button[aria-label="Download"], .download-button, [class*="download"]');
          if (btn) {
            clearInterval(interval);
            btn.click();
            resolve(true);
          } else if (attempts > 20) {
            clearInterval(interval);
            reject(new Error("Download button not found"));
          }
        }, 500);
      });
    `);
    
    // Wait a bit for downloads to start
    await new Promise(r => setTimeout(r, 5000));
    
    // We don't close the hidden window immediately so downloads can finish
    // In a real app, we'd track active downloads
    
    return { success: true, message: 'Downloads started' };
  } catch (error: any) {
    hiddenWindow.close();
    return { success: false, error: error.message };
  }
});
