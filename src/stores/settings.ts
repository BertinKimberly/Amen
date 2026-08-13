import { create } from "zustand";
import { api } from "@/lib/api";
import type { AppSettings } from "@/lib/types";

interface SettingsState {
   settings: AppSettings | null;
   loaded: boolean;
   load: () => Promise<void>;
   save: (patch: Partial<AppSettings>) => Promise<AppSettings>;
   setTheme: (theme: AppSettings["theme"]) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
   settings: null,
   loaded: false,

   load: async () => {
      try {
         const settings = await api.getSettings();
         applyTheme(settings.theme);
         set({ settings, loaded: true });
      } catch {
         /* non-fatal */
      }
   },

   save: async (patch) => {
      const current = get().settings;
      if (!current) {
         const fresh = await api.getSettings();
         set({ settings: fresh });
         return fresh;
      }
      const merged: AppSettings = { ...current, ...patch };
      try {
         const saved = await api.saveSettings(merged);
         applyTheme(saved.theme);
         set({ settings: saved });
         return saved;
      } catch (e) {
         throw e;
      }
   },

   setTheme: (theme) => {
      applyTheme(theme);
      get().save({ theme });
   },
}));

function applyTheme(theme: AppSettings["theme"]) {
   const root = document.documentElement;
   if (theme === "system") {
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", dark);
   } else {
      root.classList.toggle("dark", theme === "dark");
   }
}
