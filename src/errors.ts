/** Exit codes are part of the CLI contract. Scripts and CI may branch on them. */
export const ExitCode = {
  Ok: 0,
  Failure: 1,
  Usage: 2,
  MissingDependency: 3,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * An error meant for a human: what went wrong plus the next step.
 * Anything that is not a UserError is treated as a bug and shows its stack with --verbose.
 */
export class UserError extends Error {
  constructor(
    message: string,
    readonly fix?: string,
    readonly exitCode: ExitCodeValue = ExitCode.Failure,
  ) {
    super(message);
    this.name = "UserError";
  }
}
