import { FolderOpen, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useRef } from "react";

interface HeaderProps {
  downloadPath: string;
  setDownloadPath: (path: string) => void;
  onChooseFolder: () => void;
  onOpenFolder: () => void;
}

export default function Header({ downloadPath, setDownloadPath, onChooseFolder, onOpenFolder }: HeaderProps) {
  const [ytdlpStatus, setYtdlpStatus] = useState<{ installed: boolean; version: string | null } | null>(null);
  const [updating, setUpdating] = useState(false);
  const retryRef = useRef(0);

  const fetchStatus = () => {
    fetch('/api/ytdlp-status')
      .then(r => r.json())
      .then(data => {
        setYtdlpStatus(data);
        // If not installed yet, retry a few times (binary might be downloading)
        if (!data.installed && retryRef.current < 5) {
          retryRef.current++;
          setTimeout(fetchStatus, 3000);
        }
      })
      .catch(() => {});
  };

  useEffect(() => { fetchStatus(); }, []);

  const handleUpdateYtdlp = async () => {
    setUpdating(true);
    try {
      const res = await fetch('/api/ytdlp-update', { method: 'POST' });
      const data = await res.json();
      if (data.version) {
        setYtdlpStatus({ installed: true, version: data.version });
      }
    } catch {}
    setUpdating(false);
  };

  const renderYtdlpBadge = () => {
    if (updating) {
      return (
        <Badge variant="secondary" className="text-xs gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Updating yt-dlp...
        </Badge>
      );
    }
    if (!ytdlpStatus) {
      return (
        <Badge variant="secondary" className="text-xs gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking yt-dlp...
        </Badge>
      );
    }
    if (ytdlpStatus.installed && ytdlpStatus.version) {
      return (
        <Badge variant="secondary" className="text-xs gap-1">
          yt-dlp v{ytdlpStatus.version}
        </Badge>
      );
    }
    if (ytdlpStatus.installed) {
      return <Badge variant="secondary" className="text-xs">yt-dlp ready</Badge>;
    }
    return (
      <Badge variant="secondary" className="text-xs gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Downloading yt-dlp...
      </Badge>
    );
  };

  return (
    <div className="space-y-0">
      <div className="big-gradient h-1.5 rounded-t-lg" />
      <div className="bg-card border border-t-0 rounded-b-lg px-6 py-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <h1 className="text-2xl font-bold tracking-tight text-primary">
                BIG Video Grabber
              </h1>
              <p className="text-sm text-muted-foreground">
                Brookline Interactive Group
              </p>
            </div>
            <div className="flex items-center gap-2 ml-2">
              {renderYtdlpBadge()}
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleUpdateYtdlp} disabled={updating} title="Update yt-dlp to latest nightly">
                <RefreshCw className={`h-3 w-3 ${updating ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Save to:</span>
            <Input
              value={downloadPath}
              onChange={(e) => setDownloadPath(e.target.value)}
              placeholder="./downloads"
              className="w-48 md:w-64 h-8 text-sm"
            />
            <Button variant="outline" size="sm" className="h-8" onClick={onChooseFolder}>
              Choose...
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={onOpenFolder}>
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
