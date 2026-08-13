import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
   icon: LucideIcon;
   title: string;
   description?: string;
   action?: React.ReactNode;
   className?: string;
}

export function EmptyState({
   icon: Icon,
   title,
   description,
   action,
   className,
}: EmptyStateProps) {
   return (
      <div
         className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-background/30 px-6 py-14 text-center",
            className,
         )}
      >
         <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/60 text-muted-foreground">
            <Icon
               className="h-7 w-7"
               strokeWidth={1.6}
            />
         </div>
         <div>
            <h3 className="text-base font-semibold">{title}</h3>
            {description && (
               <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  {description}
               </p>
            )}
         </div>
         {action && <div className="mt-1">{action}</div>}
      </div>
   );
}
