import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ExitCode } from "./errors.js";
import { green, red, type Logger } from "./log.js";
import { record } from "./record/recorder.js";
import { detectFfmpeg, MIN_FFMPEG_MAJOR } from "./render/ffmpeg.js";
import { render } from "./render/pipeline.js";
import { loadScript, type LoadedScript } from "./script/load.js";

export interface CommandContext {
  log: Logger;
  out?: string | undefined;
  guides: boolean;
}

/** What a command reports; printed as a sentence for humans or as-is with --json. */
export interface CommandResult {
  exitCode: number;
  summary: string;
  data: Record<string, unknown>;
}

const outDirFor = (script: LoadedScript, out: string | undefined): string => {
  const dir = resolve(out ?? `out/${script.name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

export function validateCommand(file: string): CommandResult {
  const script = loadScript(file);
  const captions = script.steps.filter((step) => step.action === "caption").length;
  const { width, height, scale } = script.viewport;
  return {
    exitCode: ExitCode.Ok,
    summary: `${green("valid")} ${script.name}: ${script.steps.length} steps, ${captions} captions, viewport ${width}x${height}@${scale}x`,
    data: { name: script.name, steps: script.steps.length, captions, viewport: script.viewport },
  };
}

export async function recordCommand(file: string, context: CommandContext): Promise<CommandResult> {
  const script = loadScript(file);
  const outDir = outDirFor(script, context.out);
  context.log.info(`recording ${script.name} (${script.steps.length} steps)`);
  const recording = await record(script, outDir, context.log);
  return {
    exitCode: ExitCode.Ok,
    summary: `${green("recorded")} ${recording.duration.toFixed(1)}s, ${recording.frames.length} frames -> ${outDir}`,
    data: { outDir, duration: recording.duration, frames: recording.frames.length },
  };
}

export async function renderCommand(file: string, context: CommandContext): Promise<CommandResult> {
  const script = loadScript(file);
  const outDir = outDirFor(script, context.out);
  const result = await render(script, outDir, context.log, { guides: context.guides });
  return {
    exitCode: ExitCode.Ok,
    summary: `${green("rendered")} ${result.video} (${result.duration.toFixed(1)}s, preview: ${result.preview})`,
    data: { ...result },
  };
}

export async function makeCommand(file: string, context: CommandContext): Promise<CommandResult> {
  const recorded = await recordCommand(file, context);
  context.log.info(recorded.summary);
  return renderCommand(file, context);
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export async function doctorCommand(): Promise<CommandResult> {
  const checks: Check[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: nodeMajor >= 22,
    detail: process.versions.node,
    fix: "install Node.js 22 or newer",
  });

  const ffmpeg = detectFfmpeg();
  checks.push({
    name: "ffmpeg",
    ok: ffmpeg !== null && (ffmpeg.major === null || ffmpeg.major >= MIN_FFMPEG_MAJOR),
    detail: ffmpeg?.raw ?? "not found on PATH",
    fix: `install ffmpeg ${MIN_FFMPEG_MAJOR}+ and put it on PATH`,
  });

  const { chromium } = await import("playwright");
  const browser = chromium.executablePath();
  checks.push({
    name: "chromium",
    ok: existsSync(browser),
    detail: browser,
    fix: "npx playwright install chromium",
  });

  const ok = checks.every((check) => check.ok);
  const lines = checks.map(
    (check) =>
      `${check.ok ? green("ok     ") : red("missing")} ${check.name.padEnd(9)} ${check.detail}` +
      (check.ok || !check.fix ? "" : `\n          fix: ${check.fix}`),
  );
  return {
    exitCode: ok ? ExitCode.Ok : ExitCode.MissingDependency,
    summary: lines.join("\n"),
    data: { ok, checks },
  };
}
