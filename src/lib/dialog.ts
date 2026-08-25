// Thin wrapper around the Tauri native file dialogs.
//
// Native OS dialogs cannot be driven by any browser-automation tool (they're
// outside the DOM/webview entirely). To allow genuine end-to-end testing of
// the surrounding UI (button click -> file selected -> app reacts), E2E runs
// set `window.__AMEN_E2E__ = true` and queue up canned paths on
// `window.__AMEN_E2E_PATHS__`; this module then returns those instead of
// spawning a real dialog. This is the ONLY mocked surface in the app — every
// other interaction (waveform, drag/drop, playback, rendering, export) goes
// through the real implementation.
import { open as tauriOpen, save as tauriSave, type OpenDialogOptions, type SaveDialogOptions } from "@tauri-apps/plugin-dialog";

declare global {
   interface Window {
      __AMEN_E2E__?: boolean;
      __AMEN_E2E_PATHS__?: string[];
   }
}

function nextE2EPath(): string | null {
   const queue = window.__AMEN_E2E_PATHS__;
   if (!queue || queue.length === 0) return null;
   return queue.shift() ?? null;
}

export async function open(options: OpenDialogOptions): Promise<string | string[] | null> {
   if (window.__AMEN_E2E__) {
      if (options.multiple) {
         const out: string[] = [];
         let p: string | null;
         while ((p = nextE2EPath()) !== null) out.push(p);
         return out;
      }
      return nextE2EPath();
   }
   return tauriOpen(options);
}

export async function save(options: SaveDialogOptions): Promise<string | null> {
   if (window.__AMEN_E2E__) {
      return nextE2EPath();
   }
   return tauriSave(options);
}
