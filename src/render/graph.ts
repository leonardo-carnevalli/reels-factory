import { FPS, type Rect } from "./layout.js";

/**
 * Pure builders for every ffmpeg filter graph and argument list. They take numbers and
 * file names and return strings, so the whole edit can be unit tested without ffmpeg.
 */

const num = (value: number): string => value.toFixed(3);

/** 0..1 progress of an animation that starts at `start` and lasts `duration` seconds. */
const progress = (start: number, duration: number): string =>
  `clip((t-${num(start)})/${num(duration)},0,1)`;

/** easeOutBack: overshoots slightly, then settles. Reads as a snappy slide-in. */
const easeOutBack = (u: string): string => `(1+2.70158*pow(${u}-1,3)+1.70158*pow(${u}-1,2))`;

export type SlideFrom = "left" | "right" | "top";

/** x/y offset expressions for a block sliding in from one side. */
function slide(from: SlideFrom, start: number, distance = 380): { x: string; y: string } {
  const remaining = `(1-${easeOutBack(progress(start, 0.4))})`;
  if (from === "top") return { x: "0", y: `-40*${remaining}` };
  return { x: `${from === "left" ? "-" : ""}${distance}*${remaining}`, y: "0" };
}

export const stillInput = (file: string): string[] => [
  "-loop",
  "1",
  "-framerate",
  String(FPS),
  "-i",
  file,
];

const h264 = (crf: number): string[] => [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  String(crf),
  "-pix_fmt",
  "yuv420p",
  "-r",
  String(FPS),
];

/** Stage 1: frames (variable timing) to a constant-rate clip sized for the phone screen. */
export function screenGraph(screen: Pick<Rect, "width" | "height">): string {
  return `[0:v]fps=${FPS},scale=${screen.width}:${screen.height}:flags=lanczos,setsar=1,format=yuv420p[v]`;
}

export function screenArgs(listFile: string, graphFile: string, duration: number, out: string) {
  return [
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-/filter_complex",
    graphFile,
    "-map",
    "[v]",
    "-t",
    num(duration),
    ...h264(14),
    out,
  ];
}

export interface CaptionLayer {
  /** ffmpeg input index of the PNG. */
  input: number;
  start: number;
  end: number;
  y: number;
  from: SlideFrom;
  /** Seconds after the scene starts before this layer animates in. */
  delay: number;
}

/**
 * Stage 2: background, phone screen and bezel, then one caption layer per scene.
 * Inputs: 0 background PNG, 1 screen clip, 2 bezel PNG, 3.. caption PNGs.
 */
export function mainGraph(screen: Rect, captions: readonly CaptionLayer[]): string {
  const parts = [
    "[1:v]tpad=stop=-1:stop_mode=clone,setpts=PTS-STARTPTS[screen]",
    `[0:v][screen]overlay=${screen.x}:${screen.y}[base0]`,
    "[base0][2:v]overlay=0:0[layer0]",
  ];
  captions.forEach((caption, index) => {
    const start = caption.start + caption.delay;
    const fadeOut = Math.max(start, caption.end - 0.15);
    const { x, y } = slide(caption.from, start);
    parts.push(
      `[${caption.input}:v]format=rgba,fade=t=in:st=${num(start)}:d=0.2:alpha=1,` +
        `fade=t=out:st=${num(fadeOut)}:d=0.15:alpha=1[caption${index}]`,
      `[layer${index}][caption${index}]overlay=x='${x}':y='${caption.y}+${y}':` +
        `enable='between(t,${num(caption.start)},${num(caption.end)})'[layer${index + 1}]`,
    );
  });
  parts.push(`[layer${captions.length}]format=yuv420p[v]`);
  return parts.join(";\n");
}

export function mainArgs(inputs: string[], graphFile: string, duration: number, out: string) {
  const [background, screenClip, bezel, ...captions] = inputs;
  if (background === undefined || screenClip === undefined || bezel === undefined) {
    throw new Error("mainArgs needs background, screen clip and bezel");
  }
  return [
    ...stillInput(background),
    "-i",
    screenClip,
    ...stillInput(bezel),
    ...captions.flatMap(stillInput),
    "-/filter_complex",
    graphFile,
    "-map",
    "[v]",
    "-t",
    num(duration),
    ...h264(16),
    out,
  ];
}

export interface CardBlock {
  y: number;
  from: SlideFrom;
}

/** Stage 3: an intro or outro card. Input 0 is the background, 1.. are the text blocks. */
export function cardGraph(blocks: readonly CardBlock[]): string {
  const parts = ["[0:v]format=yuv420p[layer0]"];
  blocks.forEach((block, index) => {
    const start = 0.1 + index * 0.09;
    const { x, y } = slide(block.from, start, 420);
    parts.push(
      `[${index + 1}:v]format=rgba,fade=t=in:st=${num(start)}:d=0.2:alpha=1[block${index}]`,
      `[layer${index}][block${index}]overlay=x='${x}':y='${block.y}+${y}'[layer${index + 1}]`,
    );
  });
  parts.push(`[layer${blocks.length}]format=yuv420p[v]`);
  return parts.join(";\n");
}

export function cardArgs(images: string[], graphFile: string, duration: number, out: string) {
  return [
    ...images.flatMap(stillInput),
    "-/filter_complex",
    graphFile,
    "-map",
    "[v]",
    "-t",
    num(duration),
    ...h264(16),
    out,
  ];
}

export interface FinalOptions {
  hook: number;
  screen: number;
  transition: number;
  total: number;
  offsets: { main: number; outro: number };
  music?: { volume: number; start: number } | undefined;
  guides: boolean;
}

/**
 * Stage 4: hook, screen and outro joined with crossfades, plus the audio bed.
 * Inputs: 0 hook, 1 main, 2 outro, 3 music or generated silence, 4 optional safe-zone guides.
 * Without music the track is silent AAC, which every platform accepts and editors can replace.
 */
export function finalGraph(options: FinalOptions): string {
  const { transition, total, offsets, music } = options;
  const video = [
    `[0:v]settb=AVTB,fps=${FPS}[hook]`,
    `[1:v]settb=AVTB,fps=${FPS}[main]`,
    `[2:v]settb=AVTB,fps=${FPS}[outro]`,
    `[hook][main]xfade=transition=slideleft:duration=${num(transition)}:offset=${num(offsets.main)}[joined]`,
    `[joined][outro]xfade=transition=fade:duration=${num(transition)}:offset=${num(offsets.outro)}` +
      (options.guides ? "[unguided]" : ",format=yuv420p[v]"),
  ];
  if (options.guides) video.push("[unguided][4:v]overlay=0:0,format=yuv420p[v]");
  const audio = music
    ? `[3:a]atrim=start=${num(music.start)},asetpts=PTS-STARTPTS,afade=t=in:d=0.4,` +
      `afade=t=out:st=${num(Math.max(0, total - 1.5))}:d=1.5,volume=${num(music.volume)},` +
      "aresample=48000[a]"
    : `[3:a]atrim=duration=${num(total)}[a]`;
  return [...video, audio].join(";\n");
}

export function finalArgs(
  clips: { hook: string; main: string; outro: string; music?: string | undefined; guides?: string },
  graphFile: string,
  total: number,
  out: string,
) {
  const audioInput = clips.music
    ? ["-i", clips.music]
    : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"];
  return [
    "-i",
    clips.hook,
    "-i",
    clips.main,
    "-i",
    clips.outro,
    ...audioInput,
    ...(clips.guides ? stillInput(clips.guides) : []),
    "-/filter_complex",
    graphFile,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    num(total),
    ...h264(18),
    "-profile:v",
    "high",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    out,
  ];
}

/** A strip of four thumbnails to eyeball the reel without opening it. */
export function previewArgs(video: string, total: number, out: string): string[] {
  const times = [0.6, 0.35 * total, 0.65 * total, total - 0.8];
  const inputs = times.flatMap((t) => ["-ss", num(Math.max(0, t)), "-i", video]);
  const scaled = times.map((_, index) => `[${index}:v]scale=270:-2[p${index}]`).join(";");
  const labels = times.map((_, index) => `[p${index}]`).join("");
  return [
    ...inputs,
    "-filter_complex",
    `${scaled};${labels}hstack=inputs=${times.length}[v]`,
    "-map",
    "[v]",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    out,
  ];
}
