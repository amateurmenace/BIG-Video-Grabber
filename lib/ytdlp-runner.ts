import { spawn, ChildProcess } from "child_process";
import { getYtDlpPath } from "./ytdlp-manager.js";

export interface VideoFormat {
  format_id: string;
  ext: string;
  resolution: string;
  filesize: number | null;
  filesize_approx: number | null;
  vcodec: string;
  acodec: string;
  fps: number | null;
  tbr: number | null;
  format_note: string;
}

export interface VideoMetadata {
  title: string;
  duration: number | null;
  duration_string: string | null;
  thumbnail: string | null;
  uploader: string | null;
  upload_date: string | null;
  description: string | null;
  webpage_url: string;
  extractor: string;
  formats: VideoFormat[];
  filesize_approx: number | null;
}

export interface ProgressUpdate {
  percent: number;
  totalSize: string;
  speed: string;
  eta: string;
  fragment?: string;
}

export interface DownloadOptions {
  url: string;
  outputDir: string;
  formatId?: string;
  outputTemplate?: string;
  ytdlpPath?: string;
}

/**
 * Fast info fetch — gets just title, thumbnail, duration, uploader in ~1-2 seconds.
 * Does NOT resolve formats (that's slow). Use getVideoFormats() separately if needed.
 */
export async function getQuickInfo(url: string): Promise<Omit<VideoMetadata, 'formats'>> {
  const ytdlpPath = await getYtDlpPath();

  return new Promise((resolve, reject) => {
    const separator = '|||FIELD|||';
    const args = [
      "--print", `%(title)s${separator}%(thumbnail)s${separator}%(duration)s${separator}%(duration_string)s${separator}%(uploader)s${separator}%(webpage_url)s${separator}%(extractor)s`,
      "--no-download",
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout", "10",
      url,
    ];

    const proc = spawn(ytdlpPath, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }
      try {
        const parts = stdout.trim().split(separator);
        resolve({
          title: parts[0] && parts[0] !== 'NA' ? parts[0] : "Unknown",
          thumbnail: parts[1] && parts[1] !== 'NA' ? parts[1] : null,
          duration: parts[2] && parts[2] !== 'NA' ? parseFloat(parts[2]) : null,
          duration_string: parts[3] && parts[3] !== 'NA' ? parts[3] : null,
          uploader: parts[4] && parts[4] !== 'NA' ? parts[4] : null,
          upload_date: null,
          description: null,
          webpage_url: parts[5] && parts[5] !== 'NA' ? parts[5] : url,
          extractor: parts[6] && parts[6] !== 'NA' ? parts[6] : "generic",
          filesize_approx: null,
        });
      } catch (e) {
        reject(new Error(`Failed to parse yt-dlp output: ${(e as Error).message}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run yt-dlp: ${err.message}`));
    });
  });
}

/**
 * Full info fetch — resolves all formats. Slower (5-15 seconds).
 */
export async function getVideoInfo(url: string): Promise<VideoMetadata> {
  const ytdlpPath = await getYtDlpPath();

  return new Promise((resolve, reject) => {
    const args = [
      "--dump-json",
      "--no-download",
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout", "10",
      url,
    ];

    const proc = spawn(ytdlpPath, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }

      try {
        const raw = JSON.parse(stdout);
        const formats: VideoFormat[] = (raw.formats || [])
          .filter((f: any) => f.vcodec !== "none" || f.acodec !== "none")
          .map((f: any) => ({
            format_id: f.format_id,
            ext: f.ext,
            resolution: f.resolution || "audio only",
            filesize: f.filesize || null,
            filesize_approx: f.filesize_approx || null,
            vcodec: f.vcodec || "none",
            acodec: f.acodec || "none",
            fps: f.fps || null,
            tbr: f.tbr || null,
            format_note: f.format_note || "",
          }));

        resolve({
          title: raw.title || "Unknown",
          duration: raw.duration || null,
          duration_string: raw.duration_string || null,
          thumbnail: raw.thumbnail || null,
          uploader: raw.uploader || raw.channel || null,
          upload_date: raw.upload_date || null,
          description: raw.description || null,
          webpage_url: raw.webpage_url || url,
          extractor: raw.extractor || "generic",
          formats,
          filesize_approx: raw.filesize_approx || null,
        });
      } catch (e) {
        reject(new Error(`Failed to parse yt-dlp output: ${(e as Error).message}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run yt-dlp: ${err.message}`));
    });
  });
}

export async function downloadVideo(options: DownloadOptions): Promise<ChildProcess> {
  const ytdlpPath = options.ytdlpPath || await getYtDlpPath();
  const template = options.outputTemplate || "%(title)s.%(ext)s";

  const args = [
    "--newline",
    "--progress",
    "--no-warnings",
    "--no-playlist",
    "-o", `${options.outputDir}/${template}`,
  ];

  if (options.formatId) {
    args.push("-f", options.formatId);
  } else {
    // Prefer H.264+AAC (natively playable MP4), fall back to best available
    args.push("-f", "bv[vcodec~='^(avc|h264)']+ba[acodec~='^(mp4a|aac)']/bv[vcodec~='^(avc|h264)']+ba/bv*+ba/b");
  }

  // Merge into mp4 container; recode if source codecs aren't mp4-compatible
  args.push("--merge-output-format", "mp4");
  args.push("--postprocessor-args", "ffmpeg:-c:v copy -c:a aac -movflags +faststart");

  args.push(options.url);

  const proc = spawn(ytdlpPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  return proc;
}

/**
 * Parse a yt-dlp progress line into structured data.
 * Handles formats like:
 *   [download]  45.2% of ~  125.30MiB at  12.50MiB/s ETA 00:05
 *   [download]  45.2% of   125.30MiB at  12.50MiB/s ETA 00:05
 *   [download] 100% of 125.30MiB in 00:10
 */
export function parseProgressLine(line: string): ProgressUpdate | null {
  const trimmed = line.trim();

  // Match percentage-based progress
  const progressMatch = trimmed.match(
    /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\S+)\s+at\s+([\d.]+\s*\S+\/s)\s+ETA\s+(\S+)/
  );

  if (progressMatch) {
    return {
      percent: parseFloat(progressMatch[1]),
      totalSize: progressMatch[2].trim(),
      speed: progressMatch[3].trim(),
      eta: progressMatch[4],
    };
  }

  // Match completion line
  const doneMatch = trimmed.match(
    /\[download\]\s+100%\s+of\s+~?\s*([\d.]+\s*\S+)/
  );

  if (doneMatch) {
    return {
      percent: 100,
      totalSize: doneMatch[1].trim(),
      speed: "",
      eta: "00:00",
    };
  }

  // Match fragment-based progress (for DASH/HLS streams)
  const fragMatch = trimmed.match(
    /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\S+)\s+at\s+([\d.]+\s*\S+\/s)/
  );

  if (fragMatch) {
    return {
      percent: parseFloat(fragMatch[1]),
      totalSize: fragMatch[2].trim(),
      speed: fragMatch[3].trim(),
      eta: "unknown",
    };
  }

  return null;
}

/**
 * Get a simplified list of format choices for the UI.
 */
export function getSimplifiedFormats(formats: VideoFormat[]): { id: string; label: string }[] {
  const choices: { id: string; label: string }[] = [
    { id: "bv*+ba/b", label: "Best Quality" },
  ];

  // Find video formats with audio merged
  const resolutions = new Set<string>();
  for (const f of formats) {
    if (f.vcodec !== "none" && f.resolution && f.resolution !== "audio only") {
      const match = f.resolution.match(/(\d+)x(\d+)/);
      if (match) {
        const height = parseInt(match[2]);
        if (height >= 1080 && !resolutions.has("1080p")) {
          resolutions.add("1080p");
          choices.push({ id: "bv*[height<=1080]+ba/b[height<=1080]", label: "1080p (Full HD)" });
        } else if (height >= 720 && height < 1080 && !resolutions.has("720p")) {
          resolutions.add("720p");
          choices.push({ id: "bv*[height<=720]+ba/b[height<=720]", label: "720p (HD)" });
        } else if (height >= 480 && height < 720 && !resolutions.has("480p")) {
          resolutions.add("480p");
          choices.push({ id: "bv*[height<=480]+ba/b[height<=480]", label: "480p (SD)" });
        }
      }
    }
  }

  // Audio only
  const hasAudio = formats.some((f) => f.acodec !== "none");
  if (hasAudio) {
    choices.push({ id: "ba", label: "Audio Only" });
  }

  return choices;
}
