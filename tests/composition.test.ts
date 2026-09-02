import { describe, it, expect } from "vitest";
import {
   computeCompositionStats,
   computeTimelineDuration,
   itemEffectiveDuration,
   itemSpan,
} from "@/lib/studioTypes";
import type { StudioProject, StudioTimelineItem } from "@/lib/studioTypes";

function item(clipId: string, position: number, over: Partial<StudioTimelineItem> = {}): StudioTimelineItem {
   return {
      clipId,
      position,
      volume: 1,
      muted: false,
      fadeIn: 0,
      fadeOut: 0,
      crossfadePrev: 0,
      trimStart: 0,
      trimEnd: 0,
      ...over,
   };
}

/** Three clips of 20s / 35s / 15s cut from one 5-minute source — the user's example. */
function project(items: StudioTimelineItem[][], clipLengths = [20, 35, 15]): StudioProject {
   return {
      version: 1,
      name: "Test",
      createdAt: 0,
      modifiedAt: 0,
      sources: [
         {
            id: "s1",
            path: "C:/song.mp3",
            name: "song.mp3",
            duration: 300,
            sampleRate: 44100,
            channels: 2,
            bpm: null,
            markers: [],
         },
      ],
      clips: clipLengths.map((len, i) => ({
         id: `c${i + 1}`,
         sourceId: "s1",
         name: `Clip ${i + 1}`,
         start: 10 + i * 50,
         end: 10 + i * 50 + len,
      })),
      timeline: {
         tracks: items.map((its, i) => ({
            id: `t${i + 1}`,
            name: `Track ${i + 1}`,
            muted: false,
            solo: false,
            volume: 1,
            items: its,
         })),
      },
      export: { title: "", artist: "", album: "", year: "", comment: "", artwork: null },
      settings: { sampleRate: 44100, normalize: "none", normalizeTargetDb: -1, normalizeLufs: -16 },
   };
}

describe("computeCompositionStats", () => {
   it("reports the combined length of a sequential A -> B -> C arrangement", () => {
      const p = project([[item("c1", 0), item("c2", 20), item("c3", 55)]]);
      const stats = computeCompositionStats(p);
      expect(stats.duration).toBe(70);
      expect(stats.contentDuration).toBe(70);
      expect(stats.leadingSilence).toBe(0);
      expect(stats.gapSilence).toBe(0);
      expect(stats.itemCount).toBe(3);
   });

   it("never reports the source's length — only the arrangement's", () => {
      // One 20s clip cut from a 5-minute song.
      const p = project([[item("c1", 0)]]);
      expect(computeCompositionStats(p).duration).toBe(20);
      expect(computeTimelineDuration(p)).toBe(20);
   });

   it("surfaces the dead air that used to only show up in the exported file", () => {
      // Clips scattered by pointer drops: 20s at 0, 35s at 100, 15s at 200.
      const p = project([[item("c1", 0), item("c2", 100), item("c3", 200)]]);
      const stats = computeCompositionStats(p);
      expect(stats.duration).toBe(215);
      expect(stats.contentDuration).toBe(70);
      expect(stats.gapSilence).toBe(145); // 80 + 65
      expect(stats.leadingSilence).toBe(0);
   });

   it("counts leading silence separately from gaps", () => {
      const p = project([[item("c1", 30), item("c2", 50)]]);
      const stats = computeCompositionStats(p);
      expect(stats.leadingSilence).toBe(30);
      expect(stats.gapSilence).toBe(0);
      expect(stats.duration).toBe(85);
   });

   it("does not double-count silence when tracks overlap", () => {
      // Track 1: 20s at 0. Track 2: 35s at 10 (overlapping). No real gap.
      const p = project([[item("c1", 0)], [item("c2", 10)]]);
      const stats = computeCompositionStats(p);
      expect(stats.duration).toBe(45);
      expect(stats.contentDuration).toBe(55); // 20 + 35, they play together
      expect(stats.gapSilence).toBe(0);
   });

   it("treats a crossfade as an earlier render start, matching the renderer", () => {
      const p = project([[item("c1", 0), item("c2", 20, { crossfadePrev: 5 })]]);
      // Clip 2 starts rendering at 15, so the mix ends at 15 + 35 = 50.
      expect(computeCompositionStats(p).duration).toBe(50);
      expect(computeTimelineDuration(p)).toBe(50);
   });

   it("respects non-destructive trim", () => {
      const p = project([[item("c1", 0, { trimStart: 3, trimEnd: 2 })]]);
      expect(computeCompositionStats(p).duration).toBe(15);
   });

   it("excludes a muted track, so the figure on screen equals the exported file", () => {
      // 20s of audible material, plus a clip parked at 4:40 on a muted track.
      const p = project([[item("c1", 0)], [item("c2", 280)]]);
      p.timeline.tracks[1].muted = true;
      const stats = computeCompositionStats(p);
      expect(stats.duration, "a muted clip is not in the file and must not be in the number").toBe(20);
      expect(stats.itemCount).toBe(1);
      expect(computeTimelineDuration(p)).toBe(20);
   });

   it("excludes tracks silenced by another track's solo", () => {
      const p = project([[item("c1", 0)], [item("c2", 280)]]);
      p.timeline.tracks[0].solo = true;
      expect(computeCompositionStats(p).duration).toBe(20);
   });

   it("treats a soloed-but-muted track as silent, matching the renderer", () => {
      const p = project([[item("c1", 0)], [item("c2", 280)]]);
      p.timeline.tracks[1].solo = true;
      p.timeline.tracks[1].muted = true;
      // Track 2 is soloed (so track 1 is silenced) but also muted (so it is
      // silent itself): nothing is audible at all.
      expect(computeCompositionStats(p).duration).toBe(0);
   });

   it("is zero for an empty timeline", () => {
      const stats = computeCompositionStats(project([[]]));
      expect(stats).toEqual({
         duration: 0,
         contentDuration: 0,
         leadingSilence: 0,
         gapSilence: 0,
         itemCount: 0,
      });
   });

   it("ignores items whose clip no longer exists rather than throwing", () => {
      const p = project([[item("c1", 0), item("ghost", 30)]]);
      expect(computeCompositionStats(p).duration).toBe(20);
   });

   it("agrees with computeTimelineDuration in every case", () => {
      const cases = [
         [[item("c1", 0), item("c2", 20), item("c3", 55)]],
         [[item("c1", 0)], [item("c2", 100)]],
         [[item("c1", 5, { crossfadePrev: 2 })]],
         [[item("c1", 0, { trimEnd: 5 })]],
      ];
      for (const items of cases) {
         const p = project(items);
         expect(computeCompositionStats(p).duration).toBeCloseTo(computeTimelineDuration(p), 9);
      }
   });
});

describe("itemSpan / itemEffectiveDuration", () => {
   const p = project([[]]);
   const clip = p.clips[0]; // 20s

   it("clamps a crossfade that would push the render start below zero", () => {
      expect(itemSpan(item("c1", 2, { crossfadePrev: 10 }), clip).start).toBe(0);
   });

   it("never produces a negative duration however aggressive the trim", () => {
      expect(itemEffectiveDuration(item("c1", 0, { trimStart: 50, trimEnd: 50 }), clip)).toBe(0);
   });
});
