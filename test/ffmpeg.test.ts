import { describe, expect, it } from "vitest";
import { parseFfmpegVersion } from "../src/render/ffmpeg.js";

describe("parseFfmpegVersion", () => {
  it("reads release builds", () => {
    expect(parseFfmpegVersion("ffmpeg version 7.1.1 Copyright (c) 2000-2025")).toEqual({
      raw: "7.1.1",
      major: 7,
    });
  });

  it("reads builds with a suffix or an n prefix", () => {
    expect(parseFfmpegVersion("ffmpeg version 8.0-full_build-www.example.dev")?.major).toBe(8);
    expect(parseFfmpegVersion("ffmpeg version n6.1.2 Copyright")?.major).toBe(6);
  });

  it("accepts git snapshots, which have no major version", () => {
    expect(parseFfmpegVersion("ffmpeg version N-118000-gabcdef Copyright")).toEqual({
      raw: "N-118000-gabcdef",
      major: null,
    });
  });

  it("returns null for unrelated output", () => {
    expect(parseFfmpegVersion("command not found")).toBeNull();
  });
});
