import { create } from "zustand";

export interface Toast {
   id: number;
   title: string;
   description?: string;
   variant?: "default" | "success" | "destructive" | "info";
}

interface ToastState {
   toasts: Toast[];
   push: (t: Omit<Toast, "id">) => void;
   dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
   toasts: [],
   push: (t) => {
      const id = nextId++;
      set({ toasts: [...get().toasts, { ...t, id }] });
      setTimeout(() => get().dismiss(id), 4200);
   },
   dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export function toast(
   title: string,
   description?: string,
   variant?: Toast["variant"],
) {
   useToastStore.getState().push({ title, description, variant });
}
