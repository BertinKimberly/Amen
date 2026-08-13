import { useMemo, useState } from "react";
import {
   AlertTriangle,
   ArrowRight,
   CheckCircle2,
   CircleAlert,
   FileAudio,
   FileVideo,
   Loader2,
   Sparkles,
} from "lucide-react";
import { UrlBar } from "@/components/home/UrlBar";
import { MediaPreview } from "@/components/home/MediaPreview";
import { PlaylistPreview } from "@/components/home/PlaylistPreview";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app";
import { useQueueStore } from "@/stores/queue";
import { useSettingsStore } from "@/stores/settings";
import { api, clipboard } from "@/lib/api";
import { toast } from "@/stores/toast";
import type { MediaFormat, QualityOption } from "@/lib/types";
import { ACTIVE_STATUSES } from "@/lib/constants";
import { formatBytes } from "@/lib/format";

export function HomeView() {
   const { analyzing, analysisError, media, playlist, analyze } = useAppStore();
   const deps = useAppStore((s) => s.deps);
   const setView = useAppStore((s) => s.setView);
   const refreshDeps = useAppStore((s) => s.refreshDeps);

   const jobs = useQueueStore((s) => s.jobs);
   const settings = useSettingsStore((s) => s.settings);

   const [format, setFormat] = useState<MediaFormat>(
      () => (settings?.defaultFormat as MediaFormat) ?? "mp3",
   );
   const [quality, setQuality] = useState<QualityOption>(
      () => (settings?.defaultQuality as QualityOption) ?? "best",
   );
   const [starting, setStarting] = useState(false);

   const activeJobs = useMemo(
      () => jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)),
      [jobs],
   );
   const recentJobs = useMemo(() => jobs.slice(0, 6), [jobs]);

   const destination = settings?.outputDir ?? "";

   const handleDownload = async (
      items: {
         url: string;
         title?: string | null;
         thumbnail?: string | null;
         index?: number | null;
      }[],
   ) => {
      if (!items.length) {
         toast(
            "Nothing selected",
            "Select at least one item to download.",
            "info",
         );
         return;
      }
      setStarting(true);
      try {
         for (const item of items) {
            await api.startDownload({
               url: item.url,
               format,
               quality,
               title: item.title ?? null,
               thumbnail: item.thumbnail ?? null,
               playlistTitle: playlist?.title ?? media?.title ?? null,
               playlistIndex: item.index ?? null,
               duration: media?.duration ?? null,
               extractor: media?.extractor ?? playlist?.extractor ?? null,
            });
         }
         const label = items.length === 1 ? "1 item" : `${items.length} items`;
         toast(
            `${label} added to the queue`,
            items.length === 1
               ? "Download started — see the Downloads view."
               : "Added to the download queue.",
            "success",
         );
         setView("downloads");
      } catch (e) {
         toast(
            "Could not start download",
            (e as Error)?.message ?? "Unknown error",
            "destructive",
         );
      } finally {
         setStarting(false);
      }
   };

   const handleBrowseDestination = async () => {
      const picked = await api.selectDirectory(destination);
      if (picked) {
         await useSettingsStore.getState().save({ outputDir: picked });
         toast("Destination updated", picked, "success");
      }
   };

   return (
      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
         {/* Hero */}
         <div className="pt-2">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
               What do you want to download today?
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
               Paste a link, we analyze it locally, and you choose the format
               and quality. Everything is processed on your machine with yt-dlp
               + FFmpeg.
            </p>
         </div>

         <UrlBar
            onAnalyze={(url) => analyze(url)}
            analyzing={analyzing}
         />

         {/* Health strip */}
         <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-muted-foreground">System:</span>
            <HealthChip
               ok={deps?.ytdlp.found}
               label="yt-dlp"
            />
            <HealthChip
               ok={deps?.ffmpeg.found}
               label="FFmpeg"
            />
            <HealthChip
               ok={deps?.outputDir.ok}
               label="Output folder"
            />
            {!deps?.ytdlp.found || !deps?.ffmpeg.found ? (
               <Button
                  variant="outline"
                  size="sm"
                  className="ml-1 h-7 gap-1 text-[12px]"
                  onClick={() => setView("diagnostics")}
               >
                  Fix setup <ArrowRight className="h-3 w-3" />
               </Button>
            ) : (
               <button
                  onClick={() => {
                     refreshDeps();
                     setView("diagnostics");
                  }}
                  className="ml-1 text-primary hover:underline"
               >
                  Details
               </button>
            )}
         </div>

         {/* Analysis states */}
         {analyzing && <AnalyzingSkeleton />}

         {!analyzing && analysisError && (
            <div className="animate-slide-up rounded-2xl border border-destructive/25 bg-destructive/5 p-5">
               <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <div className="flex-1">
                     <h3 className="font-semibold text-destructive">
                        {analysisError.message}
                     </h3>
                     {analysisError.code === "dependency_missing" && (
                        <p className="mt-1 text-sm text-muted-foreground">
                           The required tools are missing. Open Diagnostics to
                           install them.
                        </p>
                     )}
                     {analysisError.detail && (
                        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-background/60 p-3 text-[11px] text-muted-foreground">
                           {analysisError.detail}
                        </pre>
                     )}
                     <div className="mt-3 flex gap-2">
                        <Button
                           size="sm"
                           variant="outline"
                           onClick={async () => {
                              await clipboard.writeText(
                                 analysisError.detail ?? analysisError.message,
                              );
                              toast(
                                 "Copied",
                                 "Error details copied to clipboard.",
                                 "success",
                              );
                           }}
                        >
                           Copy details
                        </Button>
                        {analysisError.code === "dependency_missing" ? (
                           <Button
                              size="sm"
                              onClick={() => setView("diagnostics")}
                           >
                              Open Diagnostics
                           </Button>
                        ) : (
                           <Button
                              size="sm"
                              onClick={() =>
                                 useAppStore.getState().clearAnalysis()
                              }
                           >
                              Try another URL
                           </Button>
                        )}
                     </div>
                  </div>
               </div>
            </div>
         )}

         {!analyzing && !analysisError && media && (
            <MediaPreview
               media={media}
               format={format}
               setFormat={setFormat}
               quality={quality}
               setQuality={setQuality}
               destination={destination}
               onBrowseDestination={handleBrowseDestination}
               onDownload={() =>
                  handleDownload([
                     { url: media.webpageUrl ?? media.originalUrl ?? "" },
                  ])
               }
               downloading={starting}
            />
         )}

         {!analyzing && !analysisError && playlist && (
            <PlaylistPreview
               playlist={playlist}
               format={format}
               setFormat={setFormat}
               quality={quality}
               setQuality={setQuality}
               destination={destination}
               onBrowseDestination={handleBrowseDestination}
               onDownload={handleDownload}
               downloading={starting}
            />
         )}

         {/* Queue overview */}
         <section className="space-y-3">
            <div className="flex items-center justify-between">
               <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {activeJobs.length > 0
                     ? "Active downloads"
                     : "Recent downloads"}
               </h2>
               {jobs.length > 0 && (
                  <button
                     onClick={() => setView("downloads")}
                     className="text-xs font-medium text-primary hover:underline"
                  >
                     View all
                  </button>
               )}
            </div>

            {jobs.length === 0 ? (
               <EmptyState
                  icon={Sparkles}
                  title="Your downloads will appear here"
                  description="Paste a URL above and hit Analyze to get started."
               />
            ) : (
               <div className="grid gap-2 sm:grid-cols-2">
                  {(activeJobs.length > 0
                     ? activeJobs.slice(0, 4)
                     : recentJobs
                  ).map((j) => (
                     <div
                        key={j.id}
                        className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
                     >
                        <div
                           className={
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " +
                              (j.format === "mp3"
                                 ? "bg-primary/12 text-primary"
                                 : "bg-info/12 text-info")
                           }
                        >
                           {j.format === "mp3" ? (
                              <FileAudio className="h-4 w-4" />
                           ) : (
                              <FileVideo className="h-4 w-4" />
                           )}
                        </div>
                        <div className="min-w-0 flex-1">
                           <div className="truncate text-[13px] font-medium">
                              {j.title ?? "Untitled"}
                           </div>
                           <div className="text-[11px] text-muted-foreground">
                              {j.status === "completed"
                                 ? `${j.format.toUpperCase()} · ${formatBytes(j.fileSize)}`
                                 : (j.stage ?? j.status)}
                              {j.status === "downloading" && j.progress > 0
                                 ? ` · ${Math.round(j.progress)}%`
                                 : ""}
                           </div>
                        </div>
                        {ACTIVE_STATUSES.includes(j.status) && (
                           <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                        )}
                     </div>
                  ))}
               </div>
            )}
         </section>
      </div>
   );
}

function HealthChip({ ok, label }: { ok?: boolean; label: string }) {
   return (
      <span
         className={
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 " +
            (ok
               ? "border-success/25 bg-success/10 text-success"
               : "border-warning/30 bg-warning/10 text-warning")
         }
      >
         {ok ? (
            <CheckCircle2 className="h-3 w-3" />
         ) : (
            <CircleAlert className="h-3 w-3" />
         )}
         {label}
      </span>
   );
}

function AnalyzingSkeleton() {
   return (
      <div className="animate-fade-in overflow-hidden rounded-2xl border border-border bg-card">
         <div className="flex flex-col gap-5 p-5 sm:flex-row">
            <Skeleton className="aspect-video w-full sm:w-64" />
            <div className="flex-1 space-y-3">
               <Skeleton className="h-6 w-3/4" />
               <Skeleton className="h-4 w-1/2" />
               <Skeleton className="h-4 w-2/3" />
               <div className="pt-2">
                  <Skeleton className="h-9 w-2/3" />
               </div>
            </div>
         </div>
      </div>
   );
}
