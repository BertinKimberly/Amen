import { useState } from "react";
import { Download } from "lucide-react";
import type { ExportFormat } from "../lib/studioTypes";
import { EXPORT_FORMATS, MP3_BITRATES, M4A_BITRATES } from "../lib/studioTypes";
import { formatClock } from "../lib/studioTime";

interface ExportDialogProps {
   open: boolean;
   onClose: () => void;
   onExport: (format: string, bitrate: number, path?: string) => Promise<void>;
   isLoading?: boolean;
   /** The composition length — exactly what will be written. */
   durationSeconds?: number;
}

/**
 * 192 kbps VBR-grade MP3 is the production default: transparent enough for a
 * phone, a laptop, or a car, and roughly a third the size of 320 for material
 * that has already been through one lossy generation. Higher rates stay one
 * click away for anyone who wants them.
 */
const DEFAULT_BITRATE = 192;

export function ExportDialog({
   open,
   onClose,
   onExport,
   isLoading = false,
   durationSeconds = 0,
}: ExportDialogProps) {
   const [format, setFormat] = useState<ExportFormat>("mp3");
   const [bitrate, setBitrate] = useState(DEFAULT_BITRATE);

   const getBitrateOptions = () => {
      return format === "mp3"
         ? MP3_BITRATES
         : format === "m4a"
           ? M4A_BITRATES
           : [];
   };

   const handleExport = async () => {
      await onExport(format, bitrate);
      onClose();
   };

   if (!open) return null;

   // Rough but honest: compressed formats are bitrate x time; WAV is
   // 16-bit stereo PCM at 44.1k; FLAC lands around 60% of that.
   const estimateBytes = () => {
      if (durationSeconds <= 0) return 0;
      if (format === "wav") return durationSeconds * 44100 * 2 * 2;
      if (format === "flac") return durationSeconds * 44100 * 2 * 2 * 0.6;
      return (durationSeconds * bitrate * 1000) / 8;
   };
   const estMb = estimateBytes() / 1024 / 1024;

   return (
      <div
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
         onKeyDown={(e) => {
            if (e.key === "Escape" && !isLoading) onClose();
         }}
      >
         <div className="bg-studio-panel border border-studio-border rounded-lg p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-1">Export Mix</h2>
            <p className="text-[12px] text-studio-text-muted mb-4">
               Writes exactly what is on the timeline — nothing before the first
               clip, nothing after the last.
            </p>

            <div className="space-y-4">
               {/* Format */}
               <div>
                  <label className="block text-sm font-medium mb-2">
                     Format
                  </label>
                  <select
                     data-testid="export-format-select"
                     autoFocus
                     value={format}
                     onChange={(e) => {
                        setFormat(e.target.value as ExportFormat);
                        setBitrate(e.target.value === "wav" ? 0 : DEFAULT_BITRATE);
                     }}
                     className="w-full rounded bg-studio-canvas border border-studio-border px-3 py-2 text-sm"
                  >
                     {EXPORT_FORMATS.map((f) => (
                        <option
                           key={f.value}
                           value={f.value}
                        >
                           {f.label}
                        </option>
                     ))}
                  </select>
               </div>

               {/* Bitrate */}
               {format !== "wav" && format !== "flac" && (
                  <div>
                     <label className="block text-sm font-medium mb-2">
                        Bitrate
                     </label>
                     <select
                        value={bitrate}
                        onChange={(e) => setBitrate(parseInt(e.target.value))}
                        className="w-full rounded bg-studio-canvas border border-studio-border px-3 py-2 text-sm"
                     >
                        {getBitrateOptions().map((br) => (
                           <option
                              key={br}
                              value={br}
                           >
                              {br} kbps
                           </option>
                        ))}
                     </select>
                  </div>
               )}

               {/* What you are about to get */}
               <div
                  data-testid="export-estimate"
                  data-duration-seconds={durationSeconds}
                  className="flex items-center justify-between rounded-md bg-studio-canvas border border-studio-border px-3 py-2 text-[12px] tabular-nums"
               >
                  <span className="text-studio-text-muted">Length</span>
                  <span className="font-mono text-studio-text">{formatClock(durationSeconds)}</span>
                  <span className="text-studio-text-muted">Approx. size</span>
                  <span className="font-mono text-studio-text">
                     {estMb >= 0.05 ? `${estMb.toFixed(1)} MB` : "—"}
                  </span>
               </div>

               {/* Buttons */}
               <div className="flex gap-2 mt-6">
                  <button
                     onClick={onClose}
                     disabled={isLoading}
                     className="flex-1 rounded bg-studio-raised px-4 py-2 hover:bg-white/10 disabled:opacity-50 transition"
                  >
                     Cancel
                  </button>
                  <button
                     onClick={handleExport}
                     disabled={isLoading}
                     className="flex-1 rounded bg-studio-accent px-4 py-2 hover:brightness-110 disabled:opacity-50 transition flex items-center justify-center gap-2"
                  >
                     <Download size={16} />
                     {isLoading ? "Exporting..." : "Export"}
                  </button>
               </div>
            </div>
         </div>
      </div>
   );
}
