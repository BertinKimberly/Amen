import { useState } from "react";
import { Download } from "lucide-react";
import type { ExportFormat } from "../lib/studioTypes";
import { EXPORT_FORMATS, MP3_BITRATES, M4A_BITRATES } from "../lib/studioTypes";

interface ExportDialogProps {
   open: boolean;
   onClose: () => void;
   onExport: (format: string, bitrate: number, path?: string) => Promise<void>;
   isLoading?: boolean;
}

export function ExportDialog({
   open,
   onClose,
   onExport,
   isLoading = false,
}: ExportDialogProps) {
   const [format, setFormat] = useState<ExportFormat>("mp3");
   const [bitrate, setBitrate] = useState(192);

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

   return (
      <div
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
         onKeyDown={(e) => {
            if (e.key === "Escape" && !isLoading) onClose();
         }}
      >
         <div className="bg-studio-panel border border-studio-border rounded-lg p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-4">Export Mix</h2>

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
                        setBitrate(e.target.value === "wav" ? 0 : 192);
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
