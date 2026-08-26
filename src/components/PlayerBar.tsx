import { useEffect, useRef } from "react";
import { Play, Pause, SkipBack, Volume2, VolumeX, Zap } from "lucide-react";
import { formatTime, clamp } from "../lib/studioTime";
import { assetUrl } from "../lib/api";

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
   mode?: "source" | "timeline";
   sourcePlaybackPath?: string | null;
   selectionStart?: number | null; // Loop-back target when `looping` is on
   selectionEnd?: number | null; // For preview stopping (or looping back, if `looping` is on)
   looping?: boolean;
}

/**
 * Transport bar — the playback clock is authoritative (driven by the real
 * <audio> element's currentTime via requestAnimationFrame), never a fake
 * independent timer, so the playhead everywhere in the Studio always agrees
 * with what's actually playing.
 *
 * Keyboard shortcuts:
 * - Space: play/pause
 * - ← →: seek ±5s, Shift+← →: seek ±0.5s
 * - Home/End: jump to start/end, 0-9: jump to 0-90% of duration
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
   mode = "timeline",
   sourcePlaybackPath,
   selectionStart = null,
   selectionEnd = null,
   looping = false,
}: PlayerBarProps) {
   const audioRef = useRef<HTMLAudioElement>(null);
   const frameRef = useRef<number>();

   const audioSrc = mode === "source" && sourcePlaybackPath
      ? assetUrl(sourcePlaybackPath)
      : previewPath;

   useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      if (playing) {
         audio.play().catch(console.error);
      } else {
         audio.pause();
      }
   }, [playing, audioSrc]);

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
            const audio = audioRef.current;
            if (audio && !audio.paused) {
               const currentTime = audio.currentTime;
               if (selectionEnd !== null && currentTime >= selectionEnd) {
                  if (looping && selectionStart !== null) {
                     // Real audio-clock loop-back — reset the actual <audio>
                     // element's position, not a UI approximation, so the
                     // next frame's currentTime read is already correct.
                     audio.currentTime = selectionStart;
                     onSeek?.(selectionStart);
                     frameRef.current = requestAnimationFrame(loop);
                     return;
                  }
                  onStop?.();
                  return;
               }
               onSeek?.(currentTime);
            }
            frameRef.current = requestAnimationFrame(loop);
         };
         frameRef.current = requestAnimationFrame(loop);
      }
      return () => {
         if (frameRef.current) cancelAnimationFrame(frameRef.current);
      };
   }, [playing, onSeek, selectionStart, selectionEnd, looping, onStop]);

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
         if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
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

   const progressPct = duration > 0 ? Math.min(100, (playhead / duration) * 100) : 0;

   return (
      <div className="flex items-center gap-3 rounded-xl bg-studio-panel border border-studio-border px-3.5 py-2.5" title="Space=play/pause · ←/→=seek ±5s · Shift+←/→=±0.5s · Home/End=jump · 0-9=jump to %">
         <button
            onClick={onStop}
            className="rounded-lg p-2 hover:bg-studio-raised transition text-studio-text-muted hover:text-studio-text"
            title="Stop (resets to 0)"
         >
            <SkipBack size={16} />
         </button>
         <button
            onClick={() => (playing ? onPause?.() : onPlay?.())}
            className="rounded-full bg-studio-accent p-2.5 hover:brightness-110 transition text-white shadow-md shadow-studio-accent/30"
         >
            {playing ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
         </button>

         <div className="flex items-center gap-1.5 text-[13px] text-studio-text font-mono tabular-nums shrink-0">
            <span>{formatTime(playhead)}</span>
            <span className="text-studio-text-faint">/</span>
            <span className="text-studio-text-muted">{formatTime(duration)}</span>
         </div>

         {/* Seek slider with filled progress track */}
         <div className="relative flex-1 h-4 flex items-center group">
            <div className="absolute inset-x-0 h-1.5 rounded-full bg-studio-canvas overflow-hidden">
               <div className="h-full bg-studio-accent rounded-full" style={{ width: `${progressPct}%` }} />
            </div>
            <input
               type="range"
               min="0"
               max={Math.max(1, duration * 1000)}
               value={playhead * 1000}
               onChange={(e) => onSeek?.(parseInt(e.target.value) / 1000)}
               className="relative w-full h-4 appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:opacity-0 group-hover:[&::-webkit-slider-thumb]:opacity-100 [&::-webkit-slider-thumb]:transition-opacity"
            />
         </div>

         <div className="w-px h-6 bg-studio-border shrink-0" />

         {/* Volume */}
         <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={onMuteToggle} className="rounded-lg p-1 hover:bg-studio-raised transition text-studio-text-muted hover:text-studio-text">
               {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
               type="range"
               min="0"
               max="100"
               value={muted ? 0 : volume * 100}
               onChange={(e) => onVolumeChange?.(parseInt(e.target.value) / 100)}
               className="w-16 accent-studio-accent"
            />
         </div>

         {/* Playback rate */}
         <div className="flex items-center gap-1.5 shrink-0">
            <Zap size={13} className="text-studio-text-faint" />
            <select
               value={playbackRate}
               onChange={(e) => onPlaybackRateChange?.(parseFloat(e.target.value))}
               className="rounded-md bg-studio-canvas border border-studio-border px-1.5 py-1 text-[11px] text-studio-text-muted"
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

         {/* Hidden audio element for playback */}
         <audio ref={audioRef} src={audioSrc || undefined} onEnded={() => onStop?.()} />
      </div>
   );
}
