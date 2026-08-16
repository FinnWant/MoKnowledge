import {
  CATEGORY_ORDER,
  FIELD_META,
  MAX_FOLLOW_UP_QUESTIONS,
  SUBSTITUTABILITY_PENALTY,
  fieldMeta,
  needsReview,
  type CategoryId,
  type Conflict,
  type FieldMeta,
  type FollowUpQuestion,
  type KnowledgeBase,
  type Quality,
  type Sourced,
} from "@/lib/schema";
import { getPath } from "@/lib/utils/path";

/**
 * Completeness scoring and gap-to-question conversion — the `quality` category.
 *
 * Implements docs/DATA-QUALITY.md §§5–6. The two decisions that matter:
 *
 * - **Scores are impact-weighted, not fill rates.** "42% complete" reads as a
 *   broken scrape when the missing 58% is `revenue` and `employeeCount`, which
 *   appear in one of eight reference profiles each.
 * - **Questions are ranked by value per unit of effort,** so the first two clear
 *   the most ground. A question the customer abandons is worth nothing however
 *   important the field.
 */

/** True when a field has a real value. `[]` counts as empty. */
export function isFilled(field: Sourced<unknown> | undefined): boolean {
  if (!field) return false;
  if (field.value === null || field.value === undefined) return false;
  if (Array.isArray(field.value)) return field.value.length > 0;
  if (typeof field.value === "string") return field.value.trim().length > 0;
  return true;
}

function fieldOf(kb: KnowledgeBase, path: string): Sourced<unknown> | undefined {
  return getPath(kb, path) as Sourced<unknown> | undefined;
}

export function scoreCategory(kb: KnowledgeBase, category: CategoryId) {
  const fields = FIELD_META.filter((meta) => meta.category === category);

  let earned = 0;
  let possible = 0;
  let filledFields = 0;
  let attention = 0;

  for (const meta of fields) {
    const field = fieldOf(kb, meta.path);
    const filled = isFilled(field);
    if (filled) filledFields += 1;
    if (field && needsReview(field)) attention += 1;

    // Derived and external fields still count toward their category's score —
    // they are part of what a complete profile contains — but they are excluded
    // from the overall denominator, which is about what we can *ask* for.
    possible += meta.impact;
    if (filled) earned += meta.impact;
  }

  return {
    category,
    score: possible === 0 ? 0 : Number((earned / possible).toFixed(3)),
    filledFields,
    totalFields: fields.length,
    needsAttention: attention,
  };
}

export function scoreCompleteness(kb: KnowledgeBase) {
  const categoryScores = CATEGORY_ORDER.map((category) => scoreCategory(kb, category));

  // Overall uses only askable fields. Penalising a customer for not publishing
  // their own Flesch-Kincaid grade would be absurd (docs/DATA-QUALITY.md §5).
  let earned = 0;
  let possible = 0;
  for (const meta of FIELD_META) {
    if (!meta.askable) continue;
    possible += meta.impact;
    if (isFilled(fieldOf(kb, meta.path))) earned += meta.impact;
  }

  return {
    categoryScores,
    overallScore: possible === 0 ? 0 : Number((earned / possible).toFixed(3)),
  };
}

export function missingFields(kb: KnowledgeBase): string[] {
  return FIELD_META.filter((meta) => !isFilled(fieldOf(kb, meta.path))).map(
    (meta) => meta.path,
  );
}

/* --------------------------------------------------------------- questions */

type Ranked = { meta: FieldMeta; priority: number };

/**
 * Turns gaps into a short, ordered list of questions.
 *
 * A gap is askable when the customer plausibly knows the answer, the field is
 * genuinely empty (a low-confidence value is a *conflict to confirm*, which is
 * cheaper for the user and handled in the attention tier), and no sibling field
 * already covers it.
 */
export function buildFollowUpQuestions(kb: KnowledgeBase): FollowUpQuestion[] {
  const ranked: Ranked[] = [];

  for (const meta of FIELD_META) {
    if (!meta.askable || !meta.question) continue;
    if (isFilled(fieldOf(kb, meta.path))) continue;

    const substituted = (meta.substitutes ?? []).some((path) =>
      isFilled(fieldOf(kb, path)),
    );
    const penalty = substituted ? SUBSTITUTABILITY_PENALTY : 1;

    // Dividing by answerCost is the load-bearing choice: it front-loads gaps
    // that are both valuable and cheap to close.
    ranked.push({ meta, priority: (meta.impact * penalty) / meta.answerCost });
  }

  ranked.sort((a, b) => b.priority - a.priority || a.meta.path.localeCompare(b.meta.path));

  const questions: FollowUpQuestion[] = [];
  const usedGroups = new Set<string>();

  for (const { meta, priority } of ranked) {
    if (questions.length >= MAX_FOLLOW_UP_QUESTIONS) break;

    // Grouped fields are asked together: "Where are you based, and which areas
    // do you serve?" fills three paths with one answer.
    if (meta.group) {
      if (usedGroups.has(meta.group)) continue;
      usedGroups.add(meta.group);

      const siblings = ranked.filter(
        (entry) => entry.meta.group === meta.group,
      );
      questions.push({
        id: `q-${meta.group}`,
        question: joinQuestions(siblings.map((entry) => entry.meta.question!)),
        example: meta.example ?? null,
        fills: siblings.map((entry) => entry.meta.path),
        priority: Number(
          siblings.reduce((sum, entry) => sum + entry.priority, 0).toFixed(3),
        ),
        answered: false,
      });
      continue;
    }

    questions.push({
      id: `q-${meta.path.replace(/\./g, "-")}`,
      question: meta.question!,
      example: meta.example ?? null,
      fills: [meta.path],
      priority: Number(priority.toFixed(3)),
      answered: false,
    });
  }

  return questions.sort((a, b) => b.priority - a.priority);
}

/** "Where are you based?" + "Which areas do you serve?" → one prompt. */
function joinQuestions(questions: string[]): string {
  if (questions.length === 1) return questions[0];

  const parts = questions.map((question, index) => {
    const trimmed = question.replace(/\?$/, "");
    return index === 0 ? trimmed : lowerFirst(trimmed);
  });
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}?`;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/* ------------------------------------------------------------------ build */

export function buildQuality(kb: KnowledgeBase, conflicts: Conflict[]): Quality {
  const { categoryScores, overallScore } = scoreCompleteness(kb);

  return {
    overallScore,
    categoryScores,
    missingFields: missingFields(kb),
    conflicts,
    followUpQuestions: buildFollowUpQuestions(kb),
  };
}

/** Field paths currently sitting in the review UI's attention tier. */
export function attentionPaths(kb: KnowledgeBase): string[] {
  return FIELD_META.filter((meta) => {
    const field = fieldOf(kb, meta.path);
    return field ? needsReview(field) : false;
  }).map((meta) => meta.path);
}

/** Plain-language label for a path, for messages and the conflict UI. */
export function labelFor(path: string): string {
  return fieldMeta(path)?.label ?? path;
}
