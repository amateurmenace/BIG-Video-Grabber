# Brookline Meetings Downloader

This application allows users to search for, download, and convert Zoom recordings of public meetings from the Town of Brookline. It is built as a hybrid web application that can run both in a browser (with a local Node.js backend) or as a standalone desktop application using Electron.

## Architecture Overview

The application consists of two main parts:

1.  **Frontend (React + Vite + Tailwind CSS):**
    *   Provides the user interface for searching meetings, managing downloads, and initiating conversions.
    *   Communicates with the backend via REST API calls.
    *   Uses `shadcn/ui` for accessible and customizable components.
    *   Fetches meeting data directly from the CivicClerk API.

2.  **Backend (Node.js + Express):**
    *   Serves the frontend application.
    *   Handles file system operations (listing files, opening folders).
    *   Manages the download process using Puppeteer to navigate Zoom's web interface and extract the direct video URL.
    *   Manages the conversion process using `fluent-ffmpeg` to convert downloaded videos to a standard broadcast format.

## Key Technologies

*   **React:** Frontend library for building the user interface.
*   **Vite:** Fast build tool and development server.
*   **Tailwind CSS:** Utility-first CSS framework for styling.
*   **shadcn/ui:** Reusable UI components built on Radix UI and Tailwind.
*   **Express:** Web framework for the Node.js backend.
*   **Puppeteer:** Headless Chrome Node.js API used to automate the Zoom download process.
*   **fluent-ffmpeg:** Node.js wrapper for FFmpeg, used for video conversion.
*   **@ffmpeg-installer/ffmpeg:** Provides a cross-platform FFmpeg binary, ensuring the app works without requiring the user to install FFmpeg manually.
*   **Electron:** Framework for building cross-platform desktop applications using web technologies.

## How It Works

### 1. Searching Meetings
The frontend fetches data from the `brooklinema.api.civicclerk.com` API based on the selected date range. It filters the results to only include meetings that have an `externalMediaUrl` pointing to a Zoom recording.

### 2. Downloading Videos
When a user clicks "Download" or "Queue Downloads", the frontend sends a request to the backend's `/api/download` endpoint.
1.  The backend adds the download task to a queue to prevent spawning too many concurrent headless browsers (which could crash the app).
2.  The `processDownloadQueue` function processes up to 2 downloads concurrently.
3.  It uses Puppeteer to open a headless browser instance.
4.  It navigates to the provided Zoom URL.
5.  It waits for the video element to load and extracts the direct `.mp4` source URL.
6.  It initiates a download of the `.mp4` file via Chrome's built-in download manager, saving it to the specified download directory.
7.  Progress is tracked and sent back to the frontend via the `/api/downloads/status` endpoint.

### 3. Converting Videos
When a user clicks "Convert to Broadcast" or "Queue Conversions", the frontend sends a request to the `/api/convert` endpoint.
1.  The backend adds the file to a conversion queue. This ensures that only one heavy video conversion runs at a time, preventing system lockups.
2.  The `processConversionQueue` function uses `fluent-ffmpeg` to convert the video.
3.  **Hardware Acceleration:** The backend attempts to detect and use hardware encoders (NVIDIA NVENC, Apple VideoToolbox, Intel QSV, AMD AMF) to speed up the process. It runs a quick test encode to verify hardware support before proceeding. If no hardware encoder is supported, it falls back to CPU encoding (`libx264`).
4.  **Advanced Settings:** Users can select **Speed** (Ultrafast, Fast, Medium, Slow) and **Compression** (Low, Medium, High) which adjusts the FFmpeg presets, CRF values, and bitrates accordingly.
5.  **Standardization:** The video is scaled and padded to exactly 1920x1080 (maintaining aspect ratio), the framerate is set to 29.97fps (`30000/1001`), and the audio is standardized to AAC 48kHz 192kbps.
6.  **Logging:** FFmpeg's `stderr` output is captured and can be viewed in the frontend for debugging purposes.

## Development Setup

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Run Development Server:**
    ```bash
    npm run dev
    ```
    This starts the Vite development server and the Express backend concurrently.

3.  **Build for Production (Web):**
    ```bash
    npm run build
    ```

4.  **Build Electron App:**
    *   For Windows: `npm run pack:win`
    *   For macOS: `npm run pack:mac`
    *   For Linux: `npm run pack:linux`

## Future Improvements

*   **Pause/Resume Downloads:** Implement the ability to pause and resume active downloads.
*   **Custom Conversion Profiles:** Allow users to define their own FFmpeg conversion profiles.
*   **More Robust Zoom Extraction:** Zoom frequently changes their web interface. The Puppeteer script may need periodic updates to ensure it can reliably extract the video URL.
