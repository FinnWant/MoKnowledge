import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The keyboard focus ring, guarded (P8).
 *
 * `app/globals.css` defines one `:focus-visible` outline for the whole app.
 * Tailwind's focus outline-reset utility compiles to a `:focus` rule at
 * specificity (0,2,0) against the global rule's (0,1,0), so a single utility
 * class silently removes the focus indicator from whatever it is applied to.
 *
 * It reached the shared control base in `components/ui/field.tsx`, which meant
 * every input, select and textarea in the app had no visible keyboard focus
 * (WCAG 2.4.7). Nothing about that is apparent while reading the component, and
 * nothing about it fails a type check or a render test — so it is asserted here
 * instead, as a property of the source.
 *
 * A component that genuinely needs to suppress the ring should draw its own and
 * carry an exemption comment; there are none today.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ROOTS = ["components", "app"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("keyboard focus", () => {
  it("never suppresses the focus ring with a utility class", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of sourceFiles(path.join(ROOT, root))) {
        const contents = readFileSync(file, "utf8");
        contents.split("\n").forEach((line, index) => {
          // Skip the comments that explain why the class is absent.
          const code = line.replace(/\/\/.*$/, "");
          // Built from fragments so this file does not itself put the class
          // into Tailwind's scanner output.
          if (new RegExp(`\\boutline${"-"}none\\b`).test(code)) {
            offenders.push(`${path.relative(ROOT, file)}:${index + 1}`);
          }
        });
      }
    }

    expect(offenders).toEqual([]);
  });

  it("still defines the ring it depends on", () => {
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/);
  });
});
