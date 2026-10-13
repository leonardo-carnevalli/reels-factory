import { describe, expect, it } from "vitest";
import {
  buildConcatList,
  createTimeMap,
  normalizeRamps,
  planTimeline,
  TRANSITION,
} from "../src/render/timeline.js";

describe("createTimeMap", () => {
  it("is the identity without ramps at rate 1", () => {
    const map = createTimeMap([]);
    expect(map(0)).toBe(0);
    expect(map(7.5)).toBe(7.5);
  });

  it("divides time by the global rate", () => {
    expect(createTimeMap([], 2)(10)).toBe(5);
  });

  it("compresses a ramp and shifts everything after it", () => {
    const map = createTimeMap([{ start: 2, end: 6, factor: 4 }]);
    expect(map(2)).toBe(2);
    expect(map(4)).toBe(2.5);
    expect(map(6)).toBe(3);
    expect(map(8)).toBe(5);
  });

  it("combines ramps with the global rate", () => {
    const map = createTimeMap([{ start: 0, end: 4, factor: 2 }], 2);
    expect(map(4)).toBe(1);
    expect(map(6)).toBe(2);
  });

  it("never goes back in time", () => {
    const map = createTimeMap([
      { start: 1, end: 3, factor: 3 },
      { start: 5, end: 9, factor: 8 },
    ]);
    let previous = -1;
    for (let t = 0; t <= 12; t += 0.25) {
      expect(map(t)).toBeGreaterThan(previous);
      previous = map(t);
    }
  });
});

describe("normalizeRamps", () => {
  it("sorts ramps and clips overlaps", () => {
    expect(
      normalizeRamps([
        { start: 4, end: 8, factor: 2 },
        { start: 1, end: 5, factor: 3 },
        { start: 5, end: 6, factor: 9 },
      ]),
    ).toEqual([
      { start: 1, end: 5, factor: 3 },
      { start: 5, end: 8, factor: 2 },
    ]);
  });
});

describe("buildConcatList", () => {
  it("holds each frame until the next one and repeats the last entry", () => {
    const frames = [
      { file: "frames/000000.jpg", t: 0.2 },
      { file: "frames/000001.jpg", t: 1 },
    ];
    expect(buildConcatList(frames, 3, createTimeMap([]))).toBe(
      [
        "file '../frames/000000.jpg'",
        "duration 1.00000",
        "file '../frames/000001.jpg'",
        "duration 2.00000",
        "file '../frames/000001.jpg'",
        "",
      ].join("\n"),
    );
  });

  it("applies the time map to frame durations", () => {
    const list = buildConcatList([{ file: "a.jpg", t: 0 }], 4, createTimeMap([], 2), "");
    expect(list).toContain("duration 2.00000");
  });
});

describe("planTimeline", () => {
  const recording = {
    duration: 10,
    ramps: [{ start: 4, end: 8, factor: 4 }],
    scenes: [
      { t: 0, title: ["One"] },
      { t: 5, title: ["Two"], subtitle: "sub" },
    ],
  };

  it("computes scene windows on the edited clock", () => {
    const plan = planTimeline(recording, { rate: 1 });
    expect(plan.screen).toBe(7);
    expect(plan.scenes).toEqual([
      { start: 0, end: 4.25, title: ["One"], subtitle: undefined },
      { start: 4.25, end: 7, title: ["Two"], subtitle: "sub" },
    ]);
  });

  it("subtracts both crossfades from the total and places the clips", () => {
    const plan = planTimeline(recording, { rate: 1, hook: 2, outro: 3 });
    expect(plan.total).toBeCloseTo(2 + 7 + 3 - 2 * TRANSITION);
    expect(plan.offsets.main).toBeCloseTo(2 - TRANSITION);
    expect(plan.offsets.outro).toBeCloseTo(2 + 7 - 2 * TRANSITION);
  });
});
