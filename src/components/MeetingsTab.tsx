import { useState, useEffect } from "react";
import { format, subDays } from "date-fns";
import { Calendar as CalendarIcon, Download, ExternalLink, Search, Copy, Loader2, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface CivicEvent {
  id: number;
  eventName: string;
  eventDate: string;
  categoryName: string;
  externalMediaUrl: string;
}

interface MeetingsTabProps {
  downloadPath: string;
  activeDownloads: any[];
  onClearDownloads: () => void;
}

export default function MeetingsTab({ downloadPath, activeDownloads, onClearDownloads }: MeetingsTabProps) {
  const [startDate, setStartDate] = useState<Date>(subDays(new Date(), 30));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<CivicEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<Set<number>>(new Set());
  const ITEMS_PER_PAGE = 10;

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const startStr = startDate.toISOString().split("T")[0] + "T00:00:00Z";
      const endStr = endDate.toISOString().split("T")[0] + "T23:59:59Z";
      let url = `https://brooklinema.api.civicclerk.com/v1/events?$filter=eventDate ge ${startStr} and eventDate le ${endStr}`;
      let allEvents: any[] = [];
      while (url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch events from CivicClerk API");
        const data = await res.json();
        allEvents = allEvents.concat(data.value);
        url = data['@odata.nextLink'];
      }
      const zoomEvents = allEvents.filter(
        (e: any) => e.externalMediaUrl && e.externalMediaUrl.toLowerCase().includes("zoom")
      );
      zoomEvents.sort((a: any, b: any) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());
      setEvents(zoomEvents);
      setCurrentPage(1);
    } catch (err: any) {
      setError(err.message || "An error occurred while fetching events.");
    } finally {
      setLoading(false);
    }
  };

  // Don't auto-search on mount — user clicks Search manually

  const handleDownload = async (url: string) => {
    setDownloadingUrl(url);
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, downloadPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start download");
      toast.success(data.message || "Download queued");
    } catch (err: any) {
      toast.error(err.message || "Failed to queue download");
    } finally {
      setDownloadingUrl(null);
    }
  };

  const copyAllLinks = () => {
    const links = events.map(e => e.externalMediaUrl).join("\n");
    navigator.clipboard.writeText(links);
    toast.success(`Copied ${events.length} Zoom links to clipboard`);
  };

  const toggleEventSelection = (id: number) => {
    const newSet = new Set(selectedEvents);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setSelectedEvents(newSet);
  };

  const totalPages = Math.ceil(events.length / ITEMS_PER_PAGE);
  const currentEvents = events.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const toggleAllEvents = () => {
    if (selectedEvents.size === currentEvents.length) setSelectedEvents(new Set());
    else setSelectedEvents(new Set(currentEvents.map(e => e.id)));
  };

  const handleBulkDownload = async () => {
    const urls = events.filter(e => selectedEvents.has(e.id)).map(e => e.externalMediaUrl);
    if (urls.length === 0) return;
    toast.info(`Queueing ${urls.length} downloads...`);
    for (const url of urls) {
      await handleDownload(url);
      await new Promise(r => setTimeout(r, 500));
    }
    setSelectedEvents(new Set());
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Meeting Vacuum</CardTitle>
          <CardDescription>
            Suck up every Brookline public meeting recording via CivicClerk. Set your date range and vacuum away.
            {' '}<a href="https://brooklinema.portal.civicclerk.com/search" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-big-pink">Browse CivicClerk Portal</a>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex flex-col gap-1.5 w-full sm:w-auto">
              <label className="text-xs font-medium text-muted-foreground">Start Date</label>
              <Popover>
                <PopoverTrigger render={
                  <Button variant="outline" nativeButton={false} className={cn("w-full sm:w-[200px] justify-start text-left font-normal h-9 text-sm", !startDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {startDate ? format(startDate, "MMM d, yyyy") : "Pick a date"}
                  </Button>
                } />
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={startDate} onSelect={(date) => date && setStartDate(date)} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-col gap-1.5 w-full sm:w-auto">
              <label className="text-xs font-medium text-muted-foreground">End Date</label>
              <Popover>
                <PopoverTrigger render={
                  <Button variant="outline" nativeButton={false} className={cn("w-full sm:w-[200px] justify-start text-left font-normal h-9 text-sm", !endDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {endDate ? format(endDate, "MMM d, yyyy") : "Pick a date"}
                  </Button>
                } />
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={endDate} onSelect={(date) => date && setEndDate(date)} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <Button onClick={fetchEvents} disabled={loading} className="h-9">
              {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-2 h-3.5 w-3.5" />}
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-lg">Results</CardTitle>
            <CardDescription>Found {events.length} meeting{events.length !== 1 && "s"} with Zoom recordings.</CardDescription>
          </div>
          {events.length > 0 && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyAllLinks}>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Links
              </Button>
              {activeDownloads.filter(d => ['completed', 'error', 'timeout', 'canceled'].includes(d.state)).length > 0 && (
                <Button variant="outline" size="sm" onClick={onClearDownloads}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear Done
                </Button>
              )}
              {selectedEvents.size > 0 && (
                <Button size="sm" onClick={handleBulkDownload}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Download ({selectedEvents.size})
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {error && <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md mb-3">{error}</div>}
          {events.length === 0 && !loading && !error ? (
            <div className="text-center py-10 text-muted-foreground">No Zoom recordings found for the selected date range.</div>
          ) : events.length > 0 ? (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <input type="checkbox" className="w-4 h-4 rounded border-gray-300 accent-[var(--big-navy)]"
                        checked={currentEvents.length > 0 && selectedEvents.size === currentEvents.length}
                        onChange={toggleAllEvents} />
                    </TableHead>
                    <TableHead className="w-[200px]">Action</TableHead>
                    <TableHead>Meeting Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={5} className="h-24 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></TableCell></TableRow>
                  ) : currentEvents.map((event) => {
                    const activeDl = activeDownloads.find(d => d.url === event.externalMediaUrl);
                    return (
                      <TableRow key={event.id}>
                        <TableCell>
                          <input type="checkbox" className="w-4 h-4 rounded border-gray-300 accent-[var(--big-navy)]"
                            checked={selectedEvents.has(event.id)} onChange={() => toggleEventSelection(event.id)} />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-start gap-2">
                            {activeDl && activeDl.state === 'inProgress' ? (
                              <div className="w-full max-w-[120px]">
                                <div className="text-xs mb-1 text-muted-foreground">{Math.round(activeDl.percent)}%</div>
                                <div className="w-full bg-muted rounded-full h-2">
                                  <div className="big-gradient h-2 rounded-full transition-all" style={{ width: `${activeDl.percent}%` }} />
                                </div>
                              </div>
                            ) : activeDl && activeDl.state === 'completed' ? (
                              <Badge variant="secondary" className="text-green-600">Downloaded</Badge>
                            ) : activeDl && activeDl.state === 'starting' ? (
                              <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Starting...</Badge>
                            ) : activeDl && (activeDl.state === 'error' || activeDl.state === 'timeout') ? (
                              <Badge variant="destructive">{activeDl.state === 'timeout' ? 'Timeout' : 'Error'}</Badge>
                            ) : activeDl && activeDl.state === 'canceled' ? (
                              <Badge variant="outline">Canceled</Badge>
                            ) : (
                              <>
                                <Button variant="outline" size="sm" onClick={() => handleDownload(event.externalMediaUrl)}
                                  disabled={downloadingUrl === event.externalMediaUrl}>
                                  {downloadingUrl === event.externalMediaUrl ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                                  Download
                                </Button>
                                <Button variant="secondary" size="sm" nativeButton={false}
                                  render={<a href={event.externalMediaUrl} target="_blank" rel="noopener noreferrer" />}>
                                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{event.eventName}</TableCell>
                        <TableCell>{event.categoryName}</TableCell>
                        <TableCell>{format(new Date(event.eventDate), "MMM d, yyyy h:mm a")}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, events.length)} of {events.length}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
