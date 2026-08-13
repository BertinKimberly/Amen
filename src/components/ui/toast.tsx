import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToastStore } from "@/stores/toast";
import { cn } from "@/lib/utils";

const ICONS = {
   default: Info,
   success: CheckCircle2,
   destructive: XCircle,
   info: Info,
};

const COLORS = {
   default: "text-info",
   success: "text-success",
   destructive: "text-destructive",
   info: "text-info",
};

export function Toaster() {
   const toasts = useToastStore((s) => s.toasts);
   const dismiss = useToastStore((s) => s.dismiss);

   return (
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[360px] flex-col gap-2">
         {toasts.map((t) => {
            const Icon = ICONS[t.variant ?? "default"];
            return (
               <div
                  key={t.id}
                  className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-popover/95 p-3.5 shadow-lg backdrop-blur animate-slide-up"
               >
                  <Icon
                     className={cn(
                        "mt-0.5 h-4.5 w-4.5 shrink-0",
                        COLORS[t.variant ?? "default"],
                     )}
                  />
                  <div className="flex-1 text-sm">
                     <div className="font-medium text-foreground">
                        {t.title}
                     </div>
                     {t.description && (
                        <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                           {t.description}
                        </div>
                     )}
                  </div>
                  <button
                     onClick={() => dismiss(t.id)}
                     className="rounded-md p-0.5 text-muted-foreground opacity-60 transition-opacity hover:opacity-100"
                     aria-label="Dismiss"
                  >
                     <X className="h-4 w-4" />
                  </button>
               </div>
            );
         })}
      </div>
   );
}
