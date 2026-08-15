import { AlertTriangle, Calculator, Globe, Pencil, Search, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui";
import type { ExtractionMethod } from "@/lib/schema";

type Presentation = {
  label: string;
  tone: BadgeTone;
  icon: ReactNode;
  /** Popover/tooltip text. Plain language — no "provenance", no confidence number. */
  detail: string;
};

const ICON = "size-3";

/**
 * The user-facing vocabulary from docs/EDIT-UX.md §5. Nothing in the UI ever
 * shows a `method` string or a confidence number: a non-technical SMB owner
 * cannot act on `derived` or on `0.73`.
 */
const PRESENTATION: Record<ExtractionMethod, Presentation> = {
  scraped: {
    label: "From website",
    tone: "neutral",
    icon: <Globe className={ICON} aria-hidden="true" />,
    detail: "Copied from a page on your website.",
  },
  derived: {
    label: "Calculated",
    tone: "neutral",
    icon: <Calculator className={ICON} aria-hidden="true" />,
    detail: "Worked out from your website rather than copied from it.",
  },
  "ai-live": {
    label: "AI draft",
    tone: "info",
    icon: <Sparkles className={ICON} aria-hidden="true" />,
    detail: "Written by AI from what we found on your site. Please check it.",
  },
  // Deliberately louder than `ai-live`. The assignment requires mock outputs be
  // clearly labelled, and two AI states that look alike would not satisfy that.
  "ai-mock": {
    label: "AI sample",
    tone: "warn",
    icon: <AlertTriangle className={ICON} aria-hidden="true" />,
    detail:
      "Placeholder example, not real AI output. Add an API key to generate this for real.",
  },
  "user-edited": {
    label: "You edited",
    tone: "success",
    icon: <Pencil className={ICON} aria-hidden="true" />,
    detail: "Changed by you.",
  },
  "not-found": {
    label: "Not found",
    tone: "muted",
    icon: <Search className={ICON} aria-hidden="true" />,
    detail: "We looked for this and couldn't find it on your website.",
  },
};

/**
 * The methods in display order. Derived from the presentation table rather than
 * from `extractionMethodSchema.options`, so client components can enumerate them
 * without pulling zod and the whole schema into the browser bundle.
 */
export const PROVENANCE_METHODS = Object.keys(
  PRESENTATION,
) as ExtractionMethod[];

export function provenanceLabel(method: ExtractionMethod): string {
  return PRESENTATION[method].label;
}

export function ProvenanceBadge({ method }: { method: ExtractionMethod }) {
  const { label, tone, icon, detail } = PRESENTATION[method];
  return (
    <Badge tone={tone} icon={icon} title={detail}>
      {label}
    </Badge>
  );
}
