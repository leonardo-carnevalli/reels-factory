import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ExitCode, UserError } from "../src/errors.js";
import { loadScript } from "../src/script/load.js";

const BODY =
  "baseUrl: https://example.com\nhook: { title: Hi }\noutro: { title: Bye }\nsteps: [{ goto: / }]\n";

describe("loadScript", () => {
  it("loads the shipped example and resolves its paths", () => {
    const script = loadScript("examples/demo.reel.yaml");
    expect(script.name).toBe("demo");
    expect(script.serve).toBe(resolve("examples/demo-site"));
    expect(script.brand.logo).toBe(resolve("examples/brand/logo.svg"));
    expect(script.steps[0]).toMatchObject({ action: "goto", url: "/" });
  });

  it("explains a missing file with a usage exit code", () => {
    const attempt = () => loadScript("nope.reel.yaml");
    expect(attempt).toThrow(UserError);
    expect(attempt).toThrow(/script not found/);
    try {
      attempt();
    } catch (error) {
      expect((error as UserError).exitCode).toBe(ExitCode.Usage);
    }
  });

  it("derives the name from the file name", () => {
    const file = join(mkdtempSync(join(tmpdir(), "reels-factory-")), "launch.reel.yml");
    writeFileSync(file, BODY);
    expect(loadScript(file).name).toBe("launch");
  });

  it("reports a missing asset before anything runs", () => {
    const file = join(mkdtempSync(join(tmpdir(), "reels-factory-")), "x.yml");
    writeFileSync(file, `music: { file: missing.mp3 }\n${BODY}`);
    expect(() => loadScript(file)).toThrow(/music file not found/);
  });
});
