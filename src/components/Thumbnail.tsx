import { useState } from "react";
import { Music } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThumbnailProps {
   src?: string | null;
   alt?: string;
   className?: string;
   rounded?: string;
}

export function Thumbnail({
   src,
   alt,
   className,
   rounded = "rounded-lg",
}: ThumbnailProps) {
   const [failed, setFailed] = useState(false);
   const show = src && !failed;
   return (
      <div
         className={cn(
            "relative shrink-0 overflow-hidden bg-gradient-to-br from-secondary to-accent flex items-center justify-center",
            rounded,
            className,
         )}
      >
         {show ? (
            <img
               src={src!}
               alt={alt ?? ""}
               loading="lazy"
               onError={() => setFailed(true)}
               className="h-full w-full object-cover"
               draggable={false}
            />
         ) : (
            <Music
               className="h-1/3 w-1/3 text-muted-foreground/50"
               strokeWidth={1.4}
            />
         )}
      </div>
   );
}
