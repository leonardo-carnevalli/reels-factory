import { describe, expect, it } from "vitest";
import {
  cardGraph,
  finalArgs,
  finalGraph,
  mainArgs,
  mainGraph,
  previewArgs,
  screenGraph,
} from "../src/render/graph.js";

const screen = { x: 250, y: 620, width: 580, height: 1254 };

/** Every label a chain reads must exist already, and the graph must end in [v]. */
function expectWellFormed(graph: string, inputs: number): void {
  const produced = new Set(
    Array.from({ length: inputs }, (_, index) => [`${index}:v`, `${index}:a`]).flat(),
  );
  for (const chain of graph.split(";")) {
    const head = /^\s*((?:\[[^\]]+\])+)/.exec(chain)?.[1] ?? "";
    for (const [, label] of head.matchAll(/\[([^\]]+)\]/g)) {
      expect(produced, `[${label ?? ""}] read before it exists in: ${chain}`).toContain(label);
    }
    const output = /\[([^\]]+)\]\s*$/.exec(chain)?.[1];
    if (output) produced.add(output);
  }
  expect(produced).toContain("v");
}

describe("screenGraph", () => {
  it("resamples to 30 fps and scales to the screen box", () => {
    expect(screenGraph(screen)).toBe(
      "[0:v]fps=30,scale=580:1254:flags=lanczos,setsar=1,format=yuv420p[v]",
    );
  });
});

describe("mainGraph", () => {
  const graph = mainGraph(screen, [
    { input: 3, start: 0, end: 2, y: 312, from: "left", delay: 0 },
    { input: 4, start: 0, end: 2, y: 500, from: "left", delay: 0.14 },
    { input: 5, start: 2, end: 5, y: 312, from: "right", delay: 0 },
  ]);

  it("chains every caption layer and ends in [v]", () => {
    expectWellFormed(graph, 6);
  });

  it("overlays the screen at its layout position", () => {
    expect(graph).toContain("[0:v][screen]overlay=250:620[base0]");
  });

  it("shows each caption only during its scene and fades it out before the cut", () => {
    expect(graph).toContain("enable='between(t,2.000,5.000)'");
    expect(graph).toContain("fade=t=out:st=4.850:d=0.15:alpha=1");
  });

  it("slides alternate scenes in from opposite sides", () => {
    expect(graph).toMatch(/\[layer0\]\[caption0\]overlay=x='-380\*/);
    expect(graph).toMatch(/\[layer2\]\[caption2\]overlay=x='380\*/);
  });

  it("delays the subtitle relative to the title", () => {
    expect(graph).toContain("fade=t=in:st=0.140");
  });

  it("works with no captions at all", () => {
    expectWellFormed(mainGraph(screen, []), 3);
  });
});

describe("mainArgs", () => {
  it("loops still images and reads the clip once", () => {
    const args = mainArgs(["bg.png", "screen.mp4", "bezel.png", "c0.png"], "g.txt", 5, "out.mp4");
    expect(args.filter((arg) => arg === "-loop")).toHaveLength(3);
    expect(args).toContain("-/filter_complex");
    expect(args.at(-1)).toBe("out.mp4");
  });
});

describe("cardGraph", () => {
  it("staggers blocks and produces [v]", () => {
    const graph = cardGraph([
      { y: 420, from: "top" },
      { y: 500, from: "left" },
      { y: 760, from: "right" },
    ]);
    expectWellFormed(graph, 4);
    expect(graph).toContain("fade=t=in:st=0.100");
    expect(graph).toContain("fade=t=in:st=0.280");
  });
});

describe("finalGraph", () => {
  const base = {
    hook: 1.8,
    screen: 10,
    transition: 0.35,
    total: 14.1,
    offsets: { main: 1.45, outro: 11.1 },
    guides: false,
  };

  it("crossfades hook, main and outro at the planned offsets", () => {
    const graph = finalGraph(base);
    expectWellFormed(graph, 4);
    expect(graph).toContain("xfade=transition=slideleft:duration=0.350:offset=1.450");
    expect(graph).toContain("xfade=transition=fade:duration=0.350:offset=11.100");
  });

  it("trims generated silence to the video length when there is no music", () => {
    expect(finalGraph(base)).toContain("[3:a]atrim=duration=14.100[a]");
  });

  it("fades and levels the music", () => {
    const graph = finalGraph({ ...base, music: { volume: 0.5, start: 12 } });
    expect(graph).toContain("atrim=start=12.000");
    expect(graph).toContain("afade=t=out:st=12.600:d=1.5");
    expect(graph).toContain("volume=0.500");
  });

  it("draws the safe-zone guides as the last overlay", () => {
    const graph = finalGraph({ ...base, guides: true });
    expectWellFormed(graph, 5);
    expect(graph).toContain("[unguided][4:v]overlay=0:0");
  });
});

describe("finalArgs", () => {
  it("produces a web-ready H.264 + AAC file", () => {
    const args = finalArgs({ hook: "h", main: "m", outro: "o" }, "g.txt", 12, "reel.mp4").join(" ");
    for (const expected of [
      "-c:v libx264",
      "-pix_fmt yuv420p",
      "-c:a aac",
      "-movflags +faststart",
      "anullsrc",
    ]) {
      expect(args).toContain(expected);
    }
  });

  it("uses the music file instead of silence when given", () => {
    const args = finalArgs({ hook: "h", main: "m", outro: "o", music: "song.mp3" }, "g", 12, "r");
    expect(args).toContain("song.mp3");
    expect(args.join(" ")).not.toContain("anullsrc");
  });
});

describe("previewArgs", () => {
  it("samples four moments into one strip", () => {
    const args = previewArgs("reel.mp4", 20, "p.jpg");
    expect(args.filter((arg) => arg === "reel.mp4")).toHaveLength(4);
    expect(args.join(" ")).toContain("hstack=inputs=4");
  });
});
