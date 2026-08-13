import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
   "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
   {
      variants: {
         variant: {
            default: "border-transparent bg-primary/15 text-primary",
            secondary:
               "border-transparent bg-secondary text-secondary-foreground",
            muted: "border-border bg-muted text-muted-foreground",
            success: "border-success/25 bg-success/10 text-success",
            warning: "border-warning/25 bg-warning/10 text-warning",
            destructive:
               "border-destructive/25 bg-destructive/10 text-destructive",
            info: "border-info/25 bg-info/10 text-info",
            outline: "border-border text-foreground/80",
         },
      },
      defaultVariants: {
         variant: "default",
      },
   },
);

export interface BadgeProps
   extends
      React.HTMLAttributes<HTMLDivElement>,
      VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
   return (
      <div
         className={cn(badgeVariants({ variant }), className)}
         {...props}
      />
   );
}

export { Badge, badgeVariants };
