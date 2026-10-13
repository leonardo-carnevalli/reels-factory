import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { ExitCode, UserError } from "../errors.js";
import { brandSchema, scriptSchema, type Brand, type Script } from "./schema.js";

export interface LoadedScript extends Omit<Script, "brand" | "name"> {
  name: string;
  /** Absolute path of the script file; relative paths inside it resolve from its folder. */
  file: string;
  brand: Brand;
}

/** Turns zod issues into one line each, with a readable path such as steps[2].click. */
export function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path
        .map((part, index) =>
          typeof part === "number" ? `[${part}]` : `${index === 0 ? "" : "."}${String(part)}`,
        )
        .join("");
      return `  ${path || "(root)"}: ${issue.message}`;
    })
    .join("\n");
}

function readStructured(file: string, what: string): unknown {
  if (!existsSync(file)) {
    throw new UserError(
      `${what} not found: ${file}`,
      "check the path; relative paths resolve from the script's folder",
      ExitCode.Usage,
    );
  }
  try {
    return parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    throw new UserError(
      `${what} is not valid YAML or JSON: ${file}\n  ${(error as Error).message}`,
      "fix the syntax error above",
      ExitCode.Usage,
    );
  }
}

function validate<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new UserError(
      `invalid ${file}\n${formatIssues(result.error.issues)}`,
      "see the script format in the README (section 'Script reference')",
      ExitCode.Usage,
    );
  }
  return result.data;
}

/** Makes every file path inside a brand absolute, relative to the folder it was declared in. */
function resolveBrand(brand: Brand, from: string): Brand {
  return {
    ...brand,
    logo: brand.logo === undefined ? undefined : resolve(from, brand.logo),
    font: {
      ...brand.font,
      file: brand.font.file === undefined ? undefined : resolve(from, brand.font.file),
    },
  };
}

export function loadScript(path: string): LoadedScript {
  const file = resolve(path);
  const dir = dirname(file);
  const script = validate(scriptSchema, readStructured(file, "script"), relative(".", file));

  let brand: Brand;
  if (typeof script.brand === "string") {
    const brandFile = resolve(dir, script.brand);
    brand = resolveBrand(
      validate(brandSchema, readStructured(brandFile, "brand file"), relative(".", brandFile)),
      dirname(brandFile),
    );
  } else {
    brand = resolveBrand(script.brand ?? brandSchema.parse({}), dir);
  }

  for (const [label, asset] of [
    ["logo", brand.logo],
    ["font file", brand.font.file],
    ["music file", script.music && resolve(dir, script.music.file)],
    ["serve folder", script.serve && resolve(dir, script.serve)],
  ] as const) {
    if (asset !== undefined && !existsSync(asset)) {
      throw new UserError(
        `${label} not found: ${asset}`,
        "fix the path in the script or brand file",
      );
    }
  }

  return {
    ...script,
    name: script.name ?? basename(file, extname(file)).replace(/\.reel$/, ""),
    file,
    brand,
    serve: script.serve && resolve(dir, script.serve),
    music: script.music && { ...script.music, file: resolve(dir, script.music.file) },
  };
}
