import { useState, useEffect, useRef } from "react";
import { formatTime } from "../lib/studioTime";

interface TimeInputProps {
   value: number | null;
   onChange: (value: number) => void;
   min?: number;
   max?: number;
   label?: string;
   className?: string;
}

/**
 * Time input with MM:SS.mmm format
 * Supports:
 * - Direct typing in various formats
 * - Validation against min/max
 * - Real-time formatting
 */
export function TimeInput({ value, onChange, min = 0, max = Infinity, label, className = "" }: TimeInputProps) {
   const [editing, setEditing] = useState(false);
   const [inputValue, setInputValue] = useState("");
   const inputRef = useRef<HTMLInputElement>(null);

   useEffect(() => {
      if (!editing && value !== null) {
         setInputValue(formatTime(value));
      }
   }, [value, editing]);

   const parseTime = (str: string): number | null => {
      // Remove any non-numeric characters except : and .
      const cleaned = str.replace(/[^\d:.]/g, "");
      
      // Try to parse various formats
      // MM:SS.mmm
      const match1 = cleaned.match(/^(\d+):(\d+)\.(\d+)$/);
      if (match1) {
         const minutes = parseInt(match1[1]);
         const seconds = parseInt(match1[2]);
         const ms = parseInt(match1[3].padEnd(3, "0").slice(0, 3));
         return minutes * 60 + seconds + ms / 1000;
      }

      // MM:SS
      const match2 = cleaned.match(/^(\d+):(\d+)$/);
      if (match2) {
         const minutes = parseInt(match2[1]);
         const seconds = parseInt(match2[2]);
         return minutes * 60 + seconds;
      }

      // SS.mmm (seconds only)
      const match3 = cleaned.match(/^(\d+)\.(\d+)$/);
      if (match3) {
         const seconds = parseInt(match3[1]);
         const ms = parseInt(match3[2].padEnd(3, "0").slice(0, 3));
         return seconds + ms / 1000;
      }

      // SS (seconds only)
      const match4 = cleaned.match(/^(\d+)$/);
      if (match4) {
         return parseInt(match4[1]);
      }

      return null;
   };

   const handleFocus = () => {
      setEditing(true);
      setTimeout(() => inputRef.current?.select(), 0);
   };

   const handleBlur = () => {
      setEditing(false);
      const parsed = parseTime(inputValue);
      if (parsed !== null) {
         const clamped = Math.max(min, Math.min(max, parsed));
         onChange(clamped);
         setInputValue(formatTime(clamped));
      } else if (value !== null) {
         setInputValue(formatTime(value));
      }
   };

   const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
         inputRef.current?.blur();
      } else if (e.key === "Escape") {
         if (value !== null) {
            setInputValue(formatTime(value));
         }
         setEditing(false);
         inputRef.current?.blur();
      }
   };

   return (
      <div className={`flex flex-col gap-1 ${className}`}>
         {label && <label className="text-[11px] text-studio-text-muted font-medium">{label}</label>}
         <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="px-3 py-1.5 bg-studio-canvas border border-studio-border rounded-md text-sm font-mono text-studio-text tabular-nums focus:outline-none focus:border-studio-accent focus:ring-1 focus:ring-studio-accent transition"
            placeholder="00:00.000"
         />
      </div>
   );
}
