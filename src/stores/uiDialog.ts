import { create } from "zustand";

// Native window.confirm/alert/prompt do not reliably surface in the Tauri
// WebView2 host used by this app: confirm() resolves to a truthy stub with
// no visible UI (every "Are you sure?" silently proceeds — including
// discard-unsaved-changes and delete confirmations, a real data-loss risk),
// and prompt() always returns null (rename is a dead button). This store
// backs real in-app modal replacements instead.

export type DialogRequest =
   | { kind: "confirm"; message: string; resolve: (v: boolean) => void }
   | { kind: "alert"; message: string; resolve: (v: void) => void }
   | { kind: "prompt"; message: string; defaultValue: string; resolve: (v: string | null) => void };

interface UiDialogStore {
   request: DialogRequest | null;
   show: (req: DialogRequest) => void;
   clear: () => void;
}

export const useUiDialogStore = create<UiDialogStore>((set) => ({
   request: null,
   show: (req) => set({ request: req }),
   clear: () => set({ request: null }),
}));

export function appConfirm(message: string): Promise<boolean> {
   return new Promise((resolve) => {
      useUiDialogStore.getState().show({ kind: "confirm", message, resolve });
   });
}

export function appAlert(message: string): Promise<void> {
   return new Promise((resolve) => {
      useUiDialogStore.getState().show({ kind: "alert", message, resolve });
   });
}

export function appPrompt(message: string, defaultValue = ""): Promise<string | null> {
   return new Promise((resolve) => {
      useUiDialogStore.getState().show({ kind: "prompt", message, defaultValue, resolve });
   });
}
