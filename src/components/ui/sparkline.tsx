interface SparklineProps {
   data: number[];
   max?: number;
   width?: number;
   height?: number;
   className?: string;
}

/**
 * A minimal inline-SVG line chart for a rolling series of real telemetry
 * samples. No charting library — this is intentionally the simplest thing
 * that answers "is this trending up, down, or flat," which is all a
 * diagnostics sparkline needs to do.
 */
export function Sparkline({ data, max, width = 240, height = 48, className }: SparklineProps) {
   if (data.length < 2) {
      return (
         <svg width={width} height={height} className={className} role="img" aria-label="Collecting data…">
            <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">
               collecting…
            </text>
         </svg>
      );
   }

   const effectiveMax = Math.max(max ?? 0, ...data, 1);
   const stepX = width / (data.length - 1);
   const points = data.map((v, i) => {
      const x = i * stepX;
      const y = height - (Math.max(0, v) / effectiveMax) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
   });
   const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;

   return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={`Trend, latest value ${data[data.length - 1].toFixed(1)}`}>
         <polygon points={areaPoints} className="fill-primary/10" />
         <polyline points={points.join(" ")} fill="none" className="stroke-primary" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
   );
}
