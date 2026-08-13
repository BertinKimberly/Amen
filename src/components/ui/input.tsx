import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<
   HTMLInputElement,
   React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
   <input
      type={type}
      className={cn(
         "flex h-9 w-full rounded-lg border border-input bg-background/60 px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50",
         className,
      )}
      ref={ref}
      {...props}
   />
));
Input.displayName = "Input";

const Textarea = React.forwardRef<
   HTMLTextAreaElement,
   React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
   <textarea
      className={cn(
         "flex min-h-[80px] w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50",
         className,
      )}
      ref={ref}
      {...props}
   />
));
Textarea.displayName = "Textarea";

export { Input, Textarea };
