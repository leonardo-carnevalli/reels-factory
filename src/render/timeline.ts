import type { Recording, SpeedRamp } from "../recording.js";

/** Converts a time on the recording clock to a time in the edited screen clip. */
export type TimeMap = (t: number) => number;

/** Sorts ramps and clips overlaps so that each instant has at most one speed factor. */
export function normalizeRamps(ramps: readonly SpeedRamp[]): SpeedRamp[] {
  const sorted = [...ramps].sort((a, b) => a.start - b.start);
  const result: SpeedRamp[] = [];
  let cursor = 0;
  for (const ramp of sorted) {
    const start = Math.max(ramp.start, cursor);
    if (ramp.end <= start) continue;
    result.push({ ...ramp, start });
    cursor = ramp.end;
  }
  return result;
}

/**
 * Builds a piecewise-linear time map: ramps play `factor` times faster, and the whole
 * recording plays `rate` times faster on top of that.
 */
export function createTimeMap(ramps: readonly SpeedRamp[], rate = 1): TimeMap {
  const segments = normalizeRamps(ramps);
  return (t) => {
    let mapped = 0;
    let cursor = 0;
    for (const ramp of segments) {
      if (t <= ramp.start) break;
      mapped += (ramp.start - cursor) / rate;
      const end = Math.min(t, ramp.end);
      mapped += (end - ramp.start) / (ramp.factor * rate);
      cursor = end;
      if (t <= ramp.end) return mapped;
    }
    return mapped + (t - cursor) / rate;
  };
}

/**
 * ffmpeg concat-demuxer script that shows each screencast frame for its mapped duration.
 * The screencast only emits a frame when the page repaints, so durations vary.
 * Paths are relative to the folder holding the list, which avoids Windows drive letters.
 */
export function buildConcatList(
  frames: Recording["frames"],
  duration: number,
  map: TimeMap,
  prefix = "../",
): string {
  const lines: string[] = [];
  frames.forEach((frame, index) => {
    const from = index === 0 ? 0 : frame.t;
    const to = frames[index + 1]?.t ?? duration;
    lines.push(`file '${prefix}${frame.file}'`);
    lines.push(`duration ${Math.max(map(to) - map(from), 0.001).toFixed(5)}`);
  });
  const last = frames.at(-1);
  // The demuxer ignores the duration of the final entry unless the file is repeated.
  if (last) lines.push(`file '${prefix}${last.file}'`);
  return `${lines.join("\n")}\n`;
}

export interface SceneWindow {
  start: number;
  end: number;
  title: string[];
  subtitle?: string | undefined;
}

export interface TimelinePlan {
  screen: number;
  hook: number;
  outro: number;
  transition: number;
  total: number;
  /** Where the screen clip starts and the outro starts in the final video. */
  offsets: { main: number; outro: number };
  scenes: SceneWindow[];
}

export const TRANSITION = 0.35;
const DEFAULT_HOOK = 1.8;
const DEFAULT_OUTRO = 3;

export function planTimeline(
  recording: Pick<Recording, "duration" | "scenes" | "ramps">,
  options: { rate: number; hook?: number | undefined; outro?: number | undefined },
): TimelinePlan {
  const map = createTimeMap(recording.ramps, options.rate);
  const screen = map(recording.duration);
  const hook = options.hook ?? DEFAULT_HOOK;
  const outro = options.outro ?? DEFAULT_OUTRO;
  const starts = recording.scenes.map((scene) => map(scene.t));
  const scenes = recording.scenes.map((scene, index) => ({
    start: starts[index] ?? 0,
    end: starts[index + 1] ?? screen,
    title: scene.title,
    subtitle: scene.subtitle,
  }));
  return {
    screen,
    hook,
    outro,
    transition: TRANSITION,
    total: hook + screen + outro - 2 * TRANSITION,
    offsets: { main: hook - TRANSITION, outro: hook + screen - 2 * TRANSITION },
    scenes,
  };
}
