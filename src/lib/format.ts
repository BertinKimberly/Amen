// Formatting helpers (pure, unit-testable).

export function formatBytes(bytes: number | null | undefined): string {
   if (bytes == null || !isFinite(bytes)) return "—";
   if (bytes < 1024) return `${bytes} B`;
   const units = ["KB", "MB", "GB", "TB"];
   let value = bytes / 1024;
   let i = 0;
   while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
   }
   return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
   if (seconds == null || !isFinite(seconds) || seconds < 0) return "—";
   const s = Math.round(seconds);
   const h = Math.floor(s / 3600);
   const m = Math.floor((s % 3600) / 60);
   const sec = s % 60;
   if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
   }
   return `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatCount(n: number | null | undefined): string {
   if (n == null || !isFinite(n)) return "—";
   if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
   if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
   if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
   return String(n);
}

export function formatDate(ms: number | null | undefined): string {
   if (ms == null) return "—";
   const d = new Date(ms);
   return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
   });
}

export function formatTimeAgo(ms: number | null | undefined): string {
   if (ms == null) return "—";
   const diff = Date.now() - ms;
   const mins = Math.floor(diff / 60_000);
   if (mins < 1) return "just now";
   if (mins < 60) return `${mins}m ago`;
   const hours = Math.floor(mins / 60);
   if (hours < 24) return `${hours}h ago`;
   const days = Math.floor(hours / 24);
   if (days < 7) return `${days}d ago`;
   return formatDate(ms);
}

export function percentLabel(p: number): string {
   return `${Math.min(100, Math.max(0, Math.round(p)))}%`;
}

export function qualityLabel(q: string): string {
   switch (q) {
      case "best":
         return "Best";
      case "320":
         return "320 kbps";
      case "256":
         return "256 kbps";
      case "192":
         return "192 kbps";
      case "128":
         return "128 kbps";
      default:
         return q;
   }
}

export function formatSpeed(speed: string | null | undefined): string {
   if (!speed) return "—";
   return speed;
}
