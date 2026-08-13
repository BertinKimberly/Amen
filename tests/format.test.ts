import { describe, it, expect } from "vitest";
import {
   formatBytes,
   formatDuration,
   formatCount,
   qualityLabel,
   percentLabel,
} from "@/lib/format";

describe("formatBytes", () => {
   it("formats bytes and units", () => {
      expect(formatBytes(500)).toBe("500 B");
      expect(formatBytes(1024)).toBe("1.00 KB");
      expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
      expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
   });

   it("handles null/undefined", () => {
      expect(formatBytes(null)).toBe("—");
      expect(formatBytes(undefined)).toBe("—");
   });
});

describe("formatDuration", () => {
   it("formats minutes and hours", () => {
      expect(formatDuration(0)).toBe("0:00");
      expect(formatDuration(65)).toBe("1:05");
      expect(formatDuration(3661)).toBe("1:01:01");
   });

   it("handles null", () => {
      expect(formatDuration(null)).toBe("—");
   });
});

describe("formatCount", () => {
   it("abbreviates large counts", () => {
      expect(formatCount(1234)).toBe("1.2K");
      expect(formatCount(2_500_000)).toBe("2.5M");
      expect(formatCount(999)).toBe("999");
   });
});

describe("qualityLabel", () => {
   it("maps known quality values", () => {
      expect(qualityLabel("best")).toBe("Best");
      expect(qualityLabel("320")).toBe("320 kbps");
      expect(qualityLabel("128")).toBe("128 kbps");
   });

   it("passes through unknown values", () => {
      expect(qualityLabel("weird")).toBe("weird");
   });
});

describe("percentLabel", () => {
   it("clamps and rounds", () => {
      expect(percentLabel(42.4)).toBe("42%");
      expect(percentLabel(150)).toBe("100%");
      expect(percentLabel(-5)).toBe("0%");
   });
});
