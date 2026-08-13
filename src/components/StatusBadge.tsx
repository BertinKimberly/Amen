import { Badge } from "@/components/ui/badge";
import { STATUS_META } from "@/lib/constants";
import type { JobStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const VARIANT_MAP: Record<
   JobStatus,
   | "default"
   | "secondary"
   | "muted"
   | "success"
   | "warning"
   | "destructive"
   | "info"
> = {
   pending: "secondary",
   fetching: "info",
   downloading: "default",
   processing: "warning",
   completed: "success",
   failed: "destructive",
   cancelled: "muted",
   skipped: "warning",
   interrupted: "warning",
};

export function StatusBadge({
   status,
   className,
}: {
   status: JobStatus;
   className?: string;
}) {
   const meta = STATUS_META[status];
   return (
      <Badge
         variant={VARIANT_MAP[status]}
         className={cn("gap-1.5", className)}
      >
         <span
            className={cn(
               "h-1.5 w-1.5 rounded-full",
               meta.dot,
               status === "downloading" && "animate-pulse",
            )}
         />
         {meta.label}
      </Badge>
   );
}
