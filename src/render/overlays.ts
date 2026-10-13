import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Page } from "playwright";
import { ExitCode, UserError } from "../errors.js";
import type { Brand, Card } from "../script/schema.js";
import type { SlideFrom } from "./graph.js";
import { CANVAS, SAFE_ZONE, type Layout, type Rect } from "./layout.js";
import type { SceneWindow } from "./timeline.js";

/**
 * Every piece of text and chrome is drawn as HTML in Chromium and saved as a transparent PNG.
 * That gives real fonts, kerning and emoji, which ffmpeg's drawtext cannot match, and lets
 * text shrink to fit its box instead of overflowing.
 */

export interface Block {
  file: string;
  height: number;
  from: SlideFrom;
}

export interface CardImages {
  background: string;
  blocks: Block[];
}

export interface OverlaySet {
  background: string;
  bezel: string;
  guides: string;
  captions: { title: string; subtitle?: string | undefined }[];
  hook: CardImages;
  outro: CardImages;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

function dataUri(file: string): string {
  const ext = extname(file).slice(1).toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}

/** Title lines joined with <br>; with two or more lines the last one takes the accent color. */
function titleHtml(lines: readonly string[], accent: string): string {
  return lines
    .map((line, index) =>
      lines.length > 1 && index === lines.length - 1
        ? `<span style="color:${accent}">${escapeHtml(line)}</span>`
        : escapeHtml(line),
    )
    .join("<br>");
}

const box = (rect: Rect): string =>
  `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;

class Painter {
  private count = 0;

  constructor(
    private readonly page: Page,
    private readonly dir: string,
    private readonly brand: Brand,
  ) {}

  private document(body: string): string {
    const { font } = this.brand;
    const face = font.file
      ? `@font-face{font-family:"${font.family}";src:url(${dataUri(font.file)})}`
      : "";
    return `<!doctype html><html><head><meta charset="utf-8"><style>${face}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{background:transparent;width:${CANVAS.width}px}
      body{font-family:"${font.family}",system-ui,"Segoe UI",Helvetica,Arial,sans-serif;
        -webkit-font-smoothing:antialiased}
      [data-fit]{overflow:hidden}
      </style></head><body>${body}</body></html>`;
  }

  /**
   * Renders `#root` to a PNG, shrinking every [data-fit] element until its text fits its width,
   * and its height too when the element has a fixed one (auto-height blocks only grow).
   */
  async paint(name: string, body: string): Promise<{ file: string; height: number }> {
    await this.page.setContent(this.document(body), { waitUntil: "load" });
    await this.page.evaluate(async () => {
      await document.fonts.ready;
      for (const element of document.querySelectorAll<HTMLElement>("[data-fit]")) {
        const fixedHeight = element.style.height !== "";
        let size = parseFloat(getComputedStyle(element).fontSize);
        while (
          size > 14 &&
          (element.scrollWidth > element.clientWidth ||
            (fixedHeight && element.scrollHeight > element.clientHeight))
        ) {
          size -= 2;
          element.style.fontSize = `${size}px`;
        }
      }
    });
    const root = this.page.locator("#root");
    const file = join(this.dir, `${String(this.count++).padStart(2, "0")}-${name}.png`);
    await root.screenshot({ path: file, omitBackground: true });
    const bounds = await root.boundingBox();
    return { file, height: Math.round(bounds?.height ?? 0) };
  }

  brandRow(rect: Rect, color: string): string {
    const { name, logo } = this.brand;
    const image = logo
      ? `<img src="${dataUri(logo)}" style="height:${rect.height}px;width:auto;border-radius:14px">`
      : "";
    return `<div style="${box(rect)};display:flex;align-items:center;gap:18px;color:${color};
      font-weight:800;font-size:40px;letter-spacing:-.02em">${image}<span>${escapeHtml(name)}</span></div>`;
  }
}

const canvas = (inner: string, background = "transparent"): string =>
  `<div id="root" style="position:relative;width:${CANVAS.width}px;height:${CANVAS.height}px;
    overflow:hidden;background:${background}">${inner}</div>`;

async function paintCard(
  painter: Painter,
  key: "hook" | "outro",
  card: Card,
  brand: Brand,
): Promise<CardImages> {
  const { colors } = brand;
  const decor = `
    <div style="position:absolute;right:-260px;bottom:-200px;width:900px;height:900px;border-radius:50%;
      background:${colors.accent};opacity:.16"></div>
    <div style="position:absolute;left:${SAFE_ZONE.x}px;top:388px;width:120px;height:10px;border-radius:5px;
      background:${colors.accent}"></div>`;
  const background = await painter.paint(
    `${key}-background`,
    canvas(
      decor + painter.brandRow({ ...SAFE_ZONE, height: 64, y: 232 }, colors.cardText),
      colors.card,
    ),
  );

  const row = (inner: string): string =>
    `<div id="root" style="width:${CANVAS.width}px;padding:0 ${SAFE_ZONE.x}px">${inner}</div>`;
  const parts: { name: string; html: string; from: SlideFrom }[] = [];
  if (card.kicker) {
    parts.push({
      name: "kicker",
      from: "top",
      html: row(`<span style="display:inline-block;padding:12px 26px;border-radius:99px;
        border:3px solid ${colors.cardText};color:${colors.cardText};font-weight:700;font-size:30px;
        letter-spacing:.14em;text-transform:uppercase">${escapeHtml(card.kicker)}</span>`),
    });
  }
  parts.push({
    name: "title",
    from: "left",
    html: row(`<div data-fit style="width:${SAFE_ZONE.width}px;white-space:nowrap;font-weight:800;
      font-size:124px;line-height:1.04;letter-spacing:-.045em;color:${colors.cardText};padding:8px 0 14px">
      ${titleHtml(card.title, colors.accent)}</div>`),
  });
  if (card.subtitle) {
    parts.push({
      name: "subtitle",
      from: "right",
      html: row(`<div style="width:${SAFE_ZONE.width - 60}px;font-weight:600;font-size:40px;
        line-height:1.3;color:${colors.cardText};opacity:.85">${escapeHtml(card.subtitle)}</div>`),
    });
  }
  if (card.cta) {
    parts.push({
      name: "cta",
      from: "left",
      html: row(`<span data-fit style="display:inline-block;max-width:${SAFE_ZONE.width}px;
        white-space:nowrap;padding:22px 40px;border-radius:26px;background:${colors.accent};
        color:${colors.background};font-weight:800;font-size:52px">${escapeHtml(card.cta)}</span>`),
    });
  }

  const blocks: Block[] = [];
  for (const part of parts) {
    blocks.push({ ...(await painter.paint(`${key}-${part.name}`, part.html)), from: part.from });
  }
  return { background: background.file, blocks };
}

export async function renderOverlays(options: {
  dir: string;
  brand: Brand;
  layout: Layout;
  scenes: readonly SceneWindow[];
  hook: Card;
  outro: Card;
}): Promise<OverlaySet> {
  const { dir, brand, layout } = options;
  const { colors } = brand;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch().catch((error: unknown) => {
    throw new UserError(
      `could not start Chromium: ${(error as Error).message.split("\n")[0] ?? ""}`,
      "install the browser once with `npx playwright install chromium`",
      ExitCode.MissingDependency,
    );
  });
  try {
    const page = await browser.newPage({
      viewport: { width: CANVAS.width, height: CANVAS.height },
    });
    const painter = new Painter(page, dir, brand);
    const { screen, bezel, radius } = layout;
    const frame: Rect = {
      x: screen.x - bezel,
      y: screen.y - bezel,
      width: screen.width + 2 * bezel,
      height: screen.height + 2 * bezel,
    };

    const background = await painter.paint(
      "background",
      canvas(
        `<div style="position:absolute;inset:0;background:radial-gradient(circle at 80% 18%,
          ${colors.accent}40,transparent 55%)"></div>
        ${painter.brandRow(layout.brand, colors.text)}
        <div style="${box(frame)};border-radius:${radius + bezel}px;background:${colors.frame};
          box-shadow:0 40px 90px rgba(0,0,0,.45)"></div>`,
        colors.background,
      ),
    );
    const bezelImage = await painter.paint(
      "bezel",
      canvas(`<div style="${box(frame)};border-radius:${radius + bezel}px;
        border:${bezel}px solid ${colors.frame}"></div>`),
    );
    const guides = await painter.paint(
      "guides",
      canvas(`<div style="${box(SAFE_ZONE)};outline:3px dashed rgba(255,255,255,.8);
        box-shadow:0 0 0 4000px rgba(255,40,40,.32)"></div>`),
    );

    const captions: OverlaySet["captions"] = [];
    for (const [index, scene] of options.scenes.entries()) {
      const strip = (rect: Rect, style: string, content: string): string =>
        `<div id="root" style="position:relative;width:${CANVAS.width}px;height:${rect.height}px">
          <div data-fit style="position:absolute;left:${rect.x}px;top:0;width:${rect.width}px;
            height:${rect.height}px;color:${colors.text};text-shadow:0 4px 24px rgba(0,0,0,.3);
            ${style}">${content}</div></div>`;
      const title = await painter.paint(
        `scene${index}-title`,
        strip(
          layout.captionTitle,
          "white-space:nowrap;font-weight:800;font-size:80px;line-height:1.05;letter-spacing:-.035em;padding-top:4px",
          titleHtml(scene.title, colors.accent),
        ),
      );
      const subtitle =
        scene.subtitle === undefined
          ? undefined
          : await painter.paint(
              `scene${index}-subtitle`,
              strip(
                layout.captionSubtitle,
                "font-weight:600;font-size:32px;line-height:1.3;opacity:.92",
                escapeHtml(scene.subtitle),
              ),
            );
      captions.push({ title: title.file, subtitle: subtitle?.file });
    }

    return {
      background: background.file,
      bezel: bezelImage.file,
      guides: guides.file,
      captions,
      hook: await paintCard(painter, "hook", options.hook, brand),
      outro: await paintCard(painter, "outro", options.outro, brand),
    };
  } finally {
    await browser.close();
  }
}
