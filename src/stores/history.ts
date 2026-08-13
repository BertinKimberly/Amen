import { create } from "zustand";
import { api } from "@/lib/api";
import type { HistoryItem } from "@/lib/types";

interface HistoryState {
   items: HistoryItem[];
   loaded: boolean;
   query: string;
   formatFilter: string;
   statusFilter: string;
   sort: string;
   setQuery: (q: string) => void;
   setFormatFilter: (f: string) => void;
   setStatusFilter: (s: string) => void;
   setSort: (s: string) => void;
   refresh: () => Promise<void>;
   removeItem: (id: string) => Promise<void>;
   clearAll: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
   items: [],
   loaded: false,
   query: "",
   formatFilter: "all",
   statusFilter: "all",
   sort: "date",

   setQuery: (query) => set({ query }),
   setFormatFilter: (formatFilter) => set({ formatFilter }),
   setStatusFilter: (statusFilter) => set({ statusFilter }),
   setSort: (sort) => set({ sort }),

   refresh: async () => {
      const { query, formatFilter, statusFilter, sort } = get();
      try {
         const items = await api.getHistory({
            query: query || undefined,
            formatFilter: formatFilter === "all" ? undefined : formatFilter,
            statusFilter: statusFilter === "all" ? undefined : statusFilter,
            sort,
         });
         set({ items, loaded: true });
      } catch {
         /* non-fatal */
      }
   },

   removeItem: async (id) => {
      try {
         await api.removeHistoryItem(id);
      } catch {
         /* ignore */
      }
      set({ items: get().items.filter((i) => i.id !== id) });
   },

   clearAll: async () => {
      try {
         await api.clearHistory();
      } catch {
         /* ignore */
      }
      set({ items: [] });
   },
}));
