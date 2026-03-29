import express from "express";
import path from "path";
import fs from "fs";
import puppeteer from "puppeteer";
import { exec } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { fileURLToPath } from 'url';
import { getYtDlpPath, getYtDlpStatus, updateYtDlp, checkForUpdate, getYtDlpVersion } from './lib/ytdlp-manager.js';
import { getVideoInfo, downloadVideo, parseProgressLine, getSimplifiedFormats } from './lib/ytdlp-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let ffmpegPath = ffmpegInstaller.path;
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

if (process.env.FFMPEG_PATH) {
  ffmpegPath = process.env.FFMPEG_PATH;
  ffmpeg.setFfmpegPath(ffmpegPath);
  console.log(`Using custom FFmpeg path: ${ffmpegPath}`);
} else {
  ffmpeg.setFfmpegPath(ffmpegPath);
  console.log(`Using FFmpeg path: ${ffmpegPath}`);
}

const testEncoder = (encoder: string): Promise<boolean> => {
  return new Promise((resolve) => {
    // Run a very fast dummy encode to test if the hardware encoder actually works on this machine
    const command = `"${ffmpegPath}" -f lavfi -i color=size=128x128:rate=1:duration=0.1 -c:v ${encoder} -f null -`;
    exec(command, (error) => {
      if (error) {
        console.log(`Encoder ${encoder} failed to initialize (likely missing hardware/drivers).`);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
};

const getBestEncoderOptions = (speed: string = 'medium', compression: string = 'medium'): Promise<string[]> => {
  return new Promise((resolve) => {
    ffmpeg.getAvailableEncoders(async (err, encoders) => {
      let cpuPreset = speed; // 'ultrafast', 'fast', 'medium', 'slow'
      let cpuCrf = '22';
      let hwPreset = speed === 'medium' ? 'fast' : speed; // HW presets often don't have 'medium'
      let hwBitrate = '5000k';

      if (compression === 'low') {
        cpuCrf = '18';
        hwBitrate = '8000k';
      } else if (compression === 'high') {
        cpuCrf = '28';
        hwBitrate = '2500k';
      }

      if (err || !encoders) {
        console.log("Could not probe encoders, falling back to libx264 (CPU)");
        return resolve(['-c:v', 'libx264', '-preset', cpuPreset, '-crf', cpuCrf]);
      }
      
      // Check for hardware encoders in order of preference
      if (encoders['h264_nvenc'] && await testEncoder('h264_nvenc')) {
        console.log("Using NVIDIA Hardware Acceleration (h264_nvenc)");
        return resolve(['-c:v', 'h264_nvenc', '-preset', hwPreset, '-b:v', hwBitrate]);
      }
      if (encoders['h264_videotoolbox'] && await testEncoder('h264_videotoolbox')) {
        console.log("Using Apple Hardware Acceleration (h264_videotoolbox)");
        return resolve(['-c:v', 'h264_videotoolbox', '-b:v', hwBitrate]);
      }
      if (encoders['h264_qsv'] && await testEncoder('h264_qsv')) {
        console.log("Using Intel Quick Sync Hardware Acceleration (h264_qsv)");
        return resolve(['-c:v', 'h264_qsv', '-preset', hwPreset, '-b:v', hwBitrate]);
      }
      if (encoders['h264_amf'] && await testEncoder('h264_amf')) {
        console.log("Using AMD Hardware Acceleration (h264_amf)");
        return resolve(['-c:v', 'h264_amf', '-b:v', hwBitrate]);
      }
      
      // Fallback
      console.log("No hardware encoders found or supported, falling back to libx264 (CPU)");
      return resolve(['-c:v', 'libx264', '-preset', cpuPreset, '-crf', cpuCrf]);
    });
  });
};

export async function startServer(): Promise<{ server: any, port: number }> {
  const app = express();
  const isElectron = !!process.versions.electron;
  const PORT = isElectron ? 0 : parseInt(process.env.PORT || "3000", 10);

  app.use(express.json());

  // Activity log system — ring buffer of recent events
  const activityLog: { timestamp: string; type: string; message: string; detail?: string }[] = [];
  const MAX_LOG_ENTRIES = 200;

  function addLog(type: string, message: string, detail?: string) {
    const entry = { timestamp: new Date().toISOString(), type, message, detail };
    activityLog.push(entry);
    if (activityLog.length > MAX_LOG_ENTRIES) activityLog.shift();
    console.log(`[${type}] ${message}${detail ? ' — ' + detail : ''}`);
  }

  addLog('system', 'BIG Video Grabber server started');

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/activity-log", (req, res) => {
    const since = req.query.since as string | undefined;
    if (since) {
      const filtered = activityLog.filter(e => e.timestamp > since);
      res.json({ entries: filtered });
    } else {
      // Return last 50 entries
      res.json({ entries: activityLog.slice(-50) });
    }
  });

  app.get("/api/default-directory", async (req, res) => {
    if (process.versions.electron) {
      try {
        const { app: electronApp } = await import('electron');
        res.json({ path: electronApp.getPath('downloads') });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    } else {
      res.json({ path: path.resolve(process.cwd(), "downloads") });
    }
  });

  app.get("/api/choose-directory", async (req, res) => {
    if (process.versions.electron) {
      try {
        const { dialog } = await import('electron');
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory']
        });
        if (!result.canceled && result.filePaths.length > 0) {
          res.json({ path: result.filePaths[0] });
        } else {
          res.json({ canceled: true });
        }
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    } else {
      res.status(400).json({ error: "Not running in Electron. Cannot open native dialog." });
    }
  });

  app.post("/api/open-folder", (req, res) => {
    const { downloadPath: reqDownloadPath } = req.body;
    const downloadPath = reqDownloadPath ? path.resolve(process.cwd(), reqDownloadPath) : path.resolve(process.cwd(), "downloads");
    
    if (!fs.existsSync(downloadPath)) {
      return res.status(400).json({ error: "Folder does not exist yet. Try downloading a video first." });
    }

    let command = '';
    switch (process.platform) {
      case 'darwin': command = `open "${downloadPath}"`; break;
      case 'win32': command = `explorer "${downloadPath}"`; break;
      default: command = `xdg-open "${downloadPath}"`; break;
    }

    exec(command, (error) => {
      if (error) {
        console.error("Error opening folder:", error);
        return res.status(500).json({ error: "Failed to open folder" });
      }
      res.json({ success: true });
    });
  });

  const activeConversions = new Map<string, number>();
  const conversionErrors = new Map<string, string>();
  const conversionDetails = new Map<string, { fps: number | null; speed: string | null; timeElapsed: string | null; currentTime: string | null; bitrate: string | null; size: string | null }>();
  const conversionLogs = new Map<string, string[]>();
  const conversionQueue: { inputPath: string, outputPath: string, filename: string, speed: string, compression: string, resolution?: string, framerate?: string, normalize_audio?: boolean }[] = [];
  let isConverting = false;

  const processConversionQueue = async () => {
    if (isConverting || conversionQueue.length === 0) return;
    isConverting = true;

    const task = conversionQueue.shift();
    if (!task) {
      isConverting = false;
      return;
    }

    const { inputPath, outputPath, filename, speed, compression, resolution = '1920:1080', framerate = '30000/1001', normalize_audio = false } = task;
    activeConversions.set(inputPath, 0);
    conversionErrors.delete(inputPath);
    conversionLogs.set(inputPath, []);
    conversionDetails.set(inputPath, { fps: null, speed: null, timeElapsed: null, currentTime: null, bitrate: null, size: null });

    const [resW, resH] = resolution.split(':');
    const resLabel = `${resW}x${resH}`;
    const fpsLabel = framerate === '30000/1001' ? '29.97' : framerate === '24000/1001' ? '23.976' : framerate;
    addLog('conversion', `Starting conversion: ${filename}`, `Speed: ${speed}, Quality: ${compression} → ${resLabel} ${fpsLabel}fps${normalize_audio ? ' +loudnorm' : ''}`);

    const encoderOptions = await getBestEncoderOptions(speed, compression);
    addLog('conversion', `Encoder selected for ${filename}`, encoderOptions.join(' '));

    // Build video filter chain
    const vfParts = [`scale=${resW}:${resH}:force_original_aspect_ratio=decrease,pad=${resW}:${resH}:(ow-iw)/2:(oh-ih)/2`];
    const vf = vfParts.join(',');

    // Build audio filter chain
    const audioFilters: string[] = [];
    if (normalize_audio) {
      audioFilters.push('loudnorm=I=-24:TP=-2:LRA=7');
    }

    const outputOptions = [
      '-y',
      '-vf', vf,
      '-r', framerate,
      '-pix_fmt', 'yuv420p',
      ...encoderOptions,
      '-c:a', 'aac',
      '-ar', '48000',
      '-b:a', '192k',
    ];
    if (audioFilters.length > 0) {
      outputOptions.push('-af', audioFilters.join(','));
    }

    ffmpeg(inputPath)
      .outputOptions(outputOptions)
      .on('start', (commandLine) => {
        addLog('ffmpeg', `FFmpeg started for ${filename}`, commandLine);
        conversionLogs.set(inputPath, [`$ ${commandLine}`]);
      })
      .on('stderr', (stderrLine) => {
        const logs = conversionLogs.get(inputPath) || [];
        logs.push(stderrLine);
        if (logs.length > 100) logs.shift();
        conversionLogs.set(inputPath, logs);
      })
      .on('progress', (progress: any) => {
        if (progress.percent) {
          activeConversions.set(inputPath, progress.percent);
        }
        conversionDetails.set(inputPath, {
          fps: progress.currentFps || null,
          speed: progress.speed ? String(progress.speed) : null,
          timeElapsed: progress.timemark || null,
          currentTime: progress.targetSize ? `${(progress.targetSize / 1024).toFixed(1)} MB` : null,
          bitrate: progress.currentKbps ? `${progress.currentKbps} kbps` : null,
          size: progress.targetSize ? `${(progress.targetSize / 1024).toFixed(1)} MB` : null,
        });
      })
      .save(outputPath)
      .on('end', () => {
        addLog('conversion', `Conversion completed: ${filename}`, `Output: ${path.basename(outputPath)}`);
        activeConversions.delete(inputPath);
        conversionDetails.delete(inputPath);
        isConverting = false;
        processConversionQueue();
      })
      .on('error', (err, stdout, stderr) => {
        addLog('error', `Conversion failed: ${filename}`, err.message);
        if (stderr) console.error(`ffmpeg stderr:\n${stderr}`);
        
        // Extract a more meaningful error message from stderr if possible
        let errorMsg = err.message;
        if (stderr) {
          const lines = stderr.split('\n');
          const lastErrorLine = lines.reverse().find((l: string) => l.toLowerCase().includes('error') || l.includes('Invalid'));
          if (lastErrorLine) {
            errorMsg = `${err.message} - ${lastErrorLine.trim()}`;
          }
        }
        
        conversionErrors.set(inputPath, errorMsg);
        activeConversions.delete(inputPath);
        isConverting = false;
        processConversionQueue();
      });
  };

  const activeDownloads = new Map<string, any>();
  const downloadQueue: { url: string, downloadPath: string, taskId: string }[] = [];
  let activeDownloadCount = 0;
  const MAX_CONCURRENT_DOWNLOADS = 2;

  const processDownloadQueue = async () => {
    if (activeDownloadCount >= MAX_CONCURRENT_DOWNLOADS || downloadQueue.length === 0) return;
    activeDownloadCount++;

    const task = downloadQueue.shift();
    if (!task) {
      activeDownloadCount--;
      return;
    }

    const { url, downloadPath, taskId } = task;
    const dl = activeDownloads.get(taskId);
    if (dl) dl.state = 'starting';

    addLog('download', `Starting Zoom download`, url);

    let browser: any = null;
    try {
      browser = await puppeteer.launch({ 
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
      });
      
      const page = await browser.newPage();
      const client = await page.target().createCDPSession();
      
      await client.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath,
        eventsEnabled: true
      });

      let currentGuid = '';
      let mp4Guid = '';

      client.on('Browser.downloadWillBegin', async (event: any) => {
        if (event.suggestedFilename.toLowerCase().endsWith('.mp4')) {
          mp4Guid = event.guid;
          currentGuid = event.guid;
          const dl = activeDownloads.get(taskId);
          if (dl) {
            dl.filename = event.suggestedFilename;
            dl.state = 'inProgress';
          }
          addLog('download', `Zoom download started: ${event.suggestedFilename}`);
        }
      });

      client.on('Browser.downloadProgress', (event: any) => {
        if (event.guid === mp4Guid) {
          const dl = activeDownloads.get(taskId);
          if (dl) {
            dl.received = event.receivedBytes;
            dl.total = event.totalBytes;
            dl.state = event.state;
            if (event.totalBytes > 0) {
              dl.percent = (event.receivedBytes / event.totalBytes) * 100;
            }
            if (event.state === 'completed' || event.state === 'canceled') {
              addLog('download', `Zoom download ${event.state}: ${dl.filename}`);
              setTimeout(() => {
                if (browser) browser.close().catch(() => {});
                activeDownloadCount--;
                processDownloadQueue();
              }, 2000);
            }
          }
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const hasPasscode = await page.evaluate(() => !!document.querySelector('input[type="password"], input[name="password"]'));
      if (hasPasscode) {
        throw new Error("Zoom recording requires a passcode");
      }

      // Handle Zoom's recording disclaimer if present
      try {
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const agreeBtn = buttons.find(b => {
            const text = b.textContent?.toLowerCase() || '';
            return text.includes('agree') || text.includes('continue');
          });
          if (agreeBtn) {
            (agreeBtn as HTMLElement).click();
          }
        });
        // Give it a moment to transition if a button was clicked
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        // Ignore errors here, the button might not exist
      }

      try {
        const downloadBtnSelector = 'a[aria-label="Download"], button[aria-label="Download"], .download-button, [class*="download"]';
        await page.waitForSelector(downloadBtnSelector, { timeout: 10000 });
        await page.click(downloadBtnSelector);
      } catch (e) {
        console.log("Primary selector failed, trying fallback text search...");
        const clicked = await page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('a, button, div[role="button"]'));
          const downloadEl = elements.find(el => {
            const text = el.textContent?.toLowerCase() || '';
            return text.includes('download') && !text.includes('app');
          });
          if (downloadEl) {
            (downloadEl as HTMLElement).click();
            return true;
          }
          return false;
        });
        if (!clicked) {
          throw new Error("Could not find download button on page");
        }
      }

      // Wait a bit to ensure download starts
      await new Promise(r => setTimeout(r, 15000));
      
      const checkDl = activeDownloads.get(taskId);
      if (checkDl && (checkDl.state === 'starting' || checkDl.state === 'queued')) {
        throw new Error("Download did not start within 15 seconds");
      }
      
      // We don't close the browser here, the downloadProgress event handler will close it when completed
      
    } catch (err: any) {
      addLog('error', `Zoom download failed`, err.message);
      const dl = activeDownloads.get(taskId);
      if (dl) {
        dl.state = 'error';
        dl.error = err.message;
      }
      if (browser) browser.close().catch(() => {});
      activeDownloadCount--;
      processDownloadQueue();
    }
  };

  app.get("/api/downloads/status", (req, res) => {
    res.json({ downloads: Array.from(activeDownloads.values()) });
  });

  app.post("/api/downloads/clear", (req, res) => {
    for (const [taskId, dl] of activeDownloads.entries()) {
      if (dl.state === 'completed' || dl.state === 'error' || dl.state === 'canceled' || dl.state === 'timeout') {
        activeDownloads.delete(taskId);
      }
    }
    res.json({ success: true });
  });

  app.post("/api/open-folder", (req, res) => {
    const { folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: "Invalid path" });
    }
    
    const resolvedPath = path.resolve(process.cwd(), folderPath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: "Folder not found" });
    }

    let command = '';
    if (process.platform === 'win32') {
      command = `start "" "${resolvedPath}"`;
    } else if (process.platform === 'darwin') {
      command = `open "${resolvedPath}"`;
    } else {
      command = `xdg-open "${resolvedPath}"`;
    }

    require('child_process').exec(command, (error: any) => {
      if (error) {
        console.error("Failed to open folder:", error);
        return res.status(500).json({ error: "Failed to open folder" });
      }
      res.json({ success: true });
    });
  });

  app.post("/api/files", (req, res) => {
    const { downloadPath: reqDownloadPath } = req.body;
    const downloadPath = reqDownloadPath ? path.resolve(process.cwd(), reqDownloadPath) : path.resolve(process.cwd(), "downloads");
    
    if (!fs.existsSync(downloadPath)) {
      return res.json({ files: [] });
    }

    try {
      const allFiles = fs.readdirSync(downloadPath);
      const videoFiles = allFiles.filter(f => 
        (f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.avi') || f.endsWith('.mov')) && 
        !f.endsWith('.crdownload')
      );
      
      // Build a set of output paths currently being written by FFmpeg
      const activeOutputPaths = new Set<string>();
      for (const task of conversionQueue) {
        activeOutputPaths.add(task.outputPath);
      }
      // Also check the currently converting file's output path
      for (const [inputPath] of activeConversions) {
        const ext = path.extname(inputPath);
        const base = path.basename(inputPath, ext);
        activeOutputPaths.add(path.join(downloadPath, `${base}_broadcast.mp4`));
      }

      const fileDetails = videoFiles
        .filter(f => {
          // Exclude broadcast files that are still being written
          const filePath = path.join(downloadPath, f);
          if (f.includes('_broadcast') && activeOutputPaths.has(filePath)) {
            return false;
          }
          return true;
        })
        .map(f => {
          const filePath = path.join(downloadPath, f);
          const stats = fs.statSync(filePath);
          const isQueued = conversionQueue.some(t => t.inputPath === filePath);
          const isConvertingNow = activeConversions.has(filePath);

          return {
            name: f,
            size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
            isConverting: isConvertingNow || isQueued,
            conversionProgress: isConvertingNow ? activeConversions.get(filePath) : (isQueued ? 0 : null),
            isQueued,
            error: conversionErrors.get(filePath) || null,
            logs: conversionLogs.get(filePath) || [],
            conversionDetail: isConvertingNow ? conversionDetails.get(filePath) || null : null,
          };
        });

      res.json({ files: fileDetails });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/convert", async (req, res) => {
    const {
      filename,
      downloadPath: reqDownloadPath,
      speed = 'medium',
      compression = 'medium',
      resolution = '1920:1080',
      framerate = '30000/1001',
      normalize_audio = false,
      outputSuffix = '_broadcast',
    } = req.body;
    const downloadPath = reqDownloadPath ? path.resolve(process.cwd(), reqDownloadPath) : path.resolve(process.cwd(), "downloads");

    const inputPath = path.join(downloadPath, filename);
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    const outputPath = path.join(downloadPath, `${base}${outputSuffix}.mp4`);

    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: "File not found" });
    }
    if (activeConversions.has(inputPath) || conversionQueue.some(t => t.inputPath === inputPath)) {
      return res.status(400).json({ error: "Already converting or queued this file" });
    }

    conversionQueue.push({ inputPath, outputPath, filename, speed, compression, resolution, framerate, normalize_audio });
    processConversionQueue();

    res.json({ success: true, message: "Conversion queued." });
  });

  // Convert an external file (drag-and-drop) — accepts absolute path
  app.post("/api/convert-external", async (req, res) => {
    const {
      filePath: rawPath,
      outputDir: rawOutputDir,
      speed = 'medium',
      compression = 'medium',
      resolution = '1920:1080',
      framerate = '30000/1001',
      normalize_audio = false,
    } = req.body;

    if (!rawPath) return res.status(400).json({ error: "filePath is required" });

    const inputPath = path.resolve(rawPath);
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: "File not found: " + inputPath });
    }

    const outputDir = rawOutputDir ? path.resolve(rawOutputDir) : path.dirname(inputPath);
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);
    const outputPath = path.join(outputDir, `${base}_broadcast.mp4`);
    const filename = path.basename(inputPath);

    if (activeConversions.has(inputPath) || conversionQueue.some(t => t.inputPath === inputPath)) {
      return res.status(400).json({ error: "Already converting or queued this file" });
    }

    conversionQueue.push({ inputPath, outputPath, filename, speed, compression, resolution, framerate, normalize_audio });
    processConversionQueue();
    addLog('conversion', `External file queued: ${filename}`, inputPath);

    res.json({ success: true, message: "Conversion queued.", filename });
  });

  // Automation schedule endpoints
  const automationSchedules = new Map<string, {
    id: string;
    name: string;
    enabled: boolean;
    cronDay: string; // 'friday', 'monday', etc.
    cronTime: string; // '18:00'
    lookbackDays: number;
    autoConvert: boolean;
    outputFolder: string;
    speed: string;
    compression: string;
    lastRun: string | null;
    lastResult: string | null;
  }>();

  let automationInterval: any = null;

  const checkAutomationSchedules = () => {
    const now = new Date();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDay = dayNames[now.getDay()];
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    for (const [id, schedule] of automationSchedules) {
      if (!schedule.enabled) continue;
      if (schedule.cronDay !== currentDay) continue;
      if (schedule.cronTime !== currentTime) continue;
      // Check if already ran this minute
      if (schedule.lastRun) {
        const lastRunTime = new Date(schedule.lastRun).getTime();
        if (now.getTime() - lastRunTime < 120000) continue; // skip if ran within 2 min
      }

      addLog('automation', `Running scheduled job: ${schedule.name}`);
      runAutomation(schedule);
    }
  };

  const runAutomation = async (schedule: any) => {
    schedule.lastRun = new Date().toISOString();
    schedule.lastResult = 'running';

    try {
      // Ensure output folder exists
      if (!fs.existsSync(schedule.outputFolder)) {
        fs.mkdirSync(schedule.outputFolder, { recursive: true });
      }

      // Fetch meetings from the last N days
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - schedule.lookbackDays);
      const startStr = startDate.toISOString().split("T")[0] + "T00:00:00Z";
      const endStr = endDate.toISOString().split("T")[0] + "T23:59:59Z";

      addLog('automation', `Fetching meetings from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`);

      let url: string | null = `https://brooklinema.api.civicclerk.com/v1/events?$filter=eventDate ge ${startStr} and eventDate le ${endStr}`;
      let allEvents: any[] = [];

      while (url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error("CivicClerk API error");
        const data = await res.json() as any;
        allEvents = allEvents.concat(data.value);
        url = data['@odata.nextLink'] || null;
      }

      const zoomEvents = allEvents.filter(
        (e: any) => e.externalMediaUrl && e.externalMediaUrl.toLowerCase().includes("zoom")
      );

      addLog('automation', `Found ${zoomEvents.length} meetings with recordings`);

      if (zoomEvents.length === 0) {
        schedule.lastResult = 'No meetings found';
        return;
      }

      // Queue downloads for each meeting
      let queued = 0;
      for (const event of zoomEvents) {
        const eventUrl = event.externalMediaUrl;
        const taskId = `auto_${Math.random().toString(36).substring(7)}`;
        activeDownloads.set(taskId, {
          id: taskId, url: eventUrl, filename: `${event.eventName || 'Meeting'}.mp4`,
          received: 0, total: 0, state: 'queued', percent: 0, type: 'automation'
        });
        downloadQueue.push({ url: eventUrl, downloadPath: schedule.outputFolder, taskId });
        queued++;
      }
      processDownloadQueue();

      addLog('automation', `Queued ${queued} meeting downloads to ${schedule.outputFolder}`);

      // If autoConvert, watch for completions and queue conversions
      if (schedule.autoConvert) {
        const checkAndConvert = () => {
          const autoDownloads = Array.from(activeDownloads.values()).filter(d => d.type === 'automation');
          const completed = autoDownloads.filter(d => d.state === 'completed');
          const pending = autoDownloads.filter(d => d.state !== 'completed' && d.state !== 'error');

          for (const dl of completed) {
            if (dl.filename && !dl._convertQueued) {
              const filePath = path.join(schedule.outputFolder, dl.filename);
              if (fs.existsSync(filePath)) {
                const ext2 = path.extname(dl.filename);
                const base2 = path.basename(dl.filename, ext2);
                const outputPath2 = path.join(schedule.outputFolder, `${base2}_broadcast.mp4`);

                if (!activeConversions.has(filePath) && !conversionQueue.some(t => t.inputPath === filePath)) {
                  conversionQueue.push({
                    inputPath: filePath, outputPath: outputPath2, filename: dl.filename,
                    speed: schedule.speed, compression: schedule.compression,
                    resolution: '1920:1080', framerate: '30000/1001', normalize_audio: false,
                  });
                  processConversionQueue();
                  addLog('automation', `Auto-queued conversion: ${dl.filename}`);
                }
                dl._convertQueued = true;
              }
            }
          }

          if (pending.length > 0) {
            setTimeout(checkAndConvert, 10000);
          } else {
            schedule.lastResult = `Completed: ${completed.length} downloaded, ${completed.filter((d: any) => d._convertQueued).length} queued for conversion`;
            addLog('automation', `Schedule "${schedule.name}" finished: ${schedule.lastResult}`);
          }
        };
        setTimeout(checkAndConvert, 15000);
      } else {
        schedule.lastResult = `Queued ${queued} downloads`;
      }

    } catch (err: any) {
      schedule.lastResult = `Error: ${err.message}`;
      addLog('error', `Automation "${schedule.name}" failed`, err.message);
    }
  };

  // Start the automation checker (runs every minute)
  automationInterval = setInterval(checkAutomationSchedules, 60000);

  app.get("/api/automation/schedules", (req, res) => {
    res.json({ schedules: Array.from(automationSchedules.values()) });
  });

  app.post("/api/automation/schedules", (req, res) => {
    const { name, cronDay, cronTime, lookbackDays = 7, autoConvert = true, outputFolder, speed = 'medium', compression = 'medium' } = req.body;
    if (!name || !cronDay || !cronTime || !outputFolder) {
      return res.status(400).json({ error: "name, cronDay, cronTime, and outputFolder are required" });
    }

    const id = Math.random().toString(36).substring(7);
    const schedule = {
      id, name, enabled: true, cronDay, cronTime,
      lookbackDays, autoConvert, outputFolder: path.resolve(outputFolder),
      speed, compression, lastRun: null, lastResult: null,
    };
    automationSchedules.set(id, schedule);
    addLog('automation', `Schedule created: ${name}`, `${cronDay} at ${cronTime}`);
    res.json({ success: true, schedule });
  });

  app.post("/api/automation/schedules/:id/toggle", (req, res) => {
    const schedule = automationSchedules.get(req.params.id);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    schedule.enabled = !schedule.enabled;
    addLog('automation', `Schedule "${schedule.name}" ${schedule.enabled ? 'enabled' : 'disabled'}`);
    res.json({ success: true, schedule });
  });

  app.delete("/api/automation/schedules/:id", (req, res) => {
    const schedule = automationSchedules.get(req.params.id);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    automationSchedules.delete(req.params.id);
    addLog('automation', `Schedule deleted: ${schedule.name}`);
    res.json({ success: true });
  });

  app.post("/api/automation/schedules/:id/run", (req, res) => {
    const schedule = automationSchedules.get(req.params.id);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    addLog('automation', `Manually triggered: ${schedule.name}`);
    runAutomation(schedule);
    res.json({ success: true, message: "Automation started" });
  });

  app.post("/api/download", async (req, res) => {
    const { url, downloadPath: reqDownloadPath } = req.body;
    if (!url || !url.includes("zoom")) {
      return res.status(400).json({ error: "Invalid Zoom URL" });
    }

    const downloadPath = reqDownloadPath ? path.resolve(process.cwd(), reqDownloadPath) : path.resolve(process.cwd(), "downloads");
    if (!fs.existsSync(downloadPath)) {
      try {
        fs.mkdirSync(downloadPath, { recursive: true });
      } catch (e: any) {
        return res.status(400).json({ error: `Could not create directory: ${e.message}` });
      }
    }

    const taskId = Math.random().toString(36).substring(7);
    activeDownloads.set(taskId, { id: taskId, url, filename: 'Queued...', received: 0, total: 0, state: 'queued', percent: 0 });

    downloadQueue.push({ url, downloadPath, taskId });
    processDownloadQueue();

    res.json({ success: true, taskId, message: "Download queued" });
  });

  // yt-dlp endpoints
  const ytdlpDownloads = new Map<string, any>();

  // Initialize yt-dlp binary on server start
  getYtDlpPath().then(p => {
    console.log(`yt-dlp binary ready at: ${p}`);
    // Check for updates if stale
    if (checkForUpdate()) {
      updateYtDlp().then(() => console.log("yt-dlp updated to latest nightly")).catch(e => console.error("yt-dlp update failed:", e.message));
    }
  }).catch(e => console.error("yt-dlp initialization failed:", e.message));

  app.get("/api/ytdlp-status", async (req, res) => {
    try {
      const status = getYtDlpStatus();
      let version: string | null = null;
      if (status.installed) {
        try {
          version = await getYtDlpVersion();
        } catch {}
      }
      res.json({ ...status, version });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ytdlp-update", async (req, res) => {
    try {
      await updateYtDlp();
      const version = await getYtDlpVersion();
      res.json({ success: true, version });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ytdlp-info", async (req, res) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const metadata = await getVideoInfo(url);
      const formatChoices = getSimplifiedFormats(metadata.formats);
      res.json({ ...metadata, formatChoices });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ytdlp-download", async (req, res) => {
    const { url, downloadPath: reqDownloadPath, formatId } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    const dlPath = reqDownloadPath ? path.resolve(process.cwd(), reqDownloadPath) : path.resolve(process.cwd(), "downloads");
    if (!fs.existsSync(dlPath)) {
      try {
        fs.mkdirSync(dlPath, { recursive: true });
      } catch (e: any) {
        return res.status(400).json({ error: `Could not create directory: ${e.message}` });
      }
    }

    const taskId = Math.random().toString(36).substring(7);
    const dlState = {
      id: taskId,
      url,
      type: 'ytdlp',
      filename: 'Fetching info...',
      percent: 0,
      speed: '',
      eta: '',
      totalSize: '',
      state: 'starting',
      error: null as string | null,
    };
    ytdlpDownloads.set(taskId, dlState);
    // Also add to activeDownloads for unified status
    activeDownloads.set(taskId, dlState);

    // Start download asynchronously
    (async () => {
      try {
        addLog('download', `Fetching video info`, url);
        let title = 'video';
        try {
          const info = await getVideoInfo(url);
          title = info.title || 'video';
          dlState.filename = title;
          addLog('download', `Video info received: ${title}`, info.duration_string ? `Duration: ${info.duration_string}` : undefined);
        } catch {
          dlState.filename = 'video';
          addLog('download', `Could not fetch metadata, downloading directly`, url);
        }

        dlState.state = 'inProgress';
        addLog('download', `Starting yt-dlp download: ${title}`);

        const proc = await downloadVideo({
          url,
          outputDir: dlPath,
          formatId: formatId || undefined,
        });

        proc.stdout?.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            const progress = parseProgressLine(line);
            if (progress) {
              dlState.percent = progress.percent;
              dlState.speed = progress.speed;
              dlState.eta = progress.eta;
              dlState.totalSize = progress.totalSize;
            }
            // Detect destination filename
            const destMatch = line.match(/\[download\] Destination:\s+(.+)/);
            if (destMatch) {
              dlState.filename = path.basename(destMatch[1].trim());
            }
            // Detect merge
            const mergeMatch = line.match(/\[Merger\] Merging formats into "(.+)"/);
            if (mergeMatch) {
              dlState.filename = path.basename(mergeMatch[1].trim());
            }
            // Detect already downloaded
            const alreadyMatch = line.match(/\[download\] (.+) has already been downloaded/);
            if (alreadyMatch) {
              dlState.filename = path.basename(alreadyMatch[1].trim());
              dlState.percent = 100;
              dlState.state = 'completed';
            }
          }
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const text = data.toString().trim();
          if (text) addLog('ytdlp', text);
        });

        proc.on('close', (code: number | null) => {
          if (code === 0) {
            dlState.state = 'completed';
            dlState.percent = 100;
            addLog('download', `Download completed: ${dlState.filename}`);
          } else if (dlState.state !== 'completed') {
            dlState.state = 'error';
            dlState.error = `yt-dlp exited with code ${code}`;
            addLog('error', `Download failed: ${dlState.filename}`, `Exit code ${code}`);
          }
        });

        proc.on('error', (err: Error) => {
          dlState.state = 'error';
          dlState.error = err.message;
          addLog('error', `Download error: ${dlState.filename}`, err.message);
        });

      } catch (e: any) {
        dlState.state = 'error';
        dlState.error = e.message;
        addLog('error', `Download failed`, e.message);
      }
    })();

    res.json({ success: true, taskId, message: "Download started" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production" && !process.versions.electron) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const rootPath = __dirname.includes('dist-server') ? path.join(__dirname, '..') : process.cwd();
    const distPath = path.join(rootPath, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      const address = server.address();
      const actualPort = typeof address === 'string' ? PORT : address?.port || PORT;
      console.log(`Server running on http://localhost:${actualPort}`);
      resolve({ server, port: actualPort });
    });

    server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} is in use, trying a random port...`);
        const fallbackServer = app.listen(0, "0.0.0.0", () => {
          const address = fallbackServer.address();
          const actualPort = typeof address === 'string' ? 0 : address?.port || 0;
          console.log(`Server running on http://localhost:${actualPort}`);
          resolve({ server: fallbackServer, port: actualPort });
        });
      } else {
        reject(e);
      }
    });
  });
}

if (!process.versions.electron) {
  startServer();
}
