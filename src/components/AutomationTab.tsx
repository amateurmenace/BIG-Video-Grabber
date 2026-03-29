import { useState, useEffect } from "react";
import { Calendar, Clock, Play, Pause, Trash2, Loader2, FolderOpen, Plus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  cronDay: string;
  cronTime: string;
  lookbackDays: number;
  autoConvert: boolean;
  outputFolder: string;
  speed: string;
  compression: string;
  lastRun: string | null;
  lastResult: string | null;
}

interface AutomationTabProps {
  downloadPath: string;
}

export default function AutomationTab({ downloadPath }: AutomationTabProps) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  // New schedule form
  const [name, setName] = useState("Weekly Meeting Vacuum");
  const [cronDay, setCronDay] = useState("friday");
  const [cronTime, setCronTime] = useState("18:00");
  const [lookbackDays, setLookbackDays] = useState(7);
  const [autoConvert, setAutoConvert] = useState(true);
  const [outputFolder, setOutputFolder] = useState("");
  const [speed, setSpeed] = useState("medium");
  const [compression, setCompression] = useState("medium");

  useEffect(() => {
    setOutputFolder(downloadPath ? `${downloadPath}/automated` : './downloads/automated');
  }, [downloadPath]);

  const fetchSchedules = async () => {
    try {
      const res = await fetch('/api/automation/schedules');
      const data = await res.json();
      setSchedules(data.schedules || []);
    } catch {}
  };

  useEffect(() => { fetchSchedules(); }, []);

  const handleCreate = async () => {
    try {
      const res = await fetch('/api/automation/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cronDay, cronTime, lookbackDays, autoConvert, outputFolder, speed, compression }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Schedule created: ${name}`);
      setShowCreate(false);
      fetchSchedules();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleToggle = async (id: string) => {
    await fetch(`/api/automation/schedules/${id}/toggle`, { method: 'POST' });
    fetchSchedules();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/automation/schedules/${id}`, { method: 'DELETE' });
    toast.success("Schedule deleted");
    fetchSchedules();
  };

  const handleRunNow = async (id: string) => {
    const res = await fetch(`/api/automation/schedules/${id}/run`, { method: 'POST' });
    if (res.ok) toast.success("Automation started — check the Activity Log");
    fetchSchedules();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="h-5 w-5 text-big-yellow" />
                Automation Schedules
              </CardTitle>
              <CardDescription>
                Set up automatic meeting downloads on a recurring schedule. Files are saved to a separate folder to keep your standard workflow clean.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New Schedule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Create form */}
          {showCreate && (
            <div className="mb-6 p-4 rounded-lg border-2 border-dashed border-big-navy/20 bg-muted/30 space-y-4">
              <h3 className="text-sm font-semibold">New Automation Schedule</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Schedule Name</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Output Folder (separate from main downloads)</Label>
                  <Input value={outputFolder} onChange={e => setOutputFolder(e.target.value)} className="h-8 text-sm font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Run Every</Label>
                  <Select value={cronDay} onValueChange={setCronDay}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monday">Monday</SelectItem>
                      <SelectItem value="tuesday">Tuesday</SelectItem>
                      <SelectItem value="wednesday">Wednesday</SelectItem>
                      <SelectItem value="thursday">Thursday</SelectItem>
                      <SelectItem value="friday">Friday</SelectItem>
                      <SelectItem value="saturday">Saturday</SelectItem>
                      <SelectItem value="sunday">Sunday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">At Time</Label>
                  <Input type="time" value={cronTime} onChange={e => setCronTime(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Look Back (days)</Label>
                  <Select value={String(lookbackDays)} onValueChange={v => setLookbackDays(Number(v))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3 days</SelectItem>
                      <SelectItem value="7">7 days (1 week)</SelectItem>
                      <SelectItem value="14">14 days (2 weeks)</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Auto-Convert to Broadcast</Label>
                  <Select value={autoConvert ? "yes" : "no"} onValueChange={v => setAutoConvert(v === "yes")}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes — download and convert</SelectItem>
                      <SelectItem value="no">No — download only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {autoConvert && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Encode Speed</Label>
                      <Select value={speed} onValueChange={setSpeed}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ultrafast">Ultrafast</SelectItem>
                          <SelectItem value="fast">Fast</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="slow">Slow</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Output Quality</Label>
                      <Select value={compression} onValueChange={setCompression}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">High Quality</SelectItem>
                          <SelectItem value="medium">Broadcast Standard</SelectItem>
                          <SelectItem value="high">Compact</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={handleCreate}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Create Schedule
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Existing schedules */}
          {schedules.length === 0 && !showCreate ? (
            <div className="text-center py-10 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No automation schedules yet.</p>
              <p className="text-xs mt-1">Create one to automatically vacuum meetings on a recurring schedule.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map((s) => (
                <div key={s.id} className={`p-4 rounded-lg border ${s.enabled ? 'bg-card' : 'bg-muted/50 opacity-70'}`}>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold">{s.name}</h4>
                        {s.enabled ? (
                          <Badge variant="secondary" className="text-[10px] h-4 bg-green-500/10 text-green-600">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] h-4">Paused</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Every {s.cronDay.charAt(0).toUpperCase() + s.cronDay.slice(1)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {s.cronTime}
                        </span>
                        <span>Last {s.lookbackDays} days</span>
                        {s.autoConvert && <span className="text-big-orange">+ auto-convert</span>}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">{s.outputFolder}</p>
                      {s.lastResult && (
                        <p className="text-xs mt-1">
                          <span className="text-muted-foreground">Last run: </span>
                          <span className={s.lastResult.startsWith('Error') ? 'text-destructive' : 'text-foreground'}>{s.lastResult}</span>
                          {s.lastRun && <span className="text-muted-foreground ml-2">({new Date(s.lastRun).toLocaleString()})</span>}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleRunNow(s.id)} title="Run now">
                        <Play className="h-3 w-3 mr-1" /> Run Now
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleToggle(s.id)} title={s.enabled ? 'Pause' : 'Resume'}>
                        {s.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(s.id)} title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
