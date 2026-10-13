import { describe, expect, it } from "vitest";
import { formatIssues } from "../src/script/load.js";
import { brandSchema, scriptSchema, stepSchema } from "../src/script/schema.js";

const minimal = {
  baseUrl: "https://example.com",
  hook: { title: "Hello" },
  outro: { title: ["Bye", "now"] },
  steps: [{ goto: "/" }],
};

function errorsOf(schema: typeof stepSchema | typeof scriptSchema, input: unknown): string {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected a validation error");
  return formatIssues(result.error.issues);
}

describe("stepSchema", () => {
  it("expands shorthands into one normalized shape", () => {
    expect(stepSchema.parse({ click: "#save" })).toEqual({
      action: "click",
      selector: "#save",
      pause: 150,
      optional: false,
    });
    expect(stepSchema.parse({ scroll: 400 })).toMatchObject({ to: 400, duration: 900 });
    expect(stepSchema.parse({ caption: "One line" })).toMatchObject({ title: ["One line"] });
    expect(stepSchema.parse({ waitFor: "#done" })).toMatchObject({ timeout: 15000 });
  });

  it("keeps timing keys next to the action", () => {
    expect(stepSchema.parse({ waitFor: "#done", fit: 1, optional: true })).toMatchObject({
      action: "waitFor",
      fit: 1,
      optional: true,
    });
  });

  it("suggests the closest action for a typo", () => {
    expect(errorsOf(stepSchema, { clik: "#save" })).toContain(
      'unknown action "clik". Did you mean "click"?',
    );
  });

  it("rejects two actions in one step", () => {
    expect(errorsOf(stepSchema, { click: "#a", wait: 100 })).toContain(
      "exactly one action, found click and wait",
    );
  });

  it("rejects a bare string with an example of the right form", () => {
    expect(errorsOf(stepSchema, "click")).toContain('{ click: "#save" }');
  });

  it("points at the nested field that is wrong", () => {
    expect(errorsOf(stepSchema, { type: { selector: "#q" } })).toMatch(/type\.text: /);
  });

  it("refuses speed and fit together", () => {
    expect(errorsOf(stepSchema, { wait: 1000, speed: 2, fit: 1 })).toContain("speed or fit");
  });
});

describe("scriptSchema", () => {
  const withoutBase = { ...minimal, baseUrl: undefined };

  it("fills defaults for viewport, rate and hide", () => {
    const script = scriptSchema.parse(minimal);
    expect(script.viewport).toEqual({ width: 390, height: 844, scale: 2 });
    expect(script.rate).toBe(1);
    expect(script.hide).toEqual([]);
  });

  it("requires a base URL for relative goto steps", () => {
    expect(errorsOf(scriptSchema, withoutBase)).toContain(
      "baseUrl: relative goto URLs need baseUrl or serve",
    );
  });

  it("accepts absolute URLs without a base", () => {
    const script = { ...withoutBase, steps: [{ goto: "https://example.com" }] };
    expect(scriptSchema.safeParse(script).success).toBe(true);
  });

  it("reports the index of a broken step", () => {
    const script = { ...minimal, steps: [{ goto: "/" }, { wait: -5 }] };
    expect(errorsOf(scriptSchema, script)).toMatch(/steps\[1\]\.wait: /);
  });

  it("rejects unknown top-level keys", () => {
    expect(errorsOf(scriptSchema, { ...minimal, colour: "red" })).toContain("colour");
  });
});

describe("brandSchema", () => {
  it("gives a complete neutral brand from nothing", () => {
    const brand = brandSchema.parse({});
    expect(Object.keys(brand.colors)).toHaveLength(6);
    expect(brand.font.family).toBe("Inter");
  });

  it("rejects colors that are not hex", () => {
    expect(brandSchema.safeParse({ colors: { accent: "orange" } }).success).toBe(false);
  });
});
