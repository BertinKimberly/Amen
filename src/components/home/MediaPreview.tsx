import { Calendar, Eye, Globe, Play, User } from "lucide-react";
import { Thumbnail } from "@/components/Thumbnail";
import { DownloadOptions } from "@/components/home/DownloadOptions";
import { formatCount, formatDuration } from "@/lib/format";
import type { MediaFormat, MediaInfo, QualityOption } from "@/lib/types";

interface MediaPreviewProps {
   media: MediaInfo;
   format: MediaFormat;
   setFormat: (f: MediaFormat) => void;
   quality: QualityOption;
   setQuality: (q: QualityOption) => void;
   destination: string;
   onBrowseDestination: () => void;
   onDownload: () => void;
   downloading: boolean;
}

export function MediaPreview({
   media,
   format,
   setFormat,
   quality,
   setQuality,
   destination,
   onBrowseDestination,
   onDownload,
   downloading,
}: MediaPreviewProps) {
   const channel = media.channel ?? media.uploader;

   return (
      <div className="animate-slide-up overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
         <div className="flex flex-col gap-5 p-5 sm:flex-row">
            <Thumbnail
               src={media.thumbnail}
               alt={media.title ?? ""}
               className="aspect-video w-full sm:w-64"
               rounded="rounded-xl"
            />
            <div className="flex min-w-0 flex-1 flex-col">
               <h2 className="text-lg font-semibold leading-snug tracking-tight text-balance">
                  {media.title ?? "Untitled media"}
               </h2>

               <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
                  {channel && (
                     <span className="inline-flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" />
                        {channel}
                     </span>
                  )}
                  {media.duration != null && (
                     <span className="inline-flex items-center gap-1.5">
                        <Play className="h-3.5 w-3.5" />
                        {formatDuration(media.duration)}
                     </span>
                  )}
                  {media.viewCount != null && (
                     <span className="inline-flex items-center gap-1.5">
                        <Eye className="h-3.5 w-3.5" />
                        {formatCount(media.viewCount)} views
                     </span>
                  )}
                  {media.uploadDate && (
                     <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        {media.uploadDate}
                     </span>
                  )}
                  {media.extractor && (
                     <span className="inline-flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5" />
                        {media.extractor}
                     </span>
                  )}
               </div>

               {media.description && (
                  <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
                     {media.description}
                  </p>
               )}

               <div className="mt-4 border-t border-border/70 pt-4">
                  <DownloadOptions
                     format={format}
                     setFormat={setFormat}
                     quality={quality}
                     setQuality={setQuality}
                     destination={destination}
                     onBrowseDestination={onBrowseDestination}
                     sourceBitrate={media.bestAudioBitrate}
                     onDownload={onDownload}
                     downloading={downloading}
                  />
               </div>
            </div>
         </div>
      </div>
   );
}
