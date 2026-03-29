import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronUp, ChevronDown, Terminal, Trash2, Download, Tv, AlertCircle, Info, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LogEntry {
  timestamp: string;
  type: string;
  message: string;
  detail?: string;
}

const typeConfig: Record<string, { icon: typeof Terminal; color: string; label: string }> = {
  system: { icon: Info, color: "text-muted-foreground", label: "SYS" },
  download: { icon: Download, color: "text-blue-500", label: "DL" },
  ytdlp: { icon: Terminal, color: "text-purple-500", label: "YT-DLP" },
  conversion: { icon: Tv, color: "text-big-orange", label: "CONV" },
  ffmpeg: { icon: Zap, color: "text-yellow-500", label: "FFMPEG" },
  error: { icon: AlertCircle, color: "text-destructive", label: "ERR" },
};

export default function ActivityLog() {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const lastTimestampRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const poll = useCallback(async () => {
    try {
      const ts = lastTimestampRef.current;
      const url = ts
        ? `/api/activity-log?since=${encodeURIComponent(ts)}`
        : '/api/activity-log';
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data.entries && data.entries.length > 0) {
        setEntries(prev => {
          const combined = [...prev, ...data.entries];
          return combined.slice(-200);
        });
        lastTimestampRef.current = data.entries[data.entries.length - 1].timestamp;
      }
    } catch {}
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 1500);
    return () => clearInterval(interval);
  }, [poll]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll, expanded]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return ''; }
  };

  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      {/* Toggle bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 bg-slate-900 text-slate-300 hover:bg-slate-800 transition-colors border-t border-slate-700 text-xs"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="font-medium flex-shrink-0">Activity Log</span>
          {entries.length > 0 && (
            <span className="flex-shrink-0 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-slate-700 px-1.5 text-[10px] text-slate-300 font-mono">
              {entries.length}
            </span>
          )}
          {!expanded && lastEntry && (
            <span className="text-slate-500 truncate">
              {lastEntry.message}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {expanded && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-slate-400 hover:text-slate-200"
              onClick={(e) => { e.stopPropagation(); setEntries([]); lastTimestampRef.current = null; }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </div>
      </button>

      {/* Log panel */}
      {expanded && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="bg-slate-950 text-slate-300 h-[240px] overflow-y-auto font-mono text-xs border-t border-slate-800"
        >
          {entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-600">
              Waiting for activity...
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {entries.map((entry, i) => {
                const config = typeConfig[entry.type] || typeConfig.system;
                const Icon = config.icon;
                return (
                  <div key={`${entry.timestamp}-${i}`} className="flex items-start gap-2 py-0.5 hover:bg-slate-900/50 px-1 rounded">
                    <span className="text-slate-600 whitespace-nowrap flex-shrink-0">{formatTime(entry.timestamp)}</span>
                    <span className={`flex-shrink-0 ${config.color}`}>
                      <Icon className="h-3 w-3 mt-0.5" />
                    </span>
                    <span className={`font-semibold flex-shrink-0 w-[52px] ${config.color}`}>{config.label}</span>
                    <span className="text-slate-200">{entry.message}</span>
                    {entry.detail && (
                      <span className="text-slate-500 truncate">{entry.detail}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
