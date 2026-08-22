import { useEffect, useRef } from "react";
import { Play, Pause, SkipBack, Volume2, VolumeX, Zap } from "lucide-react";
import { formatTime, clamp } from "../lib/studioTime";

interface PlayerBarProps {
   playing: boolean;
   playhead: number;
   duration: number;
   volume: number;
   muted: boolean;
   playbackRate: number;
   onPlay?: () => void;
   onPause?: () => void;
   onStop?: () => void;
   onSeek?: (time: number) => void;
   onVolumeChange?: (v: number) => void;
   onMuteToggle?: () => void;
   onPlaybackRateChange?: (r: number) => void;
   previewPath?: string | null;
}

/**
 * Playback control bar with keyboard shortcuts:
 * - Space: play/pause
 * - ← →: seek ±5s
 * - Shift+← →: seek ±0.5s
 * - Home/End: jump to start/end
 * - 0-9: jump to 0-90% of duration
 */
export function PlayerBar({
   playing,
   playhead,
   duration,
   volume,
   muted,
   playbackRate,
   onPlay,
   onPause,
   onStop,
   onSeek,
   onVolumeChange,
   onMuteToggle,
   onPlaybackRateChange,
   previewPath,
}: PlayerBarProps) {
   const audioRef = useRef<HTMLAudioElement>(null);
   const frameRef = useRef<number>();

   useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      
      if (playing) {
         audio.play().catch(console.error);
      } else {
         audio.pause();
      }
   }, [playing, previewPath]);

   useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.volume = volume;
      audio.muted = muted;
      audio.playbackRate = playbackRate;
   }, [volume, muted, playbackRate]);

   useEffect(() => {
      if (playing && audioRef.current) {
         const loop = () => {
            if (audioRef.current && !audioRef.current.paused) {
               onSeek?.(audioRef.current.currentTime);
            }
            frameRef.current = requestAnimationFrame(loop);
         };
         frameRef.current = requestAnimationFrame(loop);
      }
      return () => {
         if (frameRef.current) cancelAnimationFrame(frameRef.current);
      };
   }, [playing, onSeek]);

   // Sync external seek (when paused or big difference)
   useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      if (Math.abs(audio.currentTime - playhead) > 0.5) {
         audio.currentTime = playhead;
      }
   }, [playhead]);

   // Keyboard shortcuts (but not while focused on text input)
   useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
         // Skip if user is typing in an input
         if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
         ) {
            return;
         }

         if (e.code === "Space") {
            e.preventDefault();
            if (playing) onPause?.();
            else onPlay?.();
         } else if (e.code === "ArrowLeft") {
            e.preventDefault();
            const delta = e.shiftKey ? 0.5 : 5;
            onSeek?.(clamp(playhead - delta, 0, duration));
         } else if (e.code === "ArrowRight") {
            e.preventDefault();
            const delta = e.shiftKey ? 0.5 : 5;
            onSeek?.(clamp(playhead + delta, 0, duration));
         } else if (e.code === "Home") {
            e.preventDefault();
            onSeek?.(0);
         } else if (e.code === "End") {
            e.preventDefault();
            onSeek?.(duration);
         } else if (/^Digit[0-9]$/.test(e.code)) {
            const digit = parseInt(e.code[5]);
            const pos = (digit / 10) * duration;
            onSeek?.(pos);
         }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
   }, [playing, playhead, duration, onPlay, onPause, onSeek]);

   return (
      <div className="flex flex-col gap-4 rounded-lg bg-slate-900 p-4">
         {/* Transport buttons */}
         <div className="flex items-center gap-3">
            <button
               onClick={onStop}
               className="rounded p-2 hover:bg-slate-800 transition"
               title="Stop (resets to 0)"
            >
               <SkipBack size={18} />
            </button>
            <button
               onClick={() => (playing ? onPause?.() : onPlay?.())}
               className="rounded bg-blue-600 p-2 hover:bg-blue-700 transition"
            >
               {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>

            {/* Time display */}
            <div className="flex items-center gap-2 text-sm text-slate-300 font-mono">
               <span>{formatTime(playhead)}</span>
               <span className="text-slate-500">/</span>
               <span>{formatTime(duration)}</span>
            </div>

            {/* Seek slider */}
            <input
               type="range"
               min="0"
               max={Math.max(1, duration * 1000)} // milliseconds for precision
               value={playhead * 1000}
               onChange={(e) => onSeek?.(parseInt(e.target.value) / 1000)}
               className="flex-1 accent-blue-600"
            />
         </div>

         {/* Volume & playback rate */}
         <div className="flex items-center gap-4">
            {/* Volume */}
            <div className="flex items-center gap-2">
               <button
                  onClick={onMuteToggle}
                  className="rounded p-1 hover:bg-slate-800 transition"
               >
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
               </button>
               <input
                  type="range"
                  min="0"
                  max="100"
                  value={muted ? 0 : volume * 100}
                  onChange={(e) =>
                     onVolumeChange?.(parseInt(e.target.value) / 100)
                  }
                  className="w-24 accent-blue-600"
               />
               <span className="w-8 text-xs text-slate-400">
                  {Math.round(volume * 100)}%
               </span>
            </div>

            {/* Playback rate */}
            <div className="flex items-center gap-2 ml-auto">
               <Zap
                  size={16}
                  className="text-slate-400"
               />
               <select
                  value={playbackRate}
                  onChange={(e) =>
                     onPlaybackRateChange?.(parseFloat(e.target.value))
                  }
                  className="rounded bg-slate-800 px-2 py-1 text-sm"
               >
                  <option value={0.25}>0.25x</option>
                  <option value={0.5}>0.5x</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1.0}>1.0x</option>
                  <option value={1.25}>1.25x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2.0}>2.0x</option>
               </select>
            </div>
         </div>

         {/* Keyboard help */}
         <div className="text-xs text-slate-500 border-t border-slate-700 pt-2">
            <strong>Keyboard:</strong> Space=play/pause, ←/→=seek ±5s,
            Shift+←/→=±0.5s, Home/End=jump, 0-9=jump to %
         </div>

         {/* Hidden audio element for playback */}
         <audio 
            ref={audioRef} 
            src={previewPath || undefined} 
            onEnded={() => onStop?.()}
         />
      </div>
   );
}
