import { z } from "zod";

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "expected a hex color such as #ff7a59");
const selector = z.string().min(1, "selector must not be empty");
const millis = z.number().int().min(0);
const titleLines = z
  .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(3)])
  .transform((value) => (typeof value === "string" ? [value] : value));

export const brandSchema = z.strictObject({
  name: z.string().default(""),
  logo: z.string().optional(),
  colors: z
    .strictObject({
      background: hexColor.default("#16161d"),
      accent: hexColor.default("#7c5cff"),
      text: hexColor.default("#ffffff"),
      frame: hexColor.default("#05050a"),
      card: hexColor.default("#f4f2ff"),
      cardText: hexColor.default("#16161d"),
    })
    .prefault({}),
  font: z
    .strictObject({
      family: z.string().min(1).default("Inter"),
      file: z.string().optional(),
    })
    .prefault({}),
});

export type Brand = z.output<typeof brandSchema>;

/** Each action maps its YAML value (shorthand or full form) to one normalized shape. */
const actionSchemas = {
  goto: z
    .string()
    .min(1)
    .transform((url) => ({ action: "goto" as const, url })),
  click: z
    .union([selector, z.strictObject({ selector, pause: millis.default(150) })])
    .transform((value) =>
      typeof value === "string"
        ? { action: "click" as const, selector: value, pause: 150 }
        : { action: "click" as const, ...value },
    ),
  type: z
    .strictObject({ selector, text: z.string(), delay: millis.default(55) })
    .transform((value) => ({ action: "type" as const, ...value })),
  scroll: z
    .union([
      z.number().min(0),
      selector,
      z.strictObject({ to: z.union([z.number().min(0), selector]), duration: millis.default(900) }),
    ])
    .transform((value) =>
      typeof value === "object"
        ? { action: "scroll" as const, ...value }
        : { action: "scroll" as const, to: value, duration: 900 },
    ),
  wait: millis.transform((ms) => ({ action: "wait" as const, ms })),
  waitFor: z
    .union([selector, z.strictObject({ selector, timeout: millis.default(15000) })])
    .transform((value) =>
      typeof value === "string"
        ? { action: "waitFor" as const, selector: value, timeout: 15000 }
        : { action: "waitFor" as const, ...value },
    ),
  caption: z
    .union([
      z.string().min(1),
      z.strictObject({ title: titleLines, subtitle: z.string().optional() }),
    ])
    .transform((value) =>
      typeof value === "string"
        ? { action: "caption" as const, title: [value] }
        : { action: "caption" as const, ...value },
    ),
};

export type ActionName = keyof typeof actionSchemas;
const ACTION_NAMES = Object.keys(actionSchemas) as ActionName[];

const timingSchema = z
  .strictObject({
    speed: z.number().gt(1).max(50).optional(),
    fit: z.number().positive().optional(),
    optional: z.boolean().default(false),
  })
  .refine((timing) => timing.speed === undefined || timing.fit === undefined, {
    message: "use either speed or fit on a step, not both",
  });

const TIMING_KEYS = new Set(["speed", "fit", "optional"]);

export type Timing = z.output<typeof timingSchema>;
export type Step = z.output<(typeof actionSchemas)[ActionName]> & Timing;

const isAction = (name: string): name is ActionName => name in actionSchemas;

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function suggestAction(name: string): string {
  const close = ACTION_NAMES.find((candidate) => editDistance(name, candidate) <= 2);
  return close ? ` Did you mean "${close}"?` : "";
}

/**
 * A step is a mapping with exactly one action key plus optional timing keys:
 *   - click: "#save"
 *     optional: true
 * Parsed by hand so errors name the action instead of listing every union branch.
 */
export const stepSchema = z.unknown().transform((raw, ctx): Step => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    ctx.addIssue({
      code: "custom",
      message: `a step must be a mapping such as { click: "#save" }; actions: ${ACTION_NAMES.join(", ")}`,
    });
    return z.NEVER;
  }
  const entries = Object.entries(raw);
  const actionKeys = entries.filter(([key]) => !TIMING_KEYS.has(key)).map(([key]) => key);
  const [name] = actionKeys;
  if (name === undefined || actionKeys.length > 1) {
    ctx.addIssue({
      code: "custom",
      message:
        name === undefined
          ? `a step needs one action: ${ACTION_NAMES.join(", ")}`
          : `a step takes exactly one action, found ${actionKeys.join(" and ")}`,
    });
    return z.NEVER;
  }
  if (!isAction(name)) {
    ctx.addIssue({
      code: "custom",
      path: [name],
      message: `unknown action "${name}".${suggestAction(name)} Actions: ${ACTION_NAMES.join(", ")}`,
    });
    return z.NEVER;
  }

  const action = actionSchemas[name].safeParse((raw as Record<string, unknown>)[name]);
  const timing = timingSchema.safeParse(
    Object.fromEntries(entries.filter(([key]) => TIMING_KEYS.has(key))),
  );
  for (const issue of action.error?.issues ?? []) {
    ctx.addIssue({ code: "custom", path: [name, ...issue.path], message: issue.message });
  }
  for (const issue of timing.error?.issues ?? []) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
  if (!action.success || !timing.success) return z.NEVER;
  return { ...action.data, ...timing.data };
});

const cardSchema = z.strictObject({
  kicker: z.string().optional(),
  title: titleLines,
  subtitle: z.string().optional(),
  cta: z.string().optional(),
  duration: z.number().min(0.6).max(8).optional(),
});

export type Card = z.output<typeof cardSchema>;

export const scriptSchema = z
  .strictObject({
    name: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/i, "use letters, digits and dashes")
      .optional(),
    baseUrl: z.url().optional(),
    serve: z.string().optional(),
    brand: z.union([z.string(), brandSchema]).optional(),
    viewport: z
      .strictObject({
        width: z.number().int().min(240).max(1024).default(390),
        height: z.number().int().min(400).max(2048).default(844),
        scale: z.number().min(1).max(4).default(2),
      })
      .prefault({}),
    hide: z.array(selector).default([]),
    rate: z.number().min(0.5).max(3).default(1),
    music: z
      .strictObject({
        file: z.string(),
        volume: z.number().min(0).max(2).default(0.6),
        start: z.number().min(0).default(0),
      })
      .optional(),
    hook: cardSchema,
    outro: cardSchema,
    steps: z.array(stepSchema).min(1),
  })
  .superRefine((script, ctx) => {
    if (script.baseUrl && script.serve) {
      ctx.addIssue({ code: "custom", path: ["serve"], message: "use baseUrl or serve, not both" });
    }
    const needsBase = script.steps.some(
      (step) => step.action === "goto" && !/^https?:\/\//.test(step.url),
    );
    if (needsBase && !script.baseUrl && !script.serve) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "relative goto URLs need baseUrl or serve",
      });
    }
  });

export type Script = z.output<typeof scriptSchema>;
