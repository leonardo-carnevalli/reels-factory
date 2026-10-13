#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  doctorCommand,
  makeCommand,
  recordCommand,
  renderCommand,
  validateCommand,
  type CommandContext,
  type CommandResult,
} from "./commands.js";
import { ExitCode, UserError } from "./errors.js";
import { createLogger, dim, red } from "./log.js";

const HELP = `reels-factory: record a real web page on a phone viewport and cut it into a vertical reel.

Usage
  reels-factory <command> [script] [options]

Commands
  make <script>       record, then render (the usual command)
  record <script>     open the page in Chromium and capture frames, taps and captions
  render <script>     turn the last recording into a 1080x1920 H.264/AAC video
  validate <script>   check a script without opening a browser
  doctor              check Node.js, ffmpeg and the Chromium download

Options
  -o, --out <dir>     output folder (default: out/<script name>)
      --guides        draw the platform safe zone on the video, for layout checks
      --json          print the result as JSON on stdout
  -q, --quiet         only print errors
  -v, --verbose       show every step, ffmpeg command and stack traces
  -h, --help          show this help
      --version       print the version

Examples
  reels-factory make examples/demo.reel.yaml
  reels-factory render examples/demo.reel.yaml --guides
  reels-factory validate my.reel.yaml --json | jq .data.steps

Exit codes: 0 ok, 1 failure, 2 bad usage or invalid script, 3 missing ffmpeg/Chromium.`;

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

function parse(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: "string", short: "o" },
        guides: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        quiet: { type: "boolean", short: "q", default: false },
        verbose: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    throw new UserError((error as Error).message, "run `reels-factory --help`", ExitCode.Usage);
  }
}

async function dispatch(
  command: string | undefined,
  file: string | undefined,
  context: CommandContext,
): Promise<CommandResult> {
  if (command === "doctor") return doctorCommand();
  const scriptCommands = {
    make: makeCommand,
    record: recordCommand,
    render: renderCommand,
    validate: (path: string) => Promise.resolve(validateCommand(path)),
  };
  if (command === undefined || !(command in scriptCommands)) {
    throw new UserError(
      command === undefined ? "missing command" : `unknown command "${command}"`,
      "run `reels-factory --help` to see the commands",
      ExitCode.Usage,
    );
  }
  if (file === undefined) {
    throw new UserError(
      `${command} needs a script file`,
      `try \`reels-factory ${command} examples/demo.reel.yaml\``,
      ExitCode.Usage,
    );
  }
  return scriptCommands[command as keyof typeof scriptCommands](file, context);
}

async function main(argv: string[]): Promise<number> {
  const verbose = argv.includes("-v") || argv.includes("--verbose");
  const json = argv.includes("--json");
  try {
    const { values, positionals } = parse(argv);
    if (values.version) {
      process.stdout.write(`${version()}\n`);
      return ExitCode.Ok;
    }
    if (values.help || positionals.length === 0) {
      process.stdout.write(`${HELP}\n`);
      return values.help ? ExitCode.Ok : ExitCode.Usage;
    }
    const [command, file, extra] = positionals;
    if (extra !== undefined) {
      throw new UserError(
        `unexpected argument "${extra}"`,
        "pass one script per run",
        ExitCode.Usage,
      );
    }
    const log = createLogger({ quiet: values.quiet || values.json, verbose: values.verbose });
    const result = await dispatch(command, file, { log, out: values.out, guides: values.guides });
    if (values.json) {
      process.stdout.write(`${JSON.stringify({ ok: result.exitCode === 0, ...result.data })}\n`);
    } else if (!values.quiet || result.exitCode !== 0) {
      process.stdout.write(`${result.summary}\n`);
    }
    return result.exitCode;
  } catch (error) {
    if (!(error instanceof UserError)) {
      process.stderr.write(`${red("error")} unexpected failure: ${String(error)}\n`);
      if (verbose && error instanceof Error) process.stderr.write(`${dim(error.stack ?? "")}\n`);
      else process.stderr.write("  run again with --verbose for the stack trace\n");
      return ExitCode.Failure;
    }
    process.stderr.write(`${red("error")} ${error.message}\n`);
    if (error.fix) process.stderr.write(`  fix: ${error.fix}\n`);
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: error.message, fix: error.fix })}\n`,
      );
    }
    return error.exitCode;
  }
}

process.exitCode = await main(process.argv.slice(2));
