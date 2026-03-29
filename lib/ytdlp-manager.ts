import fs from "fs";
import path from "path";
import https from "https";
import { exec } from "child_process";

const NIGHTLY_BASE = "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download";
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getBinaryName(): string {
  if (process.platform === "win32") return "yt-dlp.exe";
  return "yt-dlp";
}

function getDownloadUrl(): string {
  if (process.platform === "win32") return `${NIGHTLY_BASE}/yt-dlp.exe`;
  if (process.platform === "darwin") return `${NIGHTLY_BASE}/yt-dlp_macos`;
  return `${NIGHTLY_BASE}/yt-dlp_linux`;
}

function getBinDir(): string {
  if (process.env.YTDLP_BIN_DIR) return process.env.YTDLP_BIN_DIR;
  if (process.versions.electron) {
    try {
      const { app } = require("electron");
      return path.join(app.getPath("userData"), "bin");
    } catch {
      // In renderer or server process, fall through
    }
  }
  return path.join(process.cwd(), "bin");
}

function getBinaryPath(): string {
  return path.join(getBinDir(), getBinaryName());
}

function getVersionFilePath(): string {
  return path.join(getBinDir(), "yt-dlp-version.txt");
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmpPath = destPath + ".tmp";
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const follow = (url: string, redirects: number) => {
      if (redirects > 5) {
        reject(new Error("Too many redirects"));
        return;
      }

      https.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location, redirects + 1);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }

        const file = fs.createWriteStream(tmpPath);
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            // Atomic rename
            fs.renameSync(tmpPath, destPath);
            resolve();
          });
        });
        file.on("error", (err) => {
          try { fs.unlinkSync(tmpPath); } catch {}
          reject(err);
        });
      }).on("error", (err) => {
        reject(err);
      });
    };

    follow(url, 0);
  });
}

let downloadPromise: Promise<string> | null = null;

export async function getYtDlpPath(): Promise<string> {
  // Allow override via environment
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return process.env.YTDLP_PATH;
  }

  const binaryPath = getBinaryPath();

  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  // Download if missing - deduplicate concurrent calls
  if (!downloadPromise) {
    downloadPromise = (async () => {
      try {
        console.log("yt-dlp binary not found, downloading nightly build...");
        await downloadFile(getDownloadUrl(), binaryPath);

        // Make executable on Unix
        if (process.platform !== "win32") {
          fs.chmodSync(binaryPath, 0o755);
        }

        // Write version file
        fs.writeFileSync(getVersionFilePath(), new Date().toISOString());
        console.log(`yt-dlp downloaded to ${binaryPath}`);
        return binaryPath;
      } finally {
        downloadPromise = null;
      }
    })();
  }

  return downloadPromise;
}

export async function updateYtDlp(): Promise<void> {
  const binaryPath = getBinaryPath();
  console.log("Updating yt-dlp nightly build...");

  // Remove existing binary so getYtDlpPath triggers fresh download
  if (fs.existsSync(binaryPath)) {
    fs.unlinkSync(binaryPath);
  }

  await downloadFile(getDownloadUrl(), binaryPath);

  if (process.platform !== "win32") {
    fs.chmodSync(binaryPath, 0o755);
  }

  fs.writeFileSync(getVersionFilePath(), new Date().toISOString());
  console.log("yt-dlp updated successfully");
}

export function checkForUpdate(): boolean {
  const versionFile = getVersionFilePath();
  if (!fs.existsSync(versionFile)) return true;

  try {
    const lastUpdate = new Date(fs.readFileSync(versionFile, "utf-8").trim());
    return Date.now() - lastUpdate.getTime() > UPDATE_INTERVAL_MS;
  } catch {
    return true;
  }
}

export function getYtDlpStatus(): { installed: boolean; path: string; lastUpdated: string | null } {
  const binaryPath = getBinaryPath();
  const versionFile = getVersionFilePath();
  const installed = fs.existsSync(binaryPath);
  let lastUpdated: string | null = null;

  if (fs.existsSync(versionFile)) {
    try {
      lastUpdated = fs.readFileSync(versionFile, "utf-8").trim();
    } catch {}
  }

  return { installed, path: binaryPath, lastUpdated };
}

export async function getYtDlpVersion(): Promise<string> {
  const ytdlpPath = await getYtDlpPath();
  return new Promise((resolve, reject) => {
    exec(`"${ytdlpPath}" --version`, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
