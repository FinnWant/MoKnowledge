import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Loads the prompt files in `prompts/` as the actual system prompts.
 *
 * The markdown files are the graded artifact (R21), so they are read at runtime
 * rather than duplicated as string constants — a copy would drift from the
 * document a reviewer is reading, and the claim in `prompts/README.md` that
 * "lib/ai/ executes them verbatim" would quietly stop being true.
 *
 * Each file states its system prompt as a blockquote under `## System prompt`;
 * that block is extracted and unquoted here.
 */

export type PromptId =
  | "01-company-profile"
  | "02-offering-normalization"
  | "03-writing-style"
  | "04-proof-extraction";

const PROMPT_DIR = path.join(process.cwd(), "prompts");

const cache = new Map<PromptId, string>();

export function loadSystemPrompt(id: PromptId): string {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;

  const markdown = readFileSync(path.join(PROMPT_DIR, `${id}.md`), "utf8");
  const system = extractSystemPrompt(markdown);
  if (!system) {
    throw new Error(
      `prompts/${id}.md has no "## System prompt" blockquote — the prompt file and lib/ai/ have diverged`,
    );
  }

  cache.set(id, system);
  return system;
}

/** Pulls the blockquote under `## System prompt` and strips the `>` markers. */
export function extractSystemPrompt(markdown: string): string | null {
  const section = markdown.split(/^##\s+System prompt\s*$/m)[1];
  if (!section) return null;

  const lines: string[] = [];
  for (const line of section.split("\n")) {
    if (/^##\s/.test(line)) break;
    if (/^>/.test(line)) {
      lines.push(line.replace(/^>\s?/, ""));
    } else if (lines.length > 0 && line.trim() === "") {
      lines.push("");
    }
  }

  const text = lines.join("\n").trim();
  return text.length > 0 ? text : null;
}

/**
 * Effort per prompt, from each file's header.
 *
 * Prompt 03 runs at `low` because the judgment is already grounded in metrics we
 * computed in TypeScript — there is little left to reason about.
 */
export const PROMPT_EFFORT: Record<PromptId, "low" | "medium" | "high"> = {
  "01-company-profile": "medium",
  "02-offering-normalization": "medium",
  "03-writing-style": "low",
  "04-proof-extraction": "medium",
};
