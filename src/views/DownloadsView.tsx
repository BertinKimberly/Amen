import { useMemo } from "react";
import {
   Download,
   Eye,
   FileAudio,
   FileVideo,
   FolderOpen,
   Loader2,
   RefreshCw,
   Trash2,
   XCircle,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/StatusBadge";
import { Thumbnail } from "@/components/Thumbnail";
import {
   Tooltip,
   TooltipContent,
   TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQueueStore } from "@/stores/queue";
import { api } from "@/lib/api";
import { toast } from "@/stores/toast";
import { formatBytes, qualityLabel } from "@/lib/format";
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useStudioStore } from "@/stores/studio";
import { useAppStore } from "@/stores/app";
import { Scissors } from "lucide-react";

export function DownloadsView() {
   const jobs = useQueueStore((s) => s.jobs);
   const refresh = useQueueStore((s) => s.refresh);
   const hasTerminal = useMemo(
      () => jobs.some((j) => TERMINAL_STATUSES.includes(j.status)),
      [jobs],
   );

   if (jobs.length === 0) {
      return (
         <div className="mx-auto max-w-6xl px-8 py-6">
            <Header />
            <EmptyState
               icon={Download}
               title="No downloads yet"
               description="Add a URL on the Home screen and your queue will show up here with live progress."
            />
         </div>
      );
   }

   return (
      <div className="mx-auto max-w-6xl space-y-4 px-8 py-6">
         <Header
            count={jobs.length}
            onRefresh={refresh}
            hasTerminal={hasTerminal}
         />
         <div className="space-y-3">
            {jobs.map((j) => (
               <QueueCard
                  key={j.id}
                  job={j}
               />
            ))}
         </div>
      </div>
   );
}

function Header({
   count,
   onRefresh,
   hasTerminal,
}: {
   count?: number;
   onRefresh?: () => void;
   hasTerminal?: boolean;
}) {
   return (
      <div className="flex items-center justify-between">
         <div>
            <h1 className="text-xl font-semibold tracking-tight">Downloads</h1>
            <p className="text-sm text-muted-foreground">
               {count != null
                  ? `${count} item${count === 1 ? "" : "s"} in queue`
                  : "Track your downloads here."}
            </p>
         </div>
         <div className="flex gap-2">
            {hasTerminal && (
               <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                     await useQueueStore.getState().clearCompleted();
                     toast(
                        "Cleared",
                        "Completed and failed items removed from the queue.",
                        "success",
                     );
                  }}
               >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear finished
               </Button>
            )}
            {onRefresh && (
               <Button
                  variant="outline"
                  size="icon"
                  onClick={onRefresh}
                  aria-label="Refresh queue"
               >
                  <RefreshCw className="h-4 w-4" />
               </Button>
            )}
         </div>
      </div>
   );
}

function QueueCard({
   job,
}: {
   job: ReturnType<typeof useQueueStore.getState>["jobs"][number];
}) {
   const active = ACTIVE_STATUSES.includes(job.status);
   const failed = job.status === "failed";
   const canCancel = [
      "pending",
      "fetching",
      "downloading",
      "processing",
   ].includes(job.status);
   const canRetry = ["failed", "cancelled", "interrupted"].includes(job.status);
   const canOpen = job.status === "completed" && job.outputPath;
   const isAudio = job.format === "mp3";


   return (
      <div
         className={cn(
            "rounded-2xl border bg-card p-4 shadow-sm transition-colors",
            failed ? "border-destructive/25" : "border-border",
         )}
      >
         <div className="flex gap-4">
            <Thumbnail
               src={job.thumbnail}
               alt={job.title ?? ""}
               className="h-16 w-28 shrink-0"
               rounded="rounded-lg"
            />
            <div className="min-w-0 flex-1">
               <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                     <h3 className="truncate text-sm font-semibold">
                        {job.title ?? "Untitled media"}
                     </h3>
                     <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                           {job.format === "mp3" ? (
                              <FileAudio className="h-3 w-3" />
                           ) : (
                              <FileVideo className="h-3 w-3" />
                           )}
                           {job.format.toUpperCase()} ·{" "}
                           {qualityLabel(job.quality)}
                        </span>
                        {job.downloaded != null && job.downloaded > 0 && (
                           <span>{formatBytes(job.downloaded)}</span>
                        )}
                        {job.speed && <span>{job.speed}</span>}
                        {job.eta && <span>ETA {job.eta}</span>}
                     </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                     <StatusBadge status={job.status} />
                     {canCancel && (
                        <ActionButton
                           label="Cancel"
                           onClick={async () => {
                              await useQueueStore.getState().cancel(job.id);
                              toast(
                                 "Cancelled",
                                 job.title ?? undefined,
                                 "info",
                              );
                           }}
                        >
                           <XCircle className="h-4 w-4 text-destructive" />
                        </ActionButton>
                     )}
                     {canRetry && (
                        <ActionButton
                           label="Retry"
                           onClick={async () => {
                              await useQueueStore.getState().retry(job.id);
                              toast(
                                 "Re-queued",
                                 job.title ?? undefined,
                                 "success",
                              );
                           }}
                        >
                           <RefreshCw className="h-4 w-4 text-primary" />
                        </ActionButton>
                     )}
                     {canOpen && (
                        <>
                           <ActionButton
                              label="Open file"
                              onClick={async () => {
                                 if (job.outputPath)
                                    await api.openFile(job.outputPath);
                              }}
                           >
                              <Eye className="h-4 w-4" />
                           </ActionButton>
                           <ActionButton
                              label="Open containing folder"
                              onClick={async () => {
                                 if (job.outputPath)
                                    await api.revealInFolder(job.outputPath);
                              }}
                           >
                              <FolderOpen className="h-4 w-4" />
                           </ActionButton>
                           {isAudio && (
                              <ActionButton
                                 label="Open in Audio Studio"
                                 onClick={async () => {
                                    if (job.outputPath) {
                                       await useStudioStore.getState().addSource(job.outputPath);
                                       useAppStore.getState().setView("studio");
                                    }
                                 }}
                              >
                                 <Scissors className="h-4 w-4" />
                              </ActionButton>
                           )}
                        </>
                     )}
                     <ActionButton
                        label="Remove from queue"
                        onClick={async () => {
                           await useQueueStore.getState().removeJob(job.id);
                        }}
                     >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                     </ActionButton>
                  </div>
               </div>

               {/* Progress / stage */}
               {active && (
                  <div className="mt-3">
                     <Progress
                        value={job.progress}
                        indeterminate={
                           job.status === "fetching" || job.progress === 0
                        }
                        indicatorClassName={cn(
                           job.status === "processing" && "bg-warning",
                           job.status === "fetching" && "bg-info",
                        )}
                     />
                     <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                           <Loader2 className="h-3 w-3 animate-spin" />
                           {job.stage ?? job.status}
                        </span>
                        <span className="tabular-nums">
                           {job.progress > 0
                              ? `${Math.round(job.progress)}%`
                              : ""}
                           {job.total ? ` of ${formatBytes(job.total)}` : ""}
                        </span>
                     </div>
                  </div>
               )}

               {failed && job.error && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-destructive/8 px-3 py-2 text-[12px] text-destructive">
                     <span className="flex-1">{job.error}</span>
                     <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-2 text-[11px]"
                        onClick={() => {
                           const detail = `[${job.id}] ${job.title ?? ""}\nURL: ${job.url}\nStatus: ${job.status}\nError: ${job.error}`;
                           navigator.clipboard
                              .writeText(detail)
                              .catch(() => undefined);
                           toast(
                              "Copied",
                              "Job diagnostics copied to clipboard.",
                              "success",
                           );
                        }}
                     >
                        Copy diagnostics
                     </Button>
                  </div>
               )}
            </div>
         </div>
      </div>
   );
}

function ActionButton({
   label,
   onClick,
   children,
}: {
   label: string;
   onClick: () => void;
   children: React.ReactNode;
}) {
   return (
      <Tooltip>
         <TooltipTrigger asChild>
            <button
               onClick={onClick}
               className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
               aria-label={label}
            >
               {children}
            </button>
         </TooltipTrigger>
         <TooltipContent>{label}</TooltipContent>
      </Tooltip>
   );
}
