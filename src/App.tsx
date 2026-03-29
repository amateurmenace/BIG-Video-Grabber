import { useState, useEffect, useRef } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Download, Tv, Zap } from "lucide-react";

function VacuumIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="9" cy="19" rx="4" ry="3" />
      <path d="M9 16V6" />
      <path d="M5 6h8" />
      <path d="M13 6l5-4" />
      <path d="M15 2l3 2" />
      <path d="M6 10h6" />
    </svg>
  );
}

import Header from "@/src/components/Header";
import MeetingsTab from "@/src/components/MeetingsTab";
import DownloadTab from "@/src/components/DownloadTab";
import LibraryTab from "@/src/components/LibraryTab";
import AutomationTab from "@/src/components/AutomationTab";
import ActivityLog from "@/src/components/ActivityLog";

interface FileInfo {
  name: string;
  size: string;
  isConverting: boolean;
  conversionProgress: number | null;
  isQueued?: boolean;
  error?: string | null;
  logs?: string[];
}

export default function App() {
  const [downloadPath, setDownloadPath] = useState<string>("");
  const [localFiles, setLocalFiles] = useState<FileInfo[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<any[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  // Fetch default download directory
  useEffect(() => {
    fetch('/api/default-directory')
      .then(r => r.ok ? r.json() : null)
      .then(data => data && setDownloadPath(data.path))
      .catch(() => {});
  }, []);

  // Polling for status updates
  const fetchStatus = async (showLoader = false) => {
    if (!downloadPath) return;
    if (showLoader) setFilesLoading(true);
    try {
      const [filesRes, dlRes] = await Promise.all([
        fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ downloadPath }),
        }),
        fetch('/api/downloads/status')
      ]);
      if (filesRes.ok) {
        const data = await filesRes.json();
        setLocalFiles(data.files || []);
      }
      if (dlRes.ok) {
        const data = await dlRes.json();
        setActiveDownloads(data.downloads || []);
      }
    } catch (err) {
      console.error("Failed to fetch status", err);
    } finally {
      if (showLoader) setFilesLoading(false);
    }
  };

  // Toast notifications for state changes
  const prevDownloadsRef = useRef<any[]>([]);
  const prevFilesRef = useRef<FileInfo[]>([]);

  useEffect(() => {
    activeDownloads.forEach(dl => {
      const prevDl = prevDownloadsRef.current.find(p => p.url === dl.url || p.id === dl.id);
      if (prevDl && prevDl.state !== dl.state) {
        if (dl.state === 'completed') toast.success(`Download completed: ${dl.filename || 'Video'}`);
        else if (dl.state === 'error') toast.error(`Download failed: ${dl.error || 'Unknown error'}`);
        else if (dl.state === 'timeout') toast.warning("Download timed out");
      }
    });
    prevDownloadsRef.current = activeDownloads;
  }, [activeDownloads]);

  useEffect(() => {
    localFiles.forEach(file => {
      const prevFile = prevFilesRef.current.find(p => p.name === file.name);
      if (prevFile) {
        if (prevFile.isConverting && !file.isConverting && !file.error) toast.success(`Conversion completed: ${file.name}`);
        else if (!prevFile.error && file.error) toast.error(`Conversion failed: ${file.name}`);
      }
    });
    prevFilesRef.current = localFiles;
  }, [localFiles]);

  useEffect(() => {
    fetchStatus(true);
    const interval = setInterval(() => fetchStatus(false), 2000);
    return () => clearInterval(interval);
  }, [downloadPath]);

  const handleChooseFolder = async () => {
    try {
      const res = await fetch('/api/choose-directory');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (!data.canceled && data.path) setDownloadPath(data.path);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const res = await fetch('/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: downloadPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (err: any) {
      toast.error(err.message || "Failed to open folder");
    }
  };

  const handleClearDownloads = async () => {
    try {
      const res = await fetch('/api/downloads/clear', { method: 'POST' });
      if (res.ok) { fetchStatus(); toast.success("Cleared completed downloads"); }
    } catch { toast.error("Failed to clear downloads"); }
  };

  // Count active items for tab badges
  const activeDownloadCount = activeDownloads.filter(d => d.state === 'inProgress' || d.state === 'starting' || d.state === 'queued').length;
  const convertingCount = localFiles.filter(f => f.isConverting).length;

  return (
    <div className="min-h-screen bg-background">
      <Toaster />
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
        <Header
          downloadPath={downloadPath}
          setDownloadPath={setDownloadPath}
          onChooseFolder={handleChooseFolder}
          onOpenFolder={handleOpenFolder}
        />

        <Tabs defaultValue="download">
          <TabsList variant="line" className="w-full justify-start border-b pb-0 gap-0">
            <TabsTrigger value="meetings" className="gap-1.5 px-4 py-2 text-sm data-active:text-primary">
              <VacuumIcon className="h-4 w-4" />
              Meeting Vacuum
            </TabsTrigger>
            <TabsTrigger value="download" className="gap-1.5 px-4 py-2 text-sm data-active:text-primary">
              <Download className="h-4 w-4" />
              Download
              {activeDownloadCount > 0 && (
                <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-big-pink text-[10px] text-white font-bold">
                  {activeDownloadCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="library" className="gap-1.5 px-4 py-2 text-sm data-active:text-primary">
              <Tv className="h-4 w-4" />
              Broadcast Converter
              {convertingCount > 0 && (
                <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-big-orange text-[10px] text-white font-bold">
                  {convertingCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="automation" className="gap-1.5 px-4 py-2 text-sm data-active:text-primary">
              <Zap className="h-4 w-4" />
              Automation
            </TabsTrigger>
          </TabsList>

          <TabsContent value="meetings" className="mt-4">
            <MeetingsTab
              downloadPath={downloadPath}
              activeDownloads={activeDownloads}
              onClearDownloads={handleClearDownloads}
            />
          </TabsContent>

          <TabsContent value="download" className="mt-4">
            <DownloadTab
              downloadPath={downloadPath}
              activeDownloads={activeDownloads}
            />
          </TabsContent>

          <TabsContent value="library" className="mt-4">
            <LibraryTab
              downloadPath={downloadPath}
              localFiles={localFiles}
              filesLoading={filesLoading}
              onRefresh={() => fetchStatus(true)}
            />
          </TabsContent>

          <TabsContent value="automation" className="mt-4">
            <AutomationTab downloadPath={downloadPath} />
          </TabsContent>
        </Tabs>

        {/* Bottom spacer for the fixed activity log bar */}
        <div className="h-10" />
      </div>

      <ActivityLog />
    </div>
  );
}
