export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const CANVAS = { width: 1080, height: 1920 } as const;
export const FPS = 30;

/**
 * The part of a 1080x1920 frame that Instagram Reels and TikTok leave uncovered: below the
 * top bar, above the caption and account row, left of the like/comment/share column.
 * All text is placed inside it. The screen recording may run underneath the UI, text never does.
 */
export const SAFE_ZONE: Rect = { x: 60, y: 220, width: 900, height: 1280 };

const BRAND_ROW: Rect = { x: SAFE_ZONE.x, y: 232, width: SAFE_ZONE.width, height: 64 };
const CAPTION_TITLE: Rect = { x: SAFE_ZONE.x, y: 312, width: SAFE_ZONE.width - 60, height: 180 };
const CAPTION_SUBTITLE: Rect = { x: SAFE_ZONE.x, y: 500, width: SAFE_ZONE.width - 60, height: 92 };
const SCREEN_TOP = 620;
const SCREEN_MAX_WIDTH = 640;
const BOTTOM_MARGIN = 44;

export interface Layout {
  brand: Rect;
  captionTitle: Rect;
  captionSubtitle: Rect;
  screen: Rect;
  /** Phone frame thickness around the screen, in px. */
  bezel: number;
  radius: number;
}

const even = (value: number): number => 2 * Math.floor(value / 2);

/** Fits the recorded viewport under the captions, centered, keeping its aspect ratio. */
export function computeLayout(viewport: { width: number; height: number }): Layout {
  const aspect = viewport.width / viewport.height;
  const maxHeight = CANVAS.height - SCREEN_TOP - BOTTOM_MARGIN;
  const width = even(Math.min(SCREEN_MAX_WIDTH, maxHeight * aspect));
  const height = even(width / aspect);
  return {
    brand: BRAND_ROW,
    captionTitle: CAPTION_TITLE,
    captionSubtitle: CAPTION_SUBTITLE,
    screen: { x: even((CANVAS.width - width) / 2), y: SCREEN_TOP, width, height },
    bezel: 18,
    radius: 46,
  };
}

/** Vertical positions for intro/outro blocks stacked from `top` with a fixed gap. */
export function stackBlocks(heights: readonly number[], top = 420, gap = 36): number[] {
  const positions: number[] = [];
  let y = top;
  for (const height of heights) {
    positions.push(y);
    y += height + gap;
  }
  return positions;
}

export function isInside(rect: Rect, zone: Rect = SAFE_ZONE): boolean {
  return (
    rect.x >= zone.x &&
    rect.y >= zone.y &&
    rect.x + rect.width <= zone.x + zone.width &&
    rect.y + rect.height <= zone.y + zone.height
  );
}
