/**
 * Verifies that every quote the model returned is genuinely present in the
 * source text.
 *
 * This is the machine-verifiable constraint that `prompts/04-proof-extraction.md`
 * is built around, and it is the third of the three never-fabricate enforcement
 * layers in docs/DATA-QUALITY.md §2. A testimonial is a claim an SMB will
 * republish; a paraphrase that drifts a few words is a quote the customer never
 * said, attributed to a named person. Instructing the model not to paraphrase is
 * necessary but not sufficient — this checks.
 */

/**
 * Normalizes for comparison without changing what the quote says.
 *
 * Whitespace, smart quotes, and dashes vary between the rendered page and the
 * model's transcription of it for reasons that have nothing to do with accuracy.
 * Words and their order are what must match.
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isVerbatim(quote: string, sourceText: string): boolean {
  const needle = normalizeForMatch(quote);
  if (needle.length < 10) return false;
  return normalizeForMatch(sourceText).includes(needle);
}

export type VerificationResult<T> = {
  kept: T[];
  /** Quotes dropped because they were not found in the source. */
  dropped: Array<{ item: T; reason: string }>;
};

/**
 * Drops any item whose quote is not a verbatim substring of the corpus.
 *
 * Dropping is the right response rather than flagging: a quote we cannot find is
 * one we cannot stand behind, and the reviewer has no way to check it either.
 */
export function keepVerbatimQuotes<T>(
  items: T[],
  getQuote: (item: T) => string,
  sourceText: string,
): VerificationResult<T> {
  const kept: T[] = [];
  const dropped: Array<{ item: T; reason: string }> = [];

  for (const item of items) {
    const quote = getQuote(item);
    if (isVerbatim(quote, sourceText)) {
      kept.push(item);
    } else {
      dropped.push({
        item,
        reason: "quote is not a verbatim substring of the scraped text",
      });
    }
  }

  return { kept, dropped };
}
