import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ExitCode, UserError } from "./errors.js";

/**
 * What `record` writes and `render` reads: raw screencast frames plus marks on the
 * recording clock (seconds since recording started). Nothing here knows about video.
 */
export const recordingSchema = z.strictObject({
  version: z.literal(1),
  viewport: z.strictObject({ width: z.number(), height: z.number(), scale: z.number() }),
  duration: z.number().positive(),
  frames: z.array(z.strictObject({ file: z.string(), t: z.number().min(0) })).min(1),
  scenes: z.array(
    z.strictObject({
      t: z.number().min(0),
      title: z.array(z.string()),
      subtitle: z.string().optional(),
    }),
  ),
  ramps: z.array(
    z.strictObject({ start: z.number().min(0), end: z.number().min(0), factor: z.number().gt(0) }),
  ),
});

export type Recording = z.output<typeof recordingSchema>;
export type SpeedRamp = Recording["ramps"][number];

export const RECORDING_FILE = "recording.json";
export const FRAMES_DIR = "frames";

export function readRecording(outDir: string): Recording {
  const file = join(outDir, RECORDING_FILE);
  if (!existsSync(file)) {
    throw new UserError(
      `no recording found in ${outDir}`,
      "run `reels-factory record <script>` first, or `reels-factory make <script>` to do both",
      ExitCode.Usage,
    );
  }
  const parsed = recordingSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new UserError(
      `${file} is not a recording this version understands`,
      "record again with `reels-factory record <script>`",
    );
  }
  return parsed.data;
}
