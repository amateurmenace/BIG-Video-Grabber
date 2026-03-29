import { useState, useRef, DragEvent } from "react";
import { RefreshCw, Loader2, Terminal, Film, Tv, Zap, Settings2, CheckCircle2, AlertCircle, Clock, Upload, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface ConversionDetail {
  fps: number | null;
  speed: string | null;
  timeElapsed: string | null;
  bitrate: string | null;
  size: string | null;
}

interface FileInfo {
  name: string;
  size: string;
  isConverting: boolean;
  conversionProgress: number | null;
  isQueued?: boolean;
  error?: string | null;
  logs?: string[];
  conversionDetail?: ConversionDetail | null;
}

interface LibraryTabProps {
  downloadPath: string;
  localFiles: FileInfo[];
  filesLoading: boolean;
  onRefresh: () => void;
}

export default function LibraryTab({ downloadPath, localFiles, filesLoading, onRefresh }: LibraryTabProps) {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [conversionSpeed, setConversionSpeed] = useState("medium");
  const [conversionCompression, setConversionCompression] = useState("medium");
  const [resolution, setResolution] = useState("1920:1080");
  const [framerate, setFramerate] = useState("30000/1001");
  const [normalizeAudio, setNormalizeAudio] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [selectedLogFile, setSelectedLogFile] = useState<FileInfo | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<{ name: string; path: string; size: string }[]>([]);

  const handleConvert = async (filename: string) => {
    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename, downloadPath,
          speed: conversionSpeed, compression: conversionCompression,
          resolution, framerate, normalize_audio: normalizeAudio,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Queued ${filename} for conversion`);
    } catch (err: any) {
      toast.error(err.message || "Failed to start conversion");
    }
  };

  const handleConvertExternal = async (filePath: string) => {
    try {
      const res = await fetch('/api/convert-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath,
          outputDir: downloadPath,
          speed: conversionSpeed, compression: conversionCompression,
          resolution, framerate, normalize_audio: normalizeAudio,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Queued ${data.filename} for conversion`);
      setDroppedFiles(prev => prev.filter(f => f.path !== filePath));
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to queue conversion");
    }
  };

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const videoFiles = files.filter(f =>
      /\.(mp4|mkv|avi|mov|webm|m4v|ts|mts|m2ts|flv|wmv)$/i.test(f.name)
    );
    if (videoFiles.length === 0) {
      toast.error("No video files detected. Supported: mp4, mkv, avi, mov, webm, ts, flv, wmv");
      return;
    }
    const newDropped = videoFiles.map(f => ({
      name: f.name,
      path: (f as any).path || f.name, // Electron provides .path, browser doesn't
      size: (f.size / (1024 * 1024)).toFixed(1) + ' MB',
    }));
    setDroppedFiles(prev => [...prev, ...newDropped]);
    toast.success(`${videoFiles.length} video file${videoFiles.length > 1 ? 's' : ''} ready to convert`);
  };

  const toggleFileSelection = (name: string) => {
    const newSet = new Set(selectedFiles);
    if (newSet.has(name)) newSet.delete(name); else newSet.add(name);
    setSelectedFiles(newSet);
  };

  const toggleAllFiles = () => {
    const convertible = sourceFiles;
    if (selectedFiles.size === convertible.length) setSelectedFiles(new Set());
    else setSelectedFiles(new Set(convertible.map(f => f.name)));
  };

  const handleBulkConvert = async () => {
    const count = selectedFiles.size;
    toast.info(`Queueing ${count} file${count !== 1 ? 's' : ''} for broadcast conversion...`);
    for (const file of Array.from(selectedFiles)) {
      await handleConvert(file);
    }
    setSelectedFiles(new Set());
  };

  // Split files into categories
  const sourceFiles = localFiles.filter(f => !f.name.includes('_broadcast'));
  const broadcastFiles = localFiles.filter(f => f.name.includes('_broadcast'));
  const activeConversions = localFiles.filter(f => f.isConverting);

  const getSpeedDescription = (speed: string) => {
    switch (speed) {
      case 'ultrafast': return 'Fastest encode, larger file size';
      case 'fast': return 'Good balance of speed and size';
      case 'medium': return 'Balanced quality and speed';
      case 'slow': return 'Best quality, slowest encode';
      default: return '';
    }
  };

  const getQualityDescription = (q: string) => {
    switch (q) {
      case 'low': return 'CRF 18 / 8 Mbps — near-lossless, large files';
      case 'medium': return 'CRF 22 / 5 Mbps — broadcast standard';
      case 'high': return 'CRF 28 / 2.5 Mbps — smaller files, lower quality';
      default: return '';
    }
  };

  return (
    <div className="space-y-4">
      {/* Conversion Settings Card */}
      <Card className="border-big-navy/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Tv className="h-5 w-5 text-big-navy" />
            Broadcast Converter
          </CardTitle>
          <CardDescription>
            Convert videos to cable broadcast standard: <strong>1920x1080</strong> resolution, <strong>29.97fps</strong> frame rate, H.264 video, AAC audio 48kHz/192kbps. Hardware acceleration auto-detected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5 p-3 rounded-lg border bg-muted/30">
              <Label className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3 text-big-orange" /> Speed</Label>
              <Select value={conversionSpeed} onValueChange={setConversionSpeed}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ultrafast">Ultrafast</SelectItem>
                  <SelectItem value="fast">Fast</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="slow">Slow (Best)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 p-3 rounded-lg border bg-muted/30">
              <Label className="text-xs text-muted-foreground flex items-center gap-1"><Settings2 className="h-3 w-3 text-big-pink" /> Quality</Label>
              <Select value={conversionCompression} onValueChange={setConversionCompression}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">High Quality</SelectItem>
                  <SelectItem value="medium">Broadcast Std</SelectItem>
                  <SelectItem value="high">Compact</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 p-3 rounded-lg border bg-muted/30">
              <Label className="text-xs text-muted-foreground">Resolution</Label>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1920:1080">1920x1080 (Full HD)</SelectItem>
                  <SelectItem value="1280:720">1280x720 (HD)</SelectItem>
                  <SelectItem value="3840:2160">3840x2160 (4K)</SelectItem>
                  <SelectItem value="720:480">720x480 (SD NTSC)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 p-3 rounded-lg border bg-muted/30">
              <Label className="text-xs text-muted-foreground">Frame Rate</Label>
              <Select value={framerate} onValueChange={setFramerate}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30000/1001">29.97fps (NTSC)</SelectItem>
                  <SelectItem value="25">25fps (PAL)</SelectItem>
                  <SelectItem value="24000/1001">23.976fps (Film)</SelectItem>
                  <SelectItem value="30">30fps</SelectItem>
                  <SelectItem value="60000/1001">59.94fps</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Audio normalization toggle + spec summary */}
          <div className="mt-3 flex items-center justify-between gap-4 p-3 rounded-lg bg-big-navy/5 border border-big-navy/10">
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <span><strong className="text-foreground">Video:</strong> H.264 (HW accel)</span>
              <span><strong className="text-foreground">Audio:</strong> AAC 48kHz 192kbps</span>
              <span><strong className="text-foreground">Format:</strong> MP4</span>
            </div>
            <button
              onClick={() => setNormalizeAudio(!normalizeAudio)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                normalizeAudio
                  ? 'bg-big-pink/10 border-big-pink/30 text-big-pink'
                  : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <Volume2 className="h-3.5 w-3.5" />
              Loudness Norm {normalizeAudio ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Drag and drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`mt-3 border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
              dragOver
                ? 'border-big-pink bg-big-pink/5'
                : 'border-border/50 hover:border-border'
            }`}
          >
            <Upload className={`h-5 w-5 mx-auto mb-1.5 ${dragOver ? 'text-big-pink' : 'text-muted-foreground/40'}`} />
            <p className="text-xs text-muted-foreground">
              {dragOver ? 'Drop video files to convert...' : 'Drag & drop video files here to convert them'}
            </p>
          </div>

          {/* Dropped files waiting to convert */}
          {droppedFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              {droppedFiles.map((f) => (
                <div key={f.path} className="flex items-center justify-between gap-3 p-2 rounded-lg border bg-card">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.name}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{f.path}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">{f.size}</span>
                    <Button size="sm" className="h-7 text-xs" onClick={() => handleConvertExternal(f.path)}>
                      <Tv className="mr-1 h-3 w-3" /> Convert
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDroppedFiles(prev => prev.filter(x => x.path !== f.path))}>
                      <AlertCircle className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={() => {
                droppedFiles.forEach(f => handleConvertExternal(f.path));
              }}>
                <Tv className="mr-1.5 h-3.5 w-3.5" /> Convert All ({droppedFiles.length})
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Conversions */}
      {activeConversions.length > 0 && (
        <Card className="border-big-orange/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-big-orange" />
              Converting ({activeConversions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeConversions.map((file) => {
              const d = file.conversionDetail;
              return (
              <div key={file.name} className="p-3 rounded-lg border bg-card space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      {file.isQueued ? (
                        <Badge variant="outline" className="text-[10px] h-4"><Clock className="h-2.5 w-2.5 mr-0.5" />Queued</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] h-4 bg-big-orange/10 text-big-orange">
                          {file.conversionProgress !== null ? `${Math.round(file.conversionProgress)}%` : 'Starting...'}
                        </Badge>
                      )}
                    </div>
                  </div>
                <Button variant="outline" size="icon" className="h-8 w-8 flex-shrink-0"
                  onClick={() => { setSelectedLogFile(file); setLogModalOpen(true); }}
                  title="View FFmpeg Logs">
                  <Terminal className="h-3.5 w-3.5" />
                </Button>
                </div>

                {/* Progress bar */}
                {!file.isQueued && file.conversionProgress !== null && (
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="big-gradient h-2 rounded-full transition-all" style={{ width: `${file.conversionProgress}%` }} />
                  </div>
                )}

                {/* FFmpeg detail stats */}
                {!file.isQueued && d && (
                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                    {d.fps && <span>FPS: <strong className="text-foreground">{d.fps}</strong></span>}
                    {d.speed && <span>Speed: <strong className="text-foreground">{d.speed}</strong></span>}
                    {d.bitrate && <span>Bitrate: <strong className="text-foreground">{d.bitrate}</strong></span>}
                    {d.size && <span>Output: <strong className="text-foreground">{d.size}</strong></span>}
                    {d.timeElapsed && <span>Time: <strong className="text-foreground">{d.timeElapsed}</strong></span>}
                  </div>
                )}
              </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Source Files — ready to convert */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">Source Videos</CardTitle>
            <CardDescription>
              {sourceFiles.length} file{sourceFiles.length !== 1 ? 's' : ''} ready to convert
              {broadcastFiles.length > 0 && ` — ${broadcastFiles.length} already converted`}
            </CardDescription>
          </div>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" className="h-8" onClick={onRefresh} disabled={filesLoading}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${filesLoading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            {selectedFiles.size > 0 && (
              <Button size="sm" className="h-8 bg-big-navy hover:bg-big-navy/90" onClick={handleBulkConvert}>
                <Tv className="mr-1.5 h-3.5 w-3.5" /> Convert to Broadcast ({selectedFiles.size})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {sourceFiles.length === 0 && broadcastFiles.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Film className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No video files found in the download location.</p>
              <p className="text-xs mt-1">Download videos from Meeting Vacuum or the Download tab, then come here to convert them.</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <input type="checkbox" className="w-4 h-4 rounded border-gray-300 accent-[var(--big-navy)]"
                        checked={sourceFiles.length > 0 && selectedFiles.size === sourceFiles.length}
                        onChange={toggleAllFiles} />
                    </TableHead>
                    <TableHead>Filename</TableHead>
                    <TableHead className="w-[80px]">Size</TableHead>
                    <TableHead className="w-[60px] text-center">Status</TableHead>
                    <TableHead className="text-right w-[200px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sourceFiles.map((file) => {
                    const hasBroadcast = broadcastFiles.some(bf =>
                      bf.name === file.name.replace(/\.[^.]+$/, '_broadcast.mp4')
                    );
                    return (
                      <TableRow key={file.name}>
                        <TableCell>
                          <input type="checkbox" className="w-4 h-4 rounded border-gray-300 accent-[var(--big-navy)]"
                            checked={selectedFiles.has(file.name)}
                            onChange={() => toggleFileSelection(file.name)}
                            disabled={file.isConverting} />
                        </TableCell>
                        <TableCell className="font-medium truncate max-w-[200px] sm:max-w-md" title={file.name}>
                          {file.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{file.size}</TableCell>
                        <TableCell className="text-center">
                          {file.isConverting ? (
                            <Loader2 className="h-4 w-4 animate-spin text-big-orange mx-auto" />
                          ) : hasBroadcast ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                          ) : file.error ? (
                            <AlertCircle className="h-4 w-4 text-destructive mx-auto" />
                          ) : (
                            <span className="text-xs text-muted-foreground">--</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {file.error && (
                              <Button variant="outline" size="icon" className="h-8 w-8"
                                onClick={() => { setSelectedLogFile(file); setLogModalOpen(true); }}
                                title="View error logs">
                                <Terminal className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button size="sm"
                              onClick={() => handleConvert(file.name)}
                              disabled={file.isConverting}
                              className="h-8 text-xs">
                              {file.isConverting ? (
                                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                  {file.isQueued ? 'Queued' : `${Math.round(file.conversionProgress || 0)}%`}</>
                              ) : hasBroadcast ? (
                                <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reconvert</>
                              ) : (
                                <><Tv className="mr-1.5 h-3.5 w-3.5" /> Convert</>
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Broadcast-ready files */}
      {broadcastFiles.length > 0 && (
        <Card className="border-green-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Broadcast Ready ({broadcastFiles.length})
            </CardTitle>
            <CardDescription>
              These files are converted and ready for cable TV playout.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead className="w-[80px]">Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {broadcastFiles.map((file) => (
                    <TableRow key={file.name}>
                      <TableCell className="font-medium truncate max-w-[300px] sm:max-w-lg" title={file.name}>
                        <div className="flex items-center gap-2">
                          <Tv className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                          {file.name}
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-green-500/10 text-green-600">1080p 29.97</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{file.size}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* FFmpeg Log Dialog */}
      <Dialog open={logModalOpen} onOpenChange={setLogModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>FFmpeg Logs: {selectedLogFile?.name}</DialogTitle>
            <DialogDescription>Live conversion output for debugging.</DialogDescription>
          </DialogHeader>
          <div className="bg-slate-950 text-slate-50 p-4 rounded-md font-mono text-xs h-[400px] overflow-y-auto whitespace-pre-wrap flex flex-col-reverse">
            {selectedLogFile?.logs && selectedLogFile.logs.length > 0 ? (
              selectedLogFile.logs.map((log: string, i: number) => (
                <div key={i} className="mb-1 opacity-90">{log}</div>
              ))
            ) : (
              <div className="text-slate-500 italic">No logs available yet...</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
