import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, CDPSession, Page } from "playwright";
import { ExitCode, UserError } from "../errors.js";
import type { Logger } from "../log.js";
import { FRAMES_DIR, RECORDING_FILE, type Recording } from "../recording.js";
import type { LoadedScript } from "../script/load.js";
import type { Step } from "../script/schema.js";
import { pointerScript } from "./pointer.js";
import { serveFolder } from "./server.js";

const MOVE_MS = 260;
const TAIL_MS = 700;

export function describeStep(step: Step): string {
  switch (step.action) {
    case "goto":
      return `goto ${step.url}`;
    case "click":
    case "type":
    case "waitFor":
      return `${step.action} "${step.selector}"`;
    case "scroll":
      return `scroll to ${typeof step.to === "number" ? step.to : `"${step.to}"`}`;
    case "wait":
      return `wait ${step.ms}ms`;
    case "caption":
      return `caption "${step.title.join(" ")}"`;
  }
}

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  try {
    return await chromium.launch();
  } catch (error) {
    throw new UserError(
      `could not start Chromium: ${(error as Error).message.split("\n")[0] ?? ""}`,
      "install the browser once with `npx playwright install chromium`",
      ExitCode.MissingDependency,
    );
  }
}

class StepRunner {
  constructor(
    private readonly page: Page,
    private readonly baseUrl: string | undefined,
  ) {}

  async run(step: Step): Promise<void> {
    const { page } = this;
    switch (step.action) {
      case "goto": {
        await page.goto(this.baseUrl ? new URL(step.url, this.baseUrl).href : step.url);
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
        return;
      }
      case "click":
        await this.tap(step.selector);
        await page.locator(step.selector).first().click({ timeout: 10_000 });
        await page.waitForTimeout(step.pause);
        return;
      case "type":
        await this.tap(step.selector);
        await page.locator(step.selector).first().pressSequentially(step.text, {
          delay: step.delay,
        });
        return;
      case "scroll":
        await this.scroll(step.to, step.duration);
        return;
      case "wait":
        await page.waitForTimeout(step.ms);
        return;
      case "waitFor":
        await page.locator(step.selector).first().waitFor({ timeout: step.timeout });
        return;
      case "caption":
        return;
    }
  }

  /** Glides the fingertip to the element, drops a ripple and gives the element a small press. */
  private async tap(selector: string): Promise<void> {
    const target = this.page.locator(selector).first();
    await target.scrollIntoViewIfNeeded({ timeout: 10_000 });
    const box = await target.boundingBox();
    if (!box) throw new Error("element has no visible box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.page.evaluate(`window.__rf.move(${x}, ${y}, ${MOVE_MS})`);
    await this.page.waitForTimeout(MOVE_MS + 40);
    await this.page.evaluate(`window.__rf.tap(${x}, ${y})`);
    await target
      .evaluate((element) =>
        element.animate([{ scale: "1" }, { scale: "0.94" }, { scale: "1" }], { duration: 240 }),
      )
      .catch(() => undefined);
    await this.page.waitForTimeout(80);
  }

  private async scroll(to: number | string, duration: number): Promise<void> {
    const top =
      typeof to === "number"
        ? to
        : await this.page
            .locator(to)
            .first()
            .evaluate((element) => element.getBoundingClientRect().top + window.scrollY - 160);
    await this.page.evaluate(
      // No named inner functions here: dev transpilers wrap them in helpers the page lacks.
      async ([target, ms]) => {
        const from = window.scrollY;
        const begin = performance.now();
        for (let u = 0; u < 1;) {
          const now = await new Promise<number>((next) => requestAnimationFrame(next));
          u = Math.min(1, (now - begin) / ms);
          const eased = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
          window.scrollTo({
            top: from + (Math.max(0, target) - from) * eased,
            behavior: "instant",
          });
        }
      },
      [top, duration] as const,
    );
    await this.page.waitForTimeout(120);
  }
}

/** Captures every repaint through the Chrome DevTools screencast, at full device resolution. */
async function startScreencast(page: Page, framesDir: string, maxWidth: number, maxHeight: number) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const start = Date.now() / 1000;
  const frames: Recording["frames"] = [];
  const writes: Promise<void>[] = [];
  cdp.on("Page.screencastFrame", (event) => {
    const file = `${String(frames.length).padStart(6, "0")}.jpg`;
    const t = Math.max(0, (event.metadata.timestamp ?? Date.now() / 1000) - start);
    frames.push({ file: `${FRAMES_DIR}/${file}`, t });
    writes.push(writeFile(join(framesDir, file), Buffer.from(event.data, "base64")));
    cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth, maxHeight });
  return {
    clock: () => Date.now() / 1000 - start,
    stop: async () => {
      await cdp.send("Page.stopScreencast").catch(() => undefined);
      await Promise.all(writes);
      return frames;
    },
  };
}

export async function record(
  script: LoadedScript,
  outDir: string,
  log: Logger,
): Promise<Recording> {
  const server = script.serve ? await serveFolder(script.serve) : undefined;
  const baseUrl = server?.url ?? script.baseUrl;
  if (server) log.debug(`serving ${script.serve ?? ""} at ${server.url}`);
  const browser = await launchBrowser();
  try {
    const { width, height, scale } = script.viewport;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
      isMobile: true,
      hasTouch: true,
      locale: "en-US",
    });
    await context.addInitScript({
      content: pointerScript({ color: script.brand.colors.accent, hide: script.hide }),
    });
    const page = await context.newPage();
    page.on("dialog", (dialog) => void dialog.accept().catch(() => undefined));
    const runner = new StepRunner(page, baseUrl);

    // Load the first page before the clock starts, so the reel never opens on a blank screen.
    const [first] = script.steps;
    const offset = first?.action === "goto" ? 1 : 0;
    if (first && offset === 1) await runner.run(first);

    const framesDir = join(outDir, FRAMES_DIR);
    rmSync(framesDir, { recursive: true, force: true });
    mkdirSync(framesDir, { recursive: true });
    const screencast = await startScreencast(page, framesDir, width * scale, height * scale);
    const scenes: Recording["scenes"] = [];
    const ramps: Recording["ramps"] = [];

    for (const [index, step] of script.steps.slice(offset).entries()) {
      const label = `step ${index + 1 + offset}: ${describeStep(step)}`;
      const start = screencast.clock();
      if (step.action === "caption") {
        scenes.push({ t: start, title: step.title, subtitle: step.subtitle });
      }
      try {
        await runner.run(step);
      } catch (error) {
        const reason = (error as Error).message.split("\n")[0] ?? "";
        if (step.optional) {
          log.warn(`${label} skipped (optional): ${reason}`);
          continue;
        }
        const shot = join(outDir, "failed-step.png");
        await page.screenshot({ path: shot }).catch(() => undefined);
        throw new UserError(
          `${label} failed: ${reason}`,
          `check the selector against the page (screenshot: ${shot}), or mark the step optional: true`,
        );
      }
      const end = screencast.clock();
      log.debug(`${label} (${(end - start).toFixed(2)}s)`);
      if (step.speed !== undefined) ramps.push({ start, end, factor: step.speed });
      if (step.fit !== undefined && end - start > step.fit * 1.05) {
        ramps.push({ start, end, factor: (end - start) / step.fit });
      }
    }

    await page.waitForTimeout(TAIL_MS);
    const duration = screencast.clock();
    const frames = await screencast.stop();
    if (frames.length === 0) {
      throw new UserError("the screencast produced no frames", "run again with --verbose");
    }
    const recording: Recording = {
      version: 1,
      viewport: script.viewport,
      duration,
      frames,
      scenes,
      ramps,
    };
    writeFileSync(join(outDir, RECORDING_FILE), JSON.stringify(recording, null, 1));
    return recording;
  } finally {
    await browser.close();
    await server?.close();
  }
}
