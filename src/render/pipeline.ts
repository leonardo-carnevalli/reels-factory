import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../log.js";
import { readRecording } from "../recording.js";
import type { LoadedScript } from "../script/load.js";
import { runFfmpeg, requireFfmpeg } from "./ffmpeg.js";
import {
  cardArgs,
  cardGraph,
  finalArgs,
  finalGraph,
  mainArgs,
  mainGraph,
  previewArgs,
  screenArgs,
  screenGraph,
  type CaptionLayer,
} from "./graph.js";
import { computeLayout, isInside, SAFE_ZONE, stackBlocks } from "./layout.js";
import { renderOverlays, type CardImages } from "./overlays.js";
import { buildConcatList, createTimeMap, planTimeline } from "./timeline.js";

export interface RenderResult {
  video: string;
  preview: string;
  duration: number;
  scenes: number;
}

const BUILD_DIR = "build";

/** Every intermediate lives in <out>/build with its graph and log, so a failed stage is debuggable. */
export async function render(
  script: LoadedScript,
  outDir: string,
  log: Logger,
  options: { guides: boolean },
): Promise<RenderResult> {
  log.debug(`ffmpeg ${requireFfmpeg()}`);
  const recording = readRecording(outDir);
  const build = join(outDir, BUILD_DIR);
  mkdirSync(build, { recursive: true });

  const plan = planTimeline(recording, {
    rate: script.rate,
    hook: script.hook.duration,
    outro: script.outro.duration,
  });
  const layout = computeLayout(recording.viewport);
  for (const scene of plan.scenes) {
    if (scene.end - scene.start < 0.8) {
      log.warn(
        `caption "${scene.title.join(" ")}" is on screen for under 0.8s; give it more steps`,
      );
    }
  }

  const stage = async (name: string, graph: string, args: (graphFile: string) => string[]) => {
    const graphFile = join(build, `${name}.graph.txt`);
    writeFileSync(graphFile, graph);
    const argv = args(graphFile);
    log.debug(`ffmpeg ${argv.join(" ")}`);
    await runFfmpeg(argv, join(build, `${name}.log`));
  };

  log.info("drawing overlays");
  const overlays = await renderOverlays({
    dir: build,
    brand: script.brand,
    layout,
    scenes: plan.scenes,
    hook: script.hook,
    outro: script.outro,
  });

  log.info(`cutting screen clip (${plan.screen.toFixed(1)}s)`);
  const listFile = join(build, "frames.txt");
  const map = createTimeMap(recording.ramps, script.rate);
  writeFileSync(listFile, buildConcatList(recording.frames, recording.duration, map));
  const screenClip = join(build, "screen.mp4");
  await stage("screen", screenGraph(layout.screen), (graph) =>
    screenArgs(listFile, graph, plan.screen, screenClip),
  );

  log.info(`compositing ${plan.scenes.length} scenes`);
  const captionInputs: string[] = [];
  const layers: CaptionLayer[] = [];
  plan.scenes.forEach((scene, index) => {
    const caption = overlays.captions[index];
    if (!caption) return;
    const from = index % 2 === 0 ? "left" : "right";
    captionInputs.push(caption.title);
    layers.push({
      input: 2 + captionInputs.length,
      ...scene,
      y: layout.captionTitle.y,
      from,
      delay: 0,
    });
    if (caption.subtitle) {
      captionInputs.push(caption.subtitle);
      layers.push({
        input: 2 + captionInputs.length,
        ...scene,
        y: layout.captionSubtitle.y,
        from,
        delay: 0.14,
      });
    }
  });
  const mainClip = join(build, "main.mp4");
  await stage("main", mainGraph(layout.screen, layers), (graph) =>
    mainArgs(
      [overlays.background, screenClip, overlays.bezel, ...captionInputs],
      graph,
      plan.screen,
      mainClip,
    ),
  );

  const card = async (key: "hook" | "outro", images: CardImages, duration: number) => {
    const positions = stackBlocks(images.blocks.map((block) => block.height));
    const blocks = images.blocks.map((block, index) => ({
      y: positions[index] ?? 0,
      from: block.from,
    }));
    const last = images.blocks.at(-1);
    const bottom = { ...SAFE_ZONE, y: blocks.at(-1)?.y ?? 0, height: last?.height ?? 0 };
    if (!isInside(bottom)) log.warn(`${key} text runs past the safe zone; shorten it`);
    const out = join(build, `${key}.mp4`);
    await stage(key, cardGraph(blocks), (graph) =>
      cardArgs(
        [images.background, ...images.blocks.map((block) => block.file)],
        graph,
        duration,
        out,
      ),
    );
    return out;
  };
  log.info("animating hook and outro");
  const hookClip = await card("hook", overlays.hook, plan.hook);
  const outroClip = await card("outro", overlays.outro, plan.outro);

  log.info(`joining and mixing audio (${plan.total.toFixed(1)}s)`);
  const video = join(outDir, `${script.name}.mp4`);
  await stage(
    "final",
    finalGraph({ ...plan, music: script.music, guides: options.guides }),
    (graph) =>
      finalArgs(
        {
          hook: hookClip,
          main: mainClip,
          outro: outroClip,
          music: script.music?.file,
          ...(options.guides ? { guides: overlays.guides } : {}),
        },
        graph,
        plan.total,
        video,
      ),
  );

  const preview = join(outDir, `${script.name}.preview.jpg`);
  await runFfmpeg(previewArgs(video, plan.total, preview), join(build, "preview.log"));
  return { video, preview, duration: plan.total, scenes: plan.scenes.length };
}
