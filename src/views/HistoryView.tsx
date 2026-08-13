import { useEffect, useMemo, useState } from "react";
import {
   Copy,
   Download,
   Eye,
   FolderOpen,
   History,
   RefreshCw,
   Search,
   Trash2,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Thumbnail } from "@/components/Thumbnail";
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from "@/components/ui/select";
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from "@/components/ui/dialog";
import { useHistoryStore } from "@/stores/history";
import { api, clipboard } from "@/lib/api";
import { toast } from "@/stores/toast";
import {
   formatBytes,
   formatDuration,
   formatTimeAgo,
   qualityLabel,
} from "@/lib/format";

export function HistoryView() {
   const { items, loaded, refresh } = useHistoryStore();
   const query = useHistoryStore((s) => s.query);
   const formatFilter = useHistoryStore((s) => s.formatFilter);
   const statusFilter = useHistoryStore((s) => s.statusFilter);
   const sort = useHistoryStore((s) => s.sort);

   useEffect(() => {
      refresh();
   }, [query, formatFilter, statusFilter, sort]);

   const stats = useMemo(() => {
      const total = items.length;
      const size = items.reduce((acc, i) => acc + (i.fileSize ?? 0), 0);
      return { total, size };
   }, [items]);

   return (
      <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
         <div className="flex items-end justify-between">
            <div>
               <h1 className="text-xl font-semibold tracking-tight">History</h1>
               <p className="text-sm text-muted-foreground">
                  {loaded ? (
                     <>
                        {stats.total} item{stats.total === 1 ? "" : "s"} ·{" "}
                        {formatBytes(stats.size)} downloaded
                     </>
                  ) : (
                     "Loading…"
                  )}
               </p>
            </div>
            {items.length > 0 && (
               <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                     useHistoryStore.getState().clearAll();
                     toast(
                        "Cleared",
                        "Download history cleared. Files were not deleted.",
                        "success",
                     );
                  }}
               >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear history
               </Button>
            )}
         </div>

         {/* Filters */}
         <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
               <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
               <Input
                  className="pl-8"
                  placeholder="Search by title or URL…"
                  value={query}
                  onChange={(e) =>
                     useHistoryStore.getState().setQuery(e.target.value)
                  }
               />
            </div>
            <Select
               value={formatFilter}
               onValueChange={(v) =>
                  useHistoryStore.getState().setFormatFilter(v)
               }
            >
               <SelectTrigger className="w-28">
                  <SelectValue placeholder="Format" />
               </SelectTrigger>
               <SelectContent>
                  <SelectItem value="all">All formats</SelectItem>
                  <SelectItem value="mp3">MP3</SelectItem>
                  <SelectItem value="mp4">MP4</SelectItem>
               </SelectContent>
            </Select>
            <Select
               value={statusFilter}
               onValueChange={(v) =>
                  useHistoryStore.getState().setStatusFilter(v)
               }
            >
               <SelectTrigger className="w-32">
                  <SelectValue placeholder="Status" />
               </SelectTrigger>
               <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
               </SelectContent>
            </Select>
            <Select
               value={sort}
               onValueChange={(v) => useHistoryStore.getState().setSort(v)}
            >
               <SelectTrigger className="w-32">
                  <SelectValue placeholder="Sort" />
               </SelectTrigger>
               <SelectContent>
                  <SelectItem value="date">Newest first</SelectItem>
                  <SelectItem value="title">By title</SelectItem>
                  <SelectItem value="format">By format</SelectItem>
               </SelectContent>
            </Select>
            <Button
               variant="ghost"
               size="icon"
               onClick={refresh}
               aria-label="Refresh history"
            >
               <RefreshCw className="h-4 w-4" />
            </Button>
         </div>

         {items.length === 0 ? (
            <EmptyState
               icon={History}
               title="No history yet"
               description="Completed downloads will appear here so you can find them again quickly."
            />
         ) : (
            <div className="space-y-2">
               {items.map((item) => (
                  <HistoryRow
                     key={item.id}
                     id={item.id}
                  />
               ))}
            </div>
         )}
      </div>
   );
}

function HistoryRow({ id }: { id: string }) {
   const item = useHistoryStore((s) => s.items.find((i) => i.id === id));
   const [confirmDelete, setConfirmDelete] = useState(false);

   if (!item) return null;

   return (
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-3">
         <Thumbnail
            src={item.thumbnail}
            className="h-12 w-20 shrink-0"
            rounded="rounded-md"
         />
         <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
               <span className="truncate text-sm font-medium">
                  {item.title ?? "Untitled media"}
               </span>
               <Badge
                  variant="muted"
                  className="shrink-0"
               >
                  {item.format.toUpperCase()}
               </Badge>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
               <span>{formatTimeAgo(item.createdAt)}</span>
               <span>{qualityLabel(item.quality)}</span>
               {item.fileSize != null && (
                  <span>{formatBytes(item.fileSize)}</span>
               )}
               {item.duration != null && (
                  <span>{formatDuration(item.duration)}</span>
               )}
               {item.status === "completed" && (
                  <span
                     className="truncate text-muted-foreground/70"
                     title={item.filePath}
                  >
                     {item.filePath}
                  </span>
               )}
            </div>
         </div>
         <div className="flex shrink-0 items-center gap-1">
            {item.status === "completed" && (
               <>
                  <RowButton
                     label="Open file"
                     onClick={() =>
                        api
                           .openFile(item.filePath)
                           .catch(() =>
                              toast(
                                 "Could not open file",
                                 undefined,
                                 "destructive",
                              ),
                           )
                     }
                  >
                     <Eye className="h-4 w-4" />
                  </RowButton>
                  <RowButton
                     label="Show in folder"
                     onClick={() =>
                        api.revealInFolder(item.filePath).catch(() => undefined)
                     }
                  >
                     <FolderOpen className="h-4 w-4" />
                  </RowButton>
               </>
            )}
            <RowButton
               label="Copy source URL"
               onClick={async () => {
                  await clipboard.writeText(item.url);
                  toast("Copied", "Source URL copied to clipboard.", "success");
               }}
            >
               <Copy className="h-4 w-4" />
            </RowButton>
            <RowButton
               label="Download again"
               onClick={async () => {
                  try {
                     await api.startDownload({
                        url: item.url,
                        format: item.format,
                        quality: item.quality,
                        title: item.title,
                        thumbnail: item.thumbnail,
                        mediaId: item.mediaId ?? null,
                        extractor: item.extractor,
                        duration: item.duration,
                     });
                     toast("Re-queued", item.title ?? undefined, "success");
                  } catch (e) {
                     toast(
                        "Could not re-download",
                        (e as Error).message,
                        "destructive",
                     );
                  }
               }}
            >
               <Download className="h-4 w-4" />
            </RowButton>
            <RowButton
               label="Remove from history"
               onClick={() => setConfirmDelete(true)}
            >
               <Trash2 className="h-4 w-4 text-destructive" />
            </RowButton>
         </div>

         <Dialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
         >
            <DialogContent className="max-w-sm">
               <DialogHeader>
                  <DialogTitle>Remove from history?</DialogTitle>
                  <DialogDescription>
                     The downloaded file on disk will <strong>not</strong> be
                     deleted. Only this history entry is removed.
                  </DialogDescription>
               </DialogHeader>
               <DialogFooter>
                  <Button
                     variant="outline"
                     onClick={() => setConfirmDelete(false)}
                  >
                     Cancel
                  </Button>
                  <Button
                     variant="destructive"
                     onClick={async () => {
                        await useHistoryStore.getState().removeItem(id);
                        setConfirmDelete(false);
                     }}
                  >
                     Remove
                  </Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>
      </div>
   );
}

function RowButton({
   label,
   onClick,
   children,
}: {
   label: string;
   onClick: () => void;
   children: React.ReactNode;
}) {
   return (
      <button
         onClick={onClick}
         className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
         title={label}
         aria-label={label}
      >
         {children}
      </button>
   );
}
