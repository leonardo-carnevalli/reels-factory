/**
 * Progress goes to stderr so stdout stays clean for --json.
 * Colors only when stderr is a terminal and NO_COLOR is unset.
 */
const useColor = process.stderr.isTTY && !process.env.NO_COLOR;

const paint = (code: number, text: string): string =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : text;

export const dim = (text: string): string => paint(2, text);
export const red = (text: string): string => paint(31, text);
export const green = (text: string): string => paint(32, text);
export const yellow = (text: string): string => paint(33, text);

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

export function createLogger(options: { quiet: boolean; verbose: boolean }): Logger {
  return {
    info: (message) => {
      if (!options.quiet) process.stderr.write(`${message}\n`);
    },
    warn: (message) => {
      process.stderr.write(`${yellow("warn")} ${message}\n`);
    },
    debug: (message) => {
      if (options.verbose) process.stderr.write(`${dim(message)}\n`);
    },
  };
}
