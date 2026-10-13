import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { ExitCode, UserError } from "../errors.js";

/** ffmpeg 7 is the first release that reads filter graphs from a file with -/filter_complex. */
export const MIN_FFMPEG_MAJOR = 7;

const INSTALL_HINT =
  "install ffmpeg 7+ and make sure it is on PATH (Windows: winget install Gyan.FFmpeg, " +
  "macOS: brew install ffmpeg, Debian/Ubuntu: apt install ffmpeg)";

/**
 * Reads the version from `ffmpeg -version`. Release builds print "ffmpeg version 7.1.1",
 * distro builds add a prefix ("n7.1"), git snapshots print "N-118000-g..." and have no major.
 */
export function parseFfmpegVersion(output: string): { raw: string; major: number | null } | null {
  const raw = /ffmpeg version (\S+)/.exec(output)?.[1];
  if (raw === undefined) return null;
  const major = /^n?(\d+)\./.exec(raw)?.[1];
  return { raw, major: major === undefined ? null : Number(major) };
}

export function detectFfmpeg(): { raw: string; major: number | null } | null {
  const result = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return result.error ? null : parseFfmpegVersion(result.stdout);
}

export function requireFfmpeg(): string {
  const version = detectFfmpeg();
  if (!version) {
    throw new UserError("ffmpeg was not found", INSTALL_HINT, ExitCode.MissingDependency);
  }
  if (version.major !== null && version.major < MIN_FFMPEG_MAJOR) {
    throw new UserError(
      `ffmpeg ${version.raw} is too old (need ${MIN_FFMPEG_MAJOR} or newer)`,
      INSTALL_HINT,
      ExitCode.MissingDependency,
    );
  }
  return version.raw;
}

/** Runs ffmpeg with its chatter in a log file; on failure the error quotes the log's tail. */
export async function runFfmpeg(args: string[], logFile: string): Promise<void> {
  const log = openSync(logFile, "w");
  const code = await new Promise<number | null>((done, fail) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], {
      stdio: ["ignore", "ignore", log],
    });
    child.on("error", fail);
    child.on("close", done);
  }).finally(() => {
    closeSync(log);
  });
  if (code !== 0) {
    const tail = readFileSync(logFile, "utf8").trim().split("\n").slice(-6).join("\n    ");
    throw new UserError(
      `ffmpeg failed (exit ${String(code)})\n    ${tail}`,
      `the full log is at ${logFile}; run with --verbose to see the command`,
    );
  }
}
