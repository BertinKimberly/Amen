import { Download, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from "@/components/ui/select";
import { FORMAT_OPTIONS, QUALITY_OPTIONS } from "@/lib/constants";
import type { MediaFormat, QualityOption } from "@/lib/types";
import { qualityLabel } from "@/lib/format";

interface DownloadOptionsProps {
   format: MediaFormat;
   setFormat: (f: MediaFormat) => void;
   quality: QualityOption;
   setQuality: (q: QualityOption) => void;
   destination: string;
   onBrowseDestination: () => void;
   sourceBitrate?: number | null;
   onDownload: () => void;
   downloading: boolean;
   itemCount?: number;
}

export function DownloadOptions({
   format,
   setFormat,
   quality,
   setQuality,
   destination,
   onBrowseDestination,
   sourceBitrate,
   onDownload,
   downloading,
   itemCount,
}: DownloadOptionsProps) {
   const isMp3 = format === "mp3";
   return (
      <div className="flex flex-wrap items-end gap-3">
         <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
               Format
            </Label>
            <Select
               value={format}
               onValueChange={(v) => setFormat(v as MediaFormat)}
            >
               <SelectTrigger className="w-28">
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  {FORMAT_OPTIONS.map((o) => (
                     <SelectItem
                        key={o.value}
                        value={o.value}
                     >
                        {o.label}
                     </SelectItem>
                  ))}
               </SelectContent>
            </Select>
         </div>

         <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
               Quality
            </Label>
            <Select
               value={quality}
               onValueChange={(v) => setQuality(v as QualityOption)}
            >
               <SelectTrigger className="w-36">
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  {QUALITY_OPTIONS.map((o) => (
                     <SelectItem
                        key={o.value}
                        value={o.value}
                     >
                        {o.label}
                     </SelectItem>
                  ))}
               </SelectContent>
            </Select>
         </div>

         <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
               Save to
            </Label>
            <button
               onClick={onBrowseDestination}
               className="group flex h-9 items-center gap-2 truncate rounded-lg border border-border bg-background/60 px-3 text-sm text-muted-foreground transition-colors hover:border-ring/60 hover:text-foreground"
               title={destination}
            >
               <FolderOpen className="h-3.5 w-3.5 shrink-0" />
               <span className="truncate">{destination}</span>
            </button>
         </div>

         <Button
            size="lg"
            className="h-9 min-w-[150px]"
            onClick={onDownload}
            disabled={downloading}
         >
            {downloading ? (
               "Starting…"
            ) : (
               <>
                  <Download className="h-4 w-4" />
                  Download {format.toUpperCase()}
                  {itemCount && itemCount > 1 ? ` (${itemCount})` : ""}
               </>
            )}
         </Button>

         {isMp3 && sourceBitrate != null && (
            <p className="w-full text-[11px] text-muted-foreground/80">
               Source audio reaches ~{Math.round(sourceBitrate)} kbps — output
               is encoded at{" "}
               <span className="text-foreground/80">
                  {qualityLabel(quality)}
               </span>
               . Encoding never improves the source.
            </p>
         )}
      </div>
   );
}
