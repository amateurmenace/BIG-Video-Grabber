import { useState } from "react";
import { Download, Loader2, Link2, ClipboardPaste, Trash2, Globe, Clock, User, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface VideoMetadata {
  title: string;
  duration: number | null;
  duration_string: string | null;
  thumbnail: string | null;
  uploader: string | null;
  webpage_url: string;
  extractor: string;
  formatChoices: { id: string; label: string }[];
}

interface DownloadTabProps {
  downloadPath: string;
  activeDownloads: any[];
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "Unknown";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function DownloadTab({ downloadPath, activeDownloads }: DownloadTabProps) {
  const [urlInput, setUrlInput] = useState("");
  const [metadataMap, setMetadataMap] = useState<Map<string, VideoMetadata | 'loading' | 'error'>>(new Map());
  const [selectedFormats, setSelectedFormats] = useState<Map<string, string>>(new Map());
  const [errorMap, setErrorMap] = useState<Map<string, string>>(new Map());

  const extractUrls = (text: string): string[] => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const urlRegex = /https?:\/\/[^\s]+/;
    return lines.filter(l => urlRegex.test(l));
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrlInput(text);
      const urls = extractUrls(text);
      if (urls.length > 0) {
        fetchMetadataForUrls(urls);
      }
    } catch {
      toast.error("Failed to read clipboard");
    }
  };

  const handleFetchInfo = () => {
    const urls = extractUrls(urlInput);
    if (urls.length === 0) {
      toast.error("No valid URLs found");
      return;
    }
    fetchMetadataForUrls(urls);
  };

  const fetchMetadataForUrls = async (urls: string[]) => {
    const newMap = new Map(metadataMap);
    const newErrors = new Map(errorMap);

    for (const url of urls) {
      if (newMap.has(url) && newMap.get(url) !== 'error') continue;
      newMap.set(url, 'loading');
    }
    setMetadataMap(new Map(newMap));

    // Phase 1: Quick info for all URLs in parallel (fast — title + thumbnail)
    const quickPromises = urls
      .filter(url => !metadataMap.has(url) || metadataMap.get(url) === 'error' || metadataMap.get(url) === 'loading')
      .map(async (url) => {
        try {
          const res = await fetch('/api/ytdlp-quick-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          });
          if (!res.ok) throw new Error((await res.json()).error || 'Failed');
          const data = await res.json();
          // Store quick info with empty formats — format selector will show "Best Quality" only
          newMap.set(url, { ...data, formats: [], formatChoices: [{ id: 'bv[vcodec~=\'^(avc|h264)\']+ba[acodec~=\'^(mp4a|aac)\']/bv*+ba/b', label: 'Best Quality' }] });
          newErrors.delete(url);
        } catch (e: any) {
          newMap.set(url, 'error');
          newErrors.set(url, e.message);
        }
        setMetadataMap(new Map(newMap));
        setErrorMap(new Map(newErrors));
      });

    await Promise.all(quickPromises);

    // Phase 2: Full format info in background (slow — but user already sees thumbnails)
    for (const url of urls) {
      const current = newMap.get(url);
      if (!current || current === 'error' || current === 'loading') continue;
      // Fetch full formats in background
      fetch('/api/ytdlp-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }).then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setMetadataMap(prev => {
          const updated = new Map(prev);
          updated.set(url, data);
          return updated;
        });
      }).catch(() => {}); // non-critical, quick info is enough to download
    }
  };

  const handleDownload = async (url: string) => {
    const formatId = selectedFormats.get(url) || undefined;
    try {
      const res = await fetch('/api/ytdlp-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, downloadPath, formatId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start download");
      toast.success(`Download started: ${data.message}`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDownloadAll = async () => {
    const urls = Array.from(metadataMap.entries())
      .filter(([, v]) => typeof v === 'object' && v !== null)
      .map(([url]) => url);

    if (urls.length === 0) return;
    toast.info(`Starting ${urls.length} downloads...`);
    for (const url of urls) {
      await handleDownload(url);
      await new Promise(r => setTimeout(r, 300));
    }
  };

  const clearAll = () => {
    setUrlInput("");
    setMetadataMap(new Map());
    setSelectedFormats(new Map());
    setErrorMap(new Map());
  };

  const readyCount = Array.from(metadataMap.values()).filter(v => typeof v === 'object' && v !== null).length;

  // Get ytdlp downloads from activeDownloads
  const ytdlpDownloads = activeDownloads.filter(d => d.type === 'ytdlp');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="h-5 w-5 text-big-pink" />
            Download from URL
          </CardTitle>
          <CardDescription>Paste YouTube, Vimeo, or any video URL. Powered by yt-dlp with nightly updates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <textarea
              className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none font-mono"
              placeholder={"Paste video URLs here (one per line)...\nhttps://www.youtube.com/watch?v=...\nhttps://vimeo.com/..."}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handlePaste}>
                <ClipboardPaste className="mr-1.5 h-3.5 w-3.5" /> Paste from Clipboard
              </Button>
              <Button size="sm" onClick={handleFetchInfo} disabled={!urlInput.trim()}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" /> Fetch Info
              </Button>
              {readyCount > 0 && (
                <Button size="sm" className="bg-big-pink hover:bg-big-pink/90 text-white" onClick={handleDownloadAll}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Download All ({readyCount})
                </Button>
              )}
              {metadataMap.size > 0 && (
                <Button variant="outline" size="sm" onClick={clearAll}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear
                </Button>
              )}
            </div>
          </div>

          {/* Metadata preview cards */}
          {metadataMap.size > 0 && (
            <div className="space-y-3">
              {Array.from(metadataMap.entries()).map(([url, data]) => {
                // Check if this URL has an active download
                const activeDl = ytdlpDownloads.find(d => d.url === url);

                if (data === 'loading') {
                  return (
                    <div key={url} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-muted-foreground truncate">{url}</p>
                        <p className="text-xs text-muted-foreground">Fetching video info...</p>
                      </div>
                    </div>
                  );
                }

                if (data === 'error') {
                  return (
                    <div key={url} className="flex items-center gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
                      <div className="h-10 w-10 rounded bg-destructive/10 flex items-center justify-center">
                        <Film className="h-5 w-5 text-destructive" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-destructive truncate">{url}</p>
                        <p className="text-xs text-destructive/80">{errorMap.get(url) || 'Failed to fetch info'}</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => handleDownload(url)}>
                        <Download className="mr-1.5 h-3.5 w-3.5" /> Try Download
                      </Button>
                    </div>
                  );
                }

                const meta = data as VideoMetadata;
                return (
                  <div key={url} className="flex gap-3 p-3 rounded-lg border bg-card hover:shadow-sm transition-shadow">
                    {/* Thumbnail */}
                    {meta.thumbnail ? (
                      <img src={meta.thumbnail} alt="" className="h-20 w-36 rounded object-cover flex-shrink-0 bg-muted" />
                    ) : (
                      <div className="h-20 w-36 rounded bg-muted flex items-center justify-center flex-shrink-0">
                        <Film className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm font-medium leading-tight line-clamp-2">{meta.title}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {meta.uploader && (
                          <span className="flex items-center gap-1"><User className="h-3 w-3" />{meta.uploader}</span>
                        )}
                        {meta.duration && (
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDuration(meta.duration)}</span>
                        )}
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{meta.extractor}</Badge>
                      </div>

                      {/* Active download progress */}
                      {activeDl && activeDl.state === 'inProgress' && (
                        <div className="mt-1">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{Math.round(activeDl.percent)}%</span>
                            {activeDl.speed && <span>{activeDl.speed}</span>}
                            {activeDl.eta && activeDl.eta !== 'unknown' && <span>ETA {activeDl.eta}</span>}
                          </div>
                          <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                            <div className="big-gradient h-1.5 rounded-full transition-all" style={{ width: `${activeDl.percent}%` }} />
                          </div>
                        </div>
                      )}
                      {activeDl && activeDl.state === 'completed' && (
                        <Badge variant="secondary" className="text-green-600 mt-1">Downloaded</Badge>
                      )}
                      {activeDl && activeDl.state === 'error' && (
                        <Badge variant="destructive" className="mt-1">Error: {activeDl.error}</Badge>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 items-end flex-shrink-0">
                      {meta.formatChoices && meta.formatChoices.length > 0 && (
                        <Select
                          value={selectedFormats.get(url) || "bv*+ba/b"}
                          onValueChange={(val) => {
                            const newMap = new Map(selectedFormats);
                            newMap.set(url, val);
                            setSelectedFormats(newMap);
                          }}
                        >
                          <SelectTrigger className="w-[150px] h-8 text-xs">
                            <SelectValue placeholder="Quality" />
                          </SelectTrigger>
                          <SelectContent>
                            {meta.formatChoices.map((f) => (
                              <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Button
                        size="sm"
                        className="w-[150px]"
                        onClick={() => handleDownload(url)}
                        disabled={activeDl && (activeDl.state === 'inProgress' || activeDl.state === 'starting')}
                      >
                        {activeDl && activeDl.state === 'starting' ? (
                          <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Starting...</>
                        ) : activeDl && activeDl.state === 'inProgress' ? (
                          <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {Math.round(activeDl.percent)}%</>
                        ) : (
                          <><Download className="mr-1.5 h-3.5 w-3.5" /> Download</>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Active yt-dlp downloads not in metadata view */}
          {ytdlpDownloads.filter(d => !metadataMap.has(d.url)).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Active Downloads</h3>
              {ytdlpDownloads.filter(d => !metadataMap.has(d.url)).map((dl) => (
                <div key={dl.id} className="flex items-center gap-3 p-3 rounded-lg border">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{dl.filename}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      {dl.state === 'inProgress' && (
                        <>
                          <span>{Math.round(dl.percent)}%</span>
                          {dl.speed && <span>{dl.speed}</span>}
                          {dl.eta && dl.eta !== 'unknown' && <span>ETA {dl.eta}</span>}
                        </>
                      )}
                      {dl.state === 'completed' && <Badge variant="secondary" className="text-green-600">Done</Badge>}
                      {dl.state === 'error' && <Badge variant="destructive">Error</Badge>}
                      {dl.state === 'starting' && <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Starting</Badge>}
                    </div>
                    {dl.state === 'inProgress' && (
                      <div className="w-full bg-muted rounded-full h-1.5 mt-1.5">
                        <div className="big-gradient h-1.5 rounded-full transition-all" style={{ width: `${dl.percent}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {metadataMap.size === 0 && ytdlpDownloads.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Paste a video URL above to get started.</p>
              <p className="text-xs mt-1">Supports YouTube, Vimeo, Facebook, Twitter, and 1000+ other sites.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
