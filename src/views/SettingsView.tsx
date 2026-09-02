import { useEffect, useState } from "react";
import {
   FolderOpen,
   HardDrive,
   KeyRound,
   Music,
   RefreshCw,
   Save,
   Settings as SettingsIcon,
   Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings";
import { api } from "@/lib/api";
import { toast } from "@/stores/toast";
import { cn } from "@/lib/utils";
import type { AppSettings, MediaFormat, QualityOption } from "@/lib/types";
import { DEFAULT_FILENAME_TEMPLATE } from "@/lib/constants";

type SectionId = "general" | "downloads" | "metadata" | "tools" | "advanced";

const SECTIONS: { id: SectionId; label: string; icon: typeof SettingsIcon; description: string }[] = [
   { id: "general", label: "General", icon: SettingsIcon, description: "Appearance and startup behavior." },
   { id: "downloads", label: "Downloads", icon: HardDrive, description: "Format, quality, and file handling." },
   { id: "metadata", label: "Metadata", icon: Music, description: "Tags and artwork embedded into files." },
   { id: "tools", label: "yt-dlp & FFmpeg", icon: Wrench, description: "Executable locations. Leave blank to auto-detect." },
   { id: "advanced", label: "Advanced", icon: KeyRound, description: "Optional, deliberate power-user settings." },
];

export function SettingsView() {
   const { settings, load, save } = useSettingsStore();
   const [dirty, setDirty] = useState(false);
   const [saving, setSaving] = useState(false);
   const [active, setActive] = useState<SectionId>("general");

   useEffect(() => {
      if (!useSettingsStore.getState().loaded) load();
   }, []);

   if (!settings) {
      return (
         <div className="px-8 py-6">
            <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground">Loading…</p>
         </div>
      );
   }

   const update = (patch: Partial<AppSettings>) => {
      useSettingsStore.setState({ settings: { ...settings, ...patch } });
      setDirty(true);
   };

   const handleSave = async () => {
      setSaving(true);
      try {
         await api.validateOutputDir(settings.outputDir);
         await save({});
         setDirty(false);
         toast(
            "Settings saved",
            "Your preferences have been updated.",
            "success",
         );
      } catch (e) {
         toast("Could not save settings", (e as Error).message, "destructive");
      } finally {
         setSaving(false);
      }
   };

   const current = SECTIONS.find((s) => s.id === active)!;

   return (
      <div className="flex h-full min-h-0">
         {/* Settings category navigation — desktop apps don't hide their
             settings tree behind a single scrolling column. */}
         <nav className="w-60 shrink-0 border-r border-border overflow-y-auto py-6 px-3">
            <div className="px-3 pb-4">
               <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
               <p className="text-xs text-muted-foreground mt-0.5">Configure how Amen works.</p>
            </div>
            <div className="space-y-0.5">
               {SECTIONS.map((s) => {
                  const Icon = s.icon;
                  const isActive = s.id === active;
                  return (
                     <button
                        key={s.id}
                        onClick={() => setActive(s.id)}
                        className={cn(
                           "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors text-left",
                           isActive
                              ? "bg-accent text-accent-foreground"
                              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                     >
                        <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "")} strokeWidth={2} />
                        {s.label}
                     </button>
                  );
               })}
            </div>
         </nav>

         {/* Active section content — uses the full remaining width */}
         <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="max-w-3xl px-10 py-6 pb-28 space-y-6">
               <div>
                  <h2 className="text-lg font-semibold tracking-tight">{current.label}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">{current.description}</p>
               </div>

               {active === "general" && (
                  <div className="space-y-5 divide-y divide-border">
                     <SettingRow label="Theme" hint="Dark, light, or follow Windows.">
                        <Select
                           value={settings.theme}
                           onValueChange={(v) => useSettingsStore.getState().setTheme(v as AppSettings["theme"])}
                        >
                           <SelectTrigger className="w-40">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                              <SelectItem value="dark">Dark</SelectItem>
                              <SelectItem value="light">Light</SelectItem>
                              <SelectItem value="system">System</SelectItem>
                           </SelectContent>
                        </Select>
                     </SettingRow>
                     <SettingRow label="Startup" hint="Restore the previous download queue on launch." pt>
                        <Select
                           value={settings.startupBehavior}
                           onValueChange={(v) => update({ startupBehavior: v as AppSettings["startupBehavior"] })}
                        >
                           <SelectTrigger className="w-40">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                              <SelectItem value="restore">Restore queue</SelectItem>
                              <SelectItem value="empty">Start empty</SelectItem>
                           </SelectContent>
                        </Select>
                     </SettingRow>
                     <SettingRow label="Show notification on completion" hint="Windows notification when a download finishes." pt>
                        <Switch checked={settings.notifyOnComplete} onCheckedChange={(v) => update({ notifyOnComplete: v })} />
                     </SettingRow>
                  </div>
               )}

               {active === "downloads" && (
                  <div className="space-y-5 divide-y divide-border">
                     <SettingRow label="Default format" hint="Used when a new download starts.">
                        <Select value={settings.defaultFormat} onValueChange={(v) => update({ defaultFormat: v as MediaFormat })}>
                           <SelectTrigger className="w-40">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                              <SelectItem value="mp3">MP3 (audio)</SelectItem>
                              <SelectItem value="mp4">MP4 (video)</SelectItem>
                           </SelectContent>
                        </Select>
                     </SettingRow>
                     <SettingRow label="Default quality" hint="Audio encoding target for MP3." pt>
                        <Select value={settings.defaultQuality} onValueChange={(v) => update({ defaultQuality: v as QualityOption })}>
                           <SelectTrigger className="w-40">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                              <SelectItem value="best">Best</SelectItem>
                              <SelectItem value="320">320 kbps</SelectItem>
                              <SelectItem value="256">256 kbps</SelectItem>
                              <SelectItem value="192">192 kbps</SelectItem>
                              <SelectItem value="128">128 kbps</SelectItem>
                           </SelectContent>
                        </Select>
                     </SettingRow>
                     <SettingRow label="Output directory" hint="Where downloaded files are saved." pt stack>
                        <div className="flex w-full gap-2">
                           <Input value={settings.outputDir} onChange={(e) => update({ outputDir: e.target.value })} spellCheck={false} />
                           <Button
                              variant="outline"
                              size="icon"
                              onClick={async () => {
                                 const picked = await api.selectDirectory(settings.outputDir);
                                 if (picked) update({ outputDir: picked });
                              }}
                              aria-label="Browse for folder"
                           >
                              <FolderOpen className="h-4 w-4" />
                           </Button>
                        </div>
                     </SettingRow>
                     <SettingRow label="Filename template" hint="yt-dlp style template. %(title)s and %(ext)s supported." pt stack>
                        <Input
                           className="font-mono text-[13px]"
                           value={settings.filenameTemplate}
                           onChange={(e) => update({ filenameTemplate: e.target.value })}
                           spellCheck={false}
                           placeholder={DEFAULT_FILENAME_TEMPLATE}
                        />
                     </SettingRow>
                     <SettingRow label="Existing file on disk" hint="What to do when the output file already exists." pt>
                        <Select
                           value={settings.overwriteBehavior}
                           onValueChange={(v) => update({ overwriteBehavior: v as AppSettings["overwriteBehavior"] })}
                        >
                           <SelectTrigger className="w-48">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                              <SelectItem value="skip">Skip</SelectItem>
                              <SelectItem value="replace">Replace</SelectItem>
                              <SelectItem value="new_copy">Create a new copy</SelectItem>
                           </SelectContent>
                        </Select>
                     </SettingRow>
                     <SettingRow label="Duplicate media" hint="Same media already downloaded (by media ID)." pt>
                        <Select
                           value={settings.duplicateHandling}
                           onValueChange={(v) => update({ duplicateHandling: v as AppSettings["duplicateHandling"] })}
                        >
                           <SelectTrigger className="w-48">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                              <SelectItem value="skip">Skip</SelectItem>
                              <SelectItem value="replace">Replace</SelectItem>
                              <SelectItem value="new_copy">Create a new copy</SelectItem>
                           </SelectContent>
                        </Select>
                     </SettingRow>
                     <SettingRow label="Concurrent downloads" hint="How many downloads run at once." pt>
                        <Select
                           value={String(settings.maxConcurrent)}
                           onValueChange={(v) => update({ maxConcurrent: Math.max(1, Math.min(8, Number(v))) })}
                        >
                           <SelectTrigger className="w-40">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                                 <SelectItem key={n} value={String(n)}>
                                    {n}
                                 </SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </SettingRow>
                  </div>
               )}

               {active === "metadata" && (
                  <div className="space-y-5 divide-y divide-border">
                     <SettingRow label="Embed album artwork" hint="Download the thumbnail and embed it as cover art (MP3).">
                        <Switch checked={settings.embedArtwork} onCheckedChange={(v) => update({ embedArtwork: v })} />
                     </SettingRow>
                     <SettingRow label="Embed metadata" hint="Title, artist, album, date, description, and source comment." pt>
                        <Switch checked={settings.embedMetadata} onCheckedChange={(v) => update({ embedMetadata: v })} />
                     </SettingRow>
                  </div>
               )}

               {active === "tools" && (
                  <div className="space-y-5 divide-y divide-border">
                     <SettingRow label="yt-dlp executable" hint="Explicit path (optional)." stack>
                        <Input
                           className="font-mono text-[13px]"
                           value={settings.ytdlpPath}
                           onChange={(e) => update({ ytdlpPath: e.target.value })}
                           spellCheck={false}
                           placeholder="Auto-detect (PATH or bundled)"
                        />
                     </SettingRow>
                     <SettingRow label="FFmpeg executable" hint="Explicit path (optional)." pt stack>
                        <Input
                           className="font-mono text-[13px]"
                           value={settings.ffmpegPath}
                           onChange={(e) => update({ ffmpegPath: e.target.value })}
                           spellCheck={false}
                           placeholder="Auto-detect (PATH or bundled)"
                        />
                     </SettingRow>
                     <SettingRow label="ffprobe executable" hint="Explicit path (optional)." pt stack>
                        <Input
                           className="font-mono text-[13px]"
                           value={settings.ffprobePath}
                           onChange={(e) => update({ ffprobePath: e.target.value })}
                           spellCheck={false}
                           placeholder="Auto-detect (PATH or bundled)"
                        />
                     </SettingRow>
                  </div>
               )}

               {active === "advanced" && (
                  <div className="space-y-5 divide-y divide-border">
                     <SettingRow
                        label="Cookies file (optional)"
                        hint="Path to a cookies.txt. Never harvested automatically — only used if you provide one, for content you are authorized to access."
                        stack
                     >
                        <Input
                           className="font-mono text-[13px]"
                           value={settings.cookiesFile}
                           onChange={(e) => update({ cookiesFile: e.target.value })}
                           spellCheck={false}
                           placeholder="Path to cookies.txt (leave empty to disable)"
                        />
                     </SettingRow>
                     <SettingRow
                        label="Watch clipboard for URLs"
                        hint="Opt-in: when a copied link looks like a supported media URL, pre-fill it. Requires the app to read your clipboard."
                        pt
                     >
                        <Switch checked={settings.clipboardMonitor} onCheckedChange={(v) => update({ clipboardMonitor: v })} />
                     </SettingRow>
                  </div>
               )}
            </div>
         </div>

         {/* Sticky save bar */}
         <div className="fixed bottom-0 left-56 right-0 z-10 border-t border-border bg-background/85 backdrop-blur">
            <div className="flex items-center justify-between px-8 py-3">
               <p className="text-xs text-muted-foreground">
                  {dirty ? "You have unsaved changes." : "All changes are saved automatically."}
               </p>
               <Button onClick={handleSave} disabled={!dirty || saving}>
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save changes
               </Button>
            </div>
         </div>
      </div>
   );
}

function SettingRow({
   label,
   hint,
   children,
   pt,
   stack,
}: {
   label: string;
   hint?: string;
   children: React.ReactNode;
   pt?: boolean;
   stack?: boolean;
}) {
   return (
      <div className={cn("flex gap-4", pt && "pt-5", stack ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between")}>
         <div className="min-w-0 sm:max-w-sm">
            <Label>{label}</Label>
            {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{hint}</p>}
         </div>
         <div className={cn("flex items-center", stack ? "w-full" : "shrink-0")}>{children}</div>
      </div>
   );
}
