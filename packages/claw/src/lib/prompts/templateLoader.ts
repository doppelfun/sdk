/**
 * Load prompt text from .md template files and substitute {{variable}} placeholders.
 * Templates live in templates/ next to this module; build script copies them to dist.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "templates");

/** Replace {{key}} in template with values from vars. Keys are trimmed; missing vars become "". */
export function replaceVars(
  template: string,
  vars: Record<string, string | number | undefined | null>
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v !== undefined && v !== null ? String(v) : "";
  });
}

/**
 * Load a template by name (no extension). Throws if the file is missing.
 */
export function loadTemplate(name: string): string {
  const filePath = path.join(TEMPLATES_DIR, `${name}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Missing prompt template: ${filePath} (run 'pnpm build' to copy templates)`);
  }
  return readFileSync(filePath, "utf-8").trim();
}
