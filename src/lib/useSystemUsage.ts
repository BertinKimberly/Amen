import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { SystemUsage } from "./types";

const SAMPLE_INTERVAL_MS = 1500;
const MAX_SAMPLES = 40; // ~1 minute of history

export interface UsageSample extends SystemUsage {
   t: number;
}

/** Polls real local system telemetry and keeps a rolling window of samples for charting. */
export function useSystemUsage(enabled: boolean) {
   const [samples, setSamples] = useState<UsageSample[]>([]);
   const mounted = useRef(true);

   useEffect(() => {
      mounted.current = true;
      return () => {
         mounted.current = false;
      };
   }, []);

   useEffect(() => {
      if (!enabled) return;
      let cancelled = false;

      const poll = async () => {
         try {
            const usage = await api.getSystemUsage();
            if (cancelled || !mounted.current) return;
            setSamples((prev) => [...prev, { ...usage, t: Date.now() }].slice(-MAX_SAMPLES));
         } catch {
            // Telemetry is best-effort — a failed sample is simply skipped,
            // never surfaced as an error (this is a diagnostics nicety, not
            // a critical feature).
         }
      };

      poll();
      const id = setInterval(poll, SAMPLE_INTERVAL_MS);
      return () => {
         cancelled = true;
         clearInterval(id);
      };
   }, [enabled]);

   return samples;
}
