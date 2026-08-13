import type { JobStatus, MediaFormat, QualityOption } from "./types";

export const QUALITY_OPTIONS: {
   value: QualityOption;
   label: string;
   hint: string;
}[] = [
   { value: "best", label: "Best", hint: "Highest quality the source offers" },
   { value: "320", label: "320 kbps", hint: "Constant bitrate (CBR)" },
   { value: "256", label: "256 kbps", hint: "Constant bitrate (CBR)" },
   { value: "192", label: "192 kbps", hint: "Constant bitrate (CBR)" },
   { value: "128", label: "128 kbps", hint: "Constant bitrate (CBR)" },
];

export const FORMAT_OPTIONS: {
   value: MediaFormat;
   label: string;
   hint: string;
}[] = [
   { value: "mp3", label: "MP3", hint: "Extract audio and convert to MP3" },
   { value: "mp4", label: "MP4", hint: "Download best video + audio as MP4" },
];

export const OVERWRITE_OPTIONS = [
   {
      value: "skip",
      label: "Skip",
      hint: "Don't download if the file already exists",
   },
   { value: "replace", label: "Replace", hint: "Overwrite the existing file" },
   {
      value: "new_copy",
      label: "Create a new copy",
      hint: "Add (1), (2), … to avoid overwriting",
   },
];

export const DUPLICATE_OPTIONS = [
   {
      value: "skip",
      label: "Skip",
      hint: "Don't re-download media already in history",
   },
   { value: "replace", label: "Replace", hint: "Re-download and replace" },
   {
      value: "new_copy",
      label: "Create a new copy",
      hint: "Download again as a new copy",
   },
];

export const STATUS_META: Record<
   JobStatus,
   { label: string; color: string; dot: string }
> = {
   pending: {
      label: "Queued",
      color: "text-muted-foreground",
      dot: "bg-muted-foreground",
   },
   fetching: { label: "Fetching info", color: "text-info", dot: "bg-info" },
   downloading: {
      label: "Downloading",
      color: "text-primary",
      dot: "bg-primary",
   },
   processing: {
      label: "Processing",
      color: "text-warning",
      dot: "bg-warning",
   },
   completed: { label: "Completed", color: "text-success", dot: "bg-success" },
   failed: {
      label: "Failed",
      color: "text-destructive",
      dot: "bg-destructive",
   },
   cancelled: {
      label: "Cancelled",
      color: "text-muted-foreground",
      dot: "bg-muted-foreground",
   },
   skipped: { label: "Skipped", color: "text-warning", dot: "bg-warning" },
   interrupted: {
      label: "Interrupted",
      color: "text-warning",
      dot: "bg-warning",
   },
};

export const ACTIVE_STATUSES: JobStatus[] = [
   "pending",
   "fetching",
   "downloading",
   "processing",
];

export const TERMINAL_STATUSES: JobStatus[] = [
   "completed",
   "failed",
   "cancelled",
   "skipped",
   "interrupted",
];

export const DEFAULT_FILENAME_TEMPLATE = "%(title)s.%(ext)s";
