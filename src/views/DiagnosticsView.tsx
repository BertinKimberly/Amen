import { useCallback, useEffect, useState } from "react";
import {
   CheckCircle2,
   ClipboardCopy,
   CloudDownload,
   Cpu,
   FileWarning,
   FolderOpen,
   HardDrive,
   Network,
   RefreshCw,
   Sparkles,
   XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useAppStore } from "@/stores/app";
import { api, onEvent, clipboard } from "@/lib/api";
import { toast } from "@/stores/toast";
import type { InstallProgressEvent, YtdlpUpdateInfo } from "@/lib/types";
import { formatBytes } from "@/lib/format";

export function DiagnosticsView() {
   const { deps, refreshDeps } = useAppStore();
   const [loading, setLoading] = useState(false);
   const [installing, setInstalling] = useState(false);
   const [installProgress, setInstallProgress] =
      useState<InstallProgressEvent | null>(null);
   const [updateInfo, setUpdateInfo] = useState<YtdlpUpdateInfo | null>(null);
   const [updating, setUpdating] = useState(false);

   const run = useCallback(async () => {
      setLoading(true);
      await refreshDeps();
      setLoading(false);
   }, []);

   useEffect(() => {
      run();
      const un = onEvent("install-progress", (p) => setInstallProgress(p));
      return () => {
         un.then((fn) => fn());
      };
   }, []);

   const install = async (what: "all" | "yt-dlp" | "ffmpeg") => {
      setInstalling(true);
      setInstallProgress(null);
      try {
         await api.installDependencies(what);
         toast("Installed", "Dependencies are ready.", "success");
         await refreshDeps();
      } catch (e) {
         toast("Install failed", (e as Error).message, "destructive");
      } finally {
         setInstalling(false);
         setInstallProgress(null);
      }
   };

   const checkUpdate = async () => {
      try {
         const info = await api.checkYtdlpUpdate();
         setUpdateInfo(info);
         toast(
            info.updateAvailable ? "Update available" : "yt-dlp is up to date",
            info.updateAvailable
               ? `New version: ${info.latest} (you have ${info.current}).`
               : `You have the latest version (${info.current}).`,
            info.updateAvailable ? "info" : "success",
         );
      } catch (e) {
         toast("Update check failed", (e as Error).message, "destructive");
      }
   };

   const doUpdate = async () => {
      setUpdating(true);
      try {
         const out = await api.updateYtdlp();
         toast(
            "yt-dlp updated",
            out.split("\n").filter(Boolean).pop(),
            "success",
         );
         await refreshDeps();
         setUpdateInfo(null);
      } catch (e) {
         toast("Update failed", (e as Error).message, "destructive");
      } finally {
         setUpdating(false);
      }
   };

   const missing = deps && (!deps.ytdlp.found || !deps.ffmpeg.found);

   return (
      <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
         <div className="flex items-center justify-between">
            <div>
               <h1 className="text-xl font-semibold tracking-tight">
                  Diagnostics
               </h1>
               <p className="text-sm text-muted-foreground">
                  Real checks of your local environment — not simulated.
               </p>
            </div>
            <Button
               variant="outline"
               size="sm"
               onClick={run}
               disabled={loading}
            >
               {loading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
               Re-check
            </Button>
         </div>

         {missing && !loading && (
            <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5">
               <div className="flex items-start gap-3">
                  <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                  <div className="flex-1">
                     <h3 className="font-semibold">
                        Some components are missing
                     </h3>
                     <p className="mt-1 text-sm text-muted-foreground">
                        Amen needs yt-dlp and FFmpeg to work. You
                        can install them automatically from official sources
                        below, or add them to your PATH and re-check.
                     </p>
                     <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                           size="sm"
                           onClick={() => install("all")}
                           disabled={installing}
                        >
                           {installing ? (
                              <Spinner />
                           ) : (
                              <CloudDownload className="h-3.5 w-3.5" />
                           )}
                           Install both
                        </Button>
                        {!deps?.ytdlp.found && (
                           <Button
                              size="sm"
                              variant="outline"
                              onClick={() => install("yt-dlp")}
                              disabled={installing}
                           >
                              {installing &&
                              installProgress?.stage === "yt-dlp" ? (
                                 <Spinner />
                              ) : (
                                 <CloudDownload className="h-3.5 w-3.5" />
                              )}
                              Install yt-dlp
                           </Button>
                        )}
                        {!deps?.ffmpeg.found && (
                           <Button
                              size="sm"
                              variant="outline"
                              onClick={() => install("ffmpeg")}
                              disabled={installing}
                           >
                              {installing &&
                              installProgress?.stage === "ffmpeg" ? (
                                 <Spinner />
                              ) : (
                                 <CloudDownload className="h-3.5 w-3.5" />
                              )}
                              Install FFmpeg
                           </Button>
                        )}
                     </div>
                  </div>
               </div>
            </div>
         )}

         {installing && installProgress && (
            <Card>
               <CardContent className="p-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                     <span className="font-medium">
                        {installProgress.message}
                     </span>
                     <Badge variant="muted">{installProgress.stage}</Badge>
                  </div>
                  <Progress
                     value={installProgress.percent ?? 0}
                     indeterminate={installProgress.percent == null}
                  />
               </CardContent>
            </Card>
         )}

         {loading && !deps ? (
            <div className="grid gap-3">
               {[0, 1, 2, 3].map((i) => (
                  <div
                     key={i}
                     className="h-16 animate-pulse rounded-2xl bg-secondary/50"
                  />
               ))}
            </div>
         ) : deps ? (
            <>
               <div className="grid gap-3 sm:grid-cols-2">
                  <ToolCheck
                     name="yt-dlp"
                     ok={deps.ytdlp.found}
                     version={deps.ytdlp.version ?? "n/a"}
                     source={deps.ytdlp.source}
                     path={deps.ytdlp.path}
                  />
                  <ToolCheck
                     name="FFmpeg"
                     ok={deps.ffmpeg.found}
                     version={deps.ffmpeg.version ?? "n/a"}
                     source={deps.ffmpeg.source}
                     path={deps.ffmpeg.path}
                  />
                  <ToolCheck
                     name="ffprobe"
                     ok={deps.ffprobe.found}
                     version={deps.ffprobe.version ?? "n/a"}
                     source={deps.ffprobe.source}
                     path={deps.ffprobe.path}
                  />
                  <ToolCheck
                     name="Output directory"
                     ok={deps.outputDir.ok}
                     version="writable"
                     source=""
                     path={deps.outputDir.path}
                     error={deps.outputDir.error ?? undefined}
                  />
               </div>

               <div className="grid gap-3 sm:grid-cols-3">
                  <SimpleCheck
                     icon={HardDrive}
                     label="Disk space"
                     ok={deps.diskSpace.ok}
                     value={formatBytes(deps.diskSpace.freeBytes) + " free"}
                     detail={deps.diskSpace.error ?? undefined}
                  />
                  <SimpleCheck
                     icon={Network}
                     label="Network"
                     ok={deps.network.ok}
                     value={
                        deps.network.ok
                           ? `reachable (${deps.network.latencyMs ?? "?"} ms)`
                           : "unreachable"
                     }
                     detail={deps.network.error ?? undefined}
                  />
                  <SimpleCheck
                     icon={Cpu}
                     label="Python"
                     ok={!!deps.python}
                     value={deps.python ? "launcher found" : "not required"}
                     detail={deps.python ?? undefined}
                  />
               </div>

               {/* yt-dlp update */}
               <Card>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                     <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary">
                           <Sparkles className="h-4 w-4" />
                        </div>
                        <div>
                           <div className="text-sm font-medium">
                              yt-dlp updates
                           </div>
                           <div className="text-[12px] text-muted-foreground">
                              {updateInfo
                                 ? `You have ${updateInfo.current}. Latest is ${updateInfo.latest}.`
                                 : deps.ytdlp.found
                                   ? `Current version: ${deps.ytdlp.version ?? "unknown"}`
                                   : "yt-dlp is not installed."}
                           </div>
                        </div>
                     </div>
                     <div className="flex gap-2">
                        <Button
                           variant="outline"
                           size="sm"
                           onClick={checkUpdate}
                        >
                           <RefreshCw className="h-3.5 w-3.5" />
                           Check for updates
                        </Button>
                        {updateInfo?.updateAvailable && (
                           <Button
                              size="sm"
                              onClick={doUpdate}
                              disabled={updating}
                           >
                              {updating ? (
                                 <Spinner />
                              ) : (
                                 <CloudDownload className="h-3.5 w-3.5" />
                              )}
                              Update
                           </Button>
                        )}
                     </div>
                  </CardContent>
               </Card>

               <Card>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                     <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary">
                           <FolderOpen className="h-4 w-4" />
                        </div>
                        <div>
                           <div className="text-sm font-medium">
                              Logs & diagnostics
                           </div>
                           <div className="text-[12px] text-muted-foreground">
                              Structured logs are stored locally at{" "}
                              {deps.toolsDir.replace(/\\tools$/, "\\logs")}.
                           </div>
                        </div>
                     </div>
                     <div className="flex gap-2">
                        <Button
                           variant="outline"
                           size="sm"
                           onClick={async () => {
                              const logs = await api.getLogsDir();
                              await api.openFolder(logs);
                           }}
                        >
                           <FolderOpen className="h-3.5 w-3.5" />
                           Open logs folder
                        </Button>
                        <Button
                           variant="outline"
                           size="sm"
                           onClick={async () => {
                              const text = await api.getDiagnosticText();
                              await clipboard.writeText(text);
                              toast(
                                 "Copied",
                                 "Full diagnostic report copied to clipboard.",
                                 "success",
                              );
                           }}
                        >
                           <ClipboardCopy className="h-3.5 w-3.5" />
                           Copy report
                        </Button>
                     </div>
                  </CardContent>
               </Card>

               <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
                  Components are found on your PATH, at explicit paths
                  configured in Settings, or in the bundled tools folder (
                  {deps.toolsDir}). Installing uses official sources: yt-dlp
                  from GitHub releases, FFmpeg from gyan.dev Windows builds.
                  Nothing is downloaded from third-party sites.
               </p>
            </>
         ) : null}
      </div>
   );
}

function ToolCheck({
   name,
   ok,
   version,
   source,
   path,
   error,
}: {
   name: string;
   ok: boolean;
   version: string;
   source: string;
   path?: string | null;
   error?: string;
}) {
   return (
      <div className="rounded-2xl border border-border bg-card p-4">
         <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold">
               {ok ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
               ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
               )}
               {name}
            </span>
            <Badge variant={ok ? "success" : "destructive"}>
               {ok ? "Installed" : "Missing"}
            </Badge>
         </div>
         <div className="mt-2 text-[12px] text-muted-foreground">
            <div>
               Version:{" "}
               <span className="font-medium text-foreground/80">{version}</span>
            </div>
            {source && (
               <div>
                  Source:{" "}
                  <span className="font-medium text-foreground/80">
                     {source}
                  </span>
               </div>
            )}
            {path && (
               <div
                  className="truncate"
                  title={path}
               >
                  Path:{" "}
                  <span className="font-mono text-foreground/60">{path}</span>
               </div>
            )}
            {error && <div className="text-destructive">{error}</div>}
         </div>
      </div>
   );
}

function SimpleCheck({
   icon: Icon,
   label,
   ok,
   value,
   detail,
}: {
   icon: typeof HardDrive;
   label: string;
   ok: boolean;
   value: string;
   detail?: string;
}) {
   return (
      <div className="rounded-2xl border border-border bg-card p-4">
         <div className="flex items-center gap-2 text-sm font-semibold">
            {ok ? (
               <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
               <XCircle className="h-4 w-4 text-destructive" />
            )}
            <Icon className="h-4 w-4 text-muted-foreground" />
            {label}
         </div>
         <div className="mt-2 text-[12px] text-muted-foreground">
            <div className="font-medium text-foreground/80">{value}</div>
            {detail && <div className="mt-0.5 text-destructive">{detail}</div>}
         </div>
      </div>
   );
}
