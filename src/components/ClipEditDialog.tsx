import { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { StudioTimelineItem, StudioClip } from "../lib/studioTypes";
import { formatTime } from "../lib/studioTime";

interface ClipEditDialogProps {
   open: boolean;
   onClose: () => void;
   item: StudioTimelineItem | null;
   clip: StudioClip | null;
   onUpdate: (updates: Partial<StudioTimelineItem>) => void;
}

/**
 * Dialog for editing timeline clip properties:
 * - Volume
 * - Mute
 * - Fade in/out
 * - Crossfade with previous clip
 */
export function ClipEditDialog({ open, onClose, item, clip, onUpdate }: ClipEditDialogProps) {
   const [volume, setVolume] = useState(1);
   const [muted, setMuted] = useState(false);
   const [fadeIn, setFadeIn] = useState(0);
   const [fadeOut, setFadeOut] = useState(0);
   const [crossfadePrev, setCrossfadePrev] = useState(0);

   useEffect(() => {
      if (item) {
         setVolume(item.volume);
         setMuted(item.muted);
         setFadeIn(item.fadeIn);
         setFadeOut(item.fadeOut);
         setCrossfadePrev(item.crossfadePrev);
      }
   }, [item]);

   const handleApply = () => {
      onUpdate({
         volume,
         muted,
         fadeIn,
         fadeOut,
         crossfadePrev,
      });
      onClose();
   };

   if (!open || !item || !clip) return null;

   const clipDuration = clip.end - clip.start;
   const maxFade = clipDuration * 0.4; // Max 40% of clip duration

   return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
         <div className="bg-studio-panel rounded-lg border border-studio-border shadow-2xl max-w-md w-full">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-studio-border">
               <h3 className="font-semibold">Edit Clip: {clip.name}</h3>
               <button
                  onClick={onClose}
                  className="p-1 hover:bg-studio-raised rounded transition"
               >
                  <X size={18} />
               </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
               {/* Clip info */}
               <div className="text-xs text-studio-text-muted space-y-1 bg-studio-canvas p-3 rounded">
                  <div>Position: {formatTime(item.position)}</div>
                  <div>Duration: {formatTime(clipDuration)}</div>
                  <div>Source: {formatTime(clip.start)} → {formatTime(clip.end)}</div>
               </div>

               {/* Volume */}
               <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center justify-between">
                     <span>Volume</span>
                     <span className="text-studio-accent-strong font-mono">{Math.round(volume * 100)}%</span>
                  </label>
                  <input
                     type="range"
                     min="0"
                     max="100"
                     value={volume * 100}
                     onChange={(e) => setVolume(parseInt(e.target.value) / 100)}
                     className="w-full accent-studio-accent"
                  />
               </div>

               {/* Mute */}
               <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Mute</label>
                  <input
                     type="checkbox"
                     checked={muted}
                     onChange={(e) => setMuted(e.target.checked)}
                     className="w-5 h-5 accent-studio-accent rounded"
                  />
               </div>

               {/* Fade In */}
               <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center justify-between">
                     <span>Fade In</span>
                     <span className="text-studio-accent-strong font-mono">{formatTime(fadeIn)}</span>
                  </label>
                  <input
                     type="range"
                     min="0"
                     max={maxFade * 1000}
                     step="10"
                     value={fadeIn * 1000}
                     onChange={(e) => setFadeIn(parseInt(e.target.value) / 1000)}
                     className="w-full accent-studio-accent"
                  />
               </div>

               {/* Fade Out */}
               <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center justify-between">
                     <span>Fade Out</span>
                     <span className="text-studio-accent-strong font-mono">{formatTime(fadeOut)}</span>
                  </label>
                  <input
                     type="range"
                     min="0"
                     max={maxFade * 1000}
                     step="10"
                     value={fadeOut * 1000}
                     onChange={(e) => setFadeOut(parseInt(e.target.value) / 1000)}
                     className="w-full accent-studio-accent"
                  />
               </div>

               {/* Crossfade with Previous */}
               <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center justify-between">
                     <span>Crossfade with Previous</span>
                     <span className="text-studio-accent-strong font-mono">{formatTime(crossfadePrev)}</span>
                  </label>
                  <input
                     type="range"
                     min="0"
                     max={Math.min(item.position, clipDuration) * 1000}
                     step="10"
                     value={crossfadePrev * 1000}
                     onChange={(e) => setCrossfadePrev(parseInt(e.target.value) / 1000)}
                     className="w-full accent-studio-accent"
                  />
                  <div className="text-xs text-studio-text-faint">
                     Overlap with the previous clip on this track
                  </div>
               </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 p-4 border-t border-studio-border">
               <button
                  onClick={onClose}
                  className="px-4 py-2 rounded bg-studio-raised hover:bg-white/10 transition"
               >
                  Cancel
               </button>
               <button
                  onClick={handleApply}
                  className="px-4 py-2 rounded bg-studio-accent hover:brightness-110 transition font-medium"
               >
                  Apply
               </button>
            </div>
         </div>
      </div>
   );
}
