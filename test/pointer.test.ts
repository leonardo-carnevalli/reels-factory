import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { pointerScript } from "../src/record/pointer.js";

describe("pointerScript", () => {
  const source = pointerScript({ color: "#ff7a59", hide: ["#cookie", ".banner"] });

  it("compiles as JavaScript", () => {
    expect(() => new Script(source)).not.toThrow();
  });

  it("injects the brand color and hides the given selectors", () => {
    expect(source).toContain('const color = "#ff7a59"');
    expect(source).toContain("#cookie{display:none!important}.banner{display:none!important}");
  });

  it("escapes selectors that contain quotes", () => {
    const tricky = pointerScript({ color: "#000", hide: ['[data-x="y"]'] });
    expect(() => new Script(tricky)).not.toThrow();
  });
});
