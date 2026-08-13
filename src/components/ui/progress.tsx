import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
   value?: number; // 0-100
   indeterminate?: boolean;
   className?: string;
   indicatorClassName?: string;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
   (
      {
         value = 0,
         indeterminate = false,
         className,
         indicatorClassName,
         ...props
      },
      ref,
   ) => {
      const clamped = Math.min(100, Math.max(0, value));
      return (
         <div
            ref={ref}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
            className={cn(
               "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
               className,
            )}
            {...props}
         >
            {indeterminate ? (
               <div className="absolute inset-y-0 w-1/3 animate-[progress-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary/70" />
            ) : (
               <div
                  className={cn(
                     "h-full rounded-full bg-primary transition-[width] duration-200 ease-out",
                     indicatorClassName,
                  )}
                  style={{ width: `${clamped}%` }}
               />
            )}
         </div>
      );
   },
);
Progress.displayName = "Progress";

export { Progress };
