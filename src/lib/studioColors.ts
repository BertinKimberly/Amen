// Deterministic per-source color identity, so a clip always visually
// communicates which source it came from — across the source list, the clip
// library, and every placement on the timeline (professional editors like
// Premiere/Resolve use the same convention for bin color-tagging).

export interface SourceColor {
   /** Tailwind-ready gradient stop classes for the clip body. */
   from: string;
   to: string;
   /** Solid border/ring color class. */
   ring: string;
   /** Small dot / chip color class. */
   dot: string;
   /** Text-safe accent color class (for source-name chips etc.). */
   text: string;
}

const PALETTE: SourceColor[] = [
   { from: "from-blue-600", to: "to-blue-500", ring: "border-blue-400", dot: "bg-blue-400", text: "text-blue-300" },
   { from: "from-violet-600", to: "to-violet-500", ring: "border-violet-400", dot: "bg-violet-400", text: "text-violet-300" },
   { from: "from-teal-600", to: "to-teal-500", ring: "border-teal-400", dot: "bg-teal-400", text: "text-teal-300" },
   { from: "from-amber-600", to: "to-amber-500", ring: "border-amber-400", dot: "bg-amber-400", text: "text-amber-300" },
   { from: "from-rose-600", to: "to-rose-500", ring: "border-rose-400", dot: "bg-rose-400", text: "text-rose-300" },
   { from: "from-emerald-600", to: "to-emerald-500", ring: "border-emerald-400", dot: "bg-emerald-400", text: "text-emerald-300" },
   { from: "from-fuchsia-600", to: "to-fuchsia-500", ring: "border-fuchsia-400", dot: "bg-fuchsia-400", text: "text-fuchsia-300" },
   { from: "from-sky-600", to: "to-sky-500", ring: "border-sky-400", dot: "bg-sky-400", text: "text-sky-300" },
];

function hashId(id: string): number {
   let h = 0;
   for (let i = 0; i < id.length; i++) {
      h = (h * 31 + id.charCodeAt(i)) >>> 0;
   }
   return h;
}

export function colorForSource(sourceId: string | null | undefined): SourceColor {
   if (!sourceId) return PALETTE[0];
   return PALETTE[hashId(sourceId) % PALETTE.length];
}
