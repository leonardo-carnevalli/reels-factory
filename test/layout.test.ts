import { describe, expect, it } from "vitest";
import { CANVAS, computeLayout, isInside, SAFE_ZONE, stackBlocks } from "../src/render/layout.js";

describe("computeLayout", () => {
  const layout = computeLayout({ width: 390, height: 844 });

  it("keeps every caption inside the platform safe zone", () => {
    expect(isInside(layout.brand)).toBe(true);
    expect(isInside(layout.captionTitle)).toBe(true);
    expect(isInside(layout.captionSubtitle)).toBe(true);
  });

  it("places the screen below the captions and inside the canvas", () => {
    const { screen, bezel, captionSubtitle } = layout;
    expect(screen.y).toBeGreaterThan(captionSubtitle.y + captionSubtitle.height);
    expect(screen.y + screen.height + bezel).toBeLessThanOrEqual(CANVAS.height);
    expect(screen.x * 2 + screen.width).toBe(CANVAS.width);
  });

  it("keeps the recorded aspect ratio with even dimensions for H.264", () => {
    const { screen } = layout;
    expect(screen.width % 2).toBe(0);
    expect(screen.height % 2).toBe(0);
    expect(screen.width / screen.height).toBeCloseTo(390 / 844, 2);
  });

  it("caps the width of wide viewports", () => {
    expect(computeLayout({ width: 800, height: 800 }).screen.width).toBeLessThanOrEqual(640);
  });
});

describe("stackBlocks", () => {
  it("stacks blocks with a gap", () => {
    expect(stackBlocks([100, 50, 20], 400, 10)).toEqual([400, 510, 570]);
  });
});

describe("isInside", () => {
  it("detects a rect leaving the safe zone", () => {
    expect(isInside(SAFE_ZONE)).toBe(true);
    expect(isInside({ ...SAFE_ZONE, x: SAFE_ZONE.x + 1 })).toBe(false);
  });
});
