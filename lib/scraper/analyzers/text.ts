/**
 * Deterministic text analysis over the crawled corpus.
 *
 * Two consumers:
 *
 * - `TextMetrics` grounds `prompts/03-writing-style.md`. Tone is a subjective
 *   judgment, and asking a model for one unanchored produces vibes; giving it
 *   measured sentence length, reading grade, and pronoun ratios means its claims
 *   can be checked against the text. These metrics are an internal input, not a
 *   schema field — ROADMAP §4.2 cut `voiceProfile` and kept the measurements.
 * - `extractThemes` feeds `contentIntelligence.themes`.
 */

const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","than","that","this","these","those","of","to","in",
  "on","at","by","for","with","from","as","is","are","was","were","be","been","being","have","has",
  "had","do","does","did","will","would","should","could","can","may","might","must","shall","not",
  "no","yes","it","its","we","our","us","you","your","yours","they","their","them","he","she","his",
  "her","i","me","my","all","any","some","more","most","other","into","over","after","before","up",
  "down","out","off","about","also","just","only","very","so","too","there","here","when","where",
  "which","who","what","how","why","new","get","one","two","use","using","used","make","made","see",
  "like","time","way","well","back","even","because","through","during","while","between","each",
  "both","own","same","such","only","now","day","days","year","years","home","page","click","read",
]);

/**
 * Words every business website uses regardless of trade. Filtering these is what
 * separates a theme from a truism — without it, every company's top theme is
 * "services" and the field tells a content generator nothing.
 */
const GENERIC_BUSINESS = new Set([
  "service","services","business","businesses","company","companies","customer","customers","client",
  "clients","team","quality","professional","professionals","experience","experienced","solution",
  "solutions","provide","provides","providing","offer","offers","offering","need","needs","help",
  "helping","work","working","best","great","top","leading","trusted","reliable","contact","call",
  "today","free","learn","more","info","information","request","quote","schedule","appointment",
  "years","local","area","areas","people","support","product","products","industry","industries",
  "value","values","commitment","committed","dedicated","mission","vision","choose","why","us",
]);

export type TextMetrics = {
  wordCount: number;
  sentenceCount: number;
  /** Mean words per sentence. */
  averageSentenceLength: number;
  /**
   * Standard deviation of sentence length. Carries what the mean cannot: a site
   * alternating four-word headlines with 40-word paragraphs has the same mean as
   * one that writes every sentence at 22 words, and they read nothing alike.
   */
  sentenceLengthStdDev: number;
  /** Flesch-Kincaid grade level. */
  readingGrade: number;
  /** Share of sentences addressing the reader as "you". */
  secondPersonRatio: number;
  /** Share of sentences using "we"/"our". */
  firstPersonPluralRatio: number;
  exclamationRatio: number;
  questionRatio: number;
  /** Share of sentences opening with an imperative verb. */
  imperativeRatio: number;
  /** Distinctive terms with their counts, generic business language removed. */
  distinctiveTerms: Array<{ term: string; count: number }>;
  /**
   * Sentences the model is shown alongside the numbers. Without them prompt 03
   * can describe the writing but cannot quote its vocabulary, and
   * `preferredTerms` is meant to be the company's real words.
   */
  exemplarSentences: string[];
};

const IMPERATIVE_OPENERS =
  /^(call|get|schedule|book|contact|request|discover|find|learn|explore|start|try|join|sign|visit|see|check|let|don't|make|take|give|ask|trust|choose|protect|save|stop|keep|bring|read|download|subscribe|order|shop|browse)\b/i;

export function analyzeText(corpus: string): TextMetrics {
  const text = corpus.replace(/\s+/g, " ").trim();
  const sentences = splitSentences(text);
  const words = text.match(/\b[a-zA-Z'’]+\b/g) ?? [];

  const wordCount = words.length;
  const sentenceCount = sentences.length;

  if (wordCount === 0 || sentenceCount === 0) {
    return {
      wordCount,
      sentenceCount,
      averageSentenceLength: 0,
      sentenceLengthStdDev: 0,
      readingGrade: 0,
      secondPersonRatio: 0,
      firstPersonPluralRatio: 0,
      exclamationRatio: 0,
      questionRatio: 0,
      imperativeRatio: 0,
      distinctiveTerms: [],
      exemplarSentences: [],
    };
  }

  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);
  const averageSentenceLength = wordCount / sentenceCount;

  const lengths = sentences.map((sentence) => sentence.split(/\s+/).length);
  const variance =
    lengths.reduce((sum, length) => sum + (length - averageSentenceLength) ** 2, 0) /
    sentenceCount;

  // Flesch-Kincaid grade level.
  const readingGrade =
    0.39 * averageSentenceLength + 11.8 * (syllables / wordCount) - 15.59;

  const ratio = (predicate: (sentence: string) => boolean) =>
    round(sentences.filter(predicate).length / sentenceCount);

  return {
    wordCount,
    sentenceCount,
    averageSentenceLength: round(averageSentenceLength),
    sentenceLengthStdDev: round(Math.sqrt(variance)),
    readingGrade: round(Math.max(0, readingGrade)),
    secondPersonRatio: ratio((sentence) => /\b(you|your|yours|you're|you'll)\b/i.test(sentence)),
    firstPersonPluralRatio: ratio((sentence) => /\b(we|our|ours|we're|we'll|us)\b/i.test(sentence)),
    exclamationRatio: ratio((sentence) => sentence.includes("!")),
    questionRatio: ratio((sentence) => sentence.includes("?")),
    imperativeRatio: ratio((sentence) => IMPERATIVE_OPENERS.test(sentence.trim())),
    distinctiveTerms: topTerms(words, 15),
    exemplarSentences: pickExemplars(sentences, 12),
  };
}

/**
 * Representative sentences, sampled evenly across the corpus.
 *
 * Evenly rather than "the first twelve": pages are crawled in priority order, so
 * the opening of the corpus is all home-page hero copy, which is the least
 * representative writing on any site.
 */
function pickExemplars(sentences: string[], limit: number): string[] {
  const usable = sentences.filter((sentence) => {
    const words = sentence.split(/\s+/).length;
    if (words < 6 || words > 45) return false;
    if (sentence.length > 320) return false;
    // Menus and cookie banners survive sentence splitting and say nothing about
    // how the company writes.
    if (/\b(cookie|privacy policy|all rights reserved|©|skip to (main )?content)\b/i.test(sentence)) {
      return false;
    }
    return /[.!?]$/.test(sentence.trim());
  });

  if (usable.length <= limit) return usable;

  const step = usable.length / limit;
  return Array.from({ length: limit }, (_, index) => usable[Math.floor(index * step)]);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 3);
}

/** Vowel-group heuristic. Good enough for a grade level, and dependency-free. */
export function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (clean.length <= 3) return 1;

  const trimmed = clean
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length);
}

function topTerms(words: string[], limit: number): Array<{ term: string; count: number }> {
  const counts = new Map<string, number>();

  for (const raw of words) {
    const word = raw.toLowerCase().replace(/['’]s$/, "");
    if (word.length < 4 || word.length > 24) continue;
    if (STOPWORDS.has(word) || GENERIC_BUSINESS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

/* ----------------------------------------------------------------- themes */

export type ThemeCandidate = {
  label: string;
  weight: number;
  terms: string[];
  exampleUrls: string[];
};

type ThemeInput = { url: string; text: string };

/**
 * Clusters the corpus into topics by co-occurrence of distinctive terms.
 *
 * Deliberately simple: a term becomes a theme seed, and terms that keep
 * appearing on the same pages join it. Anything more (embeddings, LDA) is a
 * dependency and a latency cost for a field that feeds a topic pipeline, where
 * "roughly the right five subjects" is the requirement.
 */
export function extractThemes(pages: ThemeInput[], limit = 8): ThemeCandidate[] {
  const documentFrequency = new Map<string, Set<string>>();
  const totalCounts = new Map<string, number>();

  for (const page of pages) {
    const words = page.text.match(/\b[a-zA-Z'’]+\b/g) ?? [];
    const seenOnPage = new Set<string>();

    for (const raw of words) {
      const word = raw.toLowerCase().replace(/['’]s$/, "");
      if (word.length < 4 || word.length > 24) continue;
      if (STOPWORDS.has(word) || GENERIC_BUSINESS.has(word)) continue;

      totalCounts.set(word, (totalCounts.get(word) ?? 0) + 1);
      if (!seenOnPage.has(word)) {
        seenOnPage.add(word);
        const pagesWithTerm = documentFrequency.get(word) ?? new Set<string>();
        pagesWithTerm.add(page.url);
        documentFrequency.set(word, pagesWithTerm);
      }
    }
  }

  // A term that appears on every page is boilerplate (nav, footer); one that
  // appears on a single page is usually incidental.
  const pageCount = Math.max(1, pages.length);
  const candidates = [...totalCounts.entries()]
    .map(([term, count]) => {
      const docs = documentFrequency.get(term) ?? new Set<string>();
      const spread = docs.size / pageCount;
      return { term, count, docs, spread };
    })
    .filter((entry) => entry.count >= 4 && entry.spread < 0.9)
    .sort((a, b) => b.count - a.count);

  const themes: ThemeCandidate[] = [];
  const used = new Set<string>();

  for (const seed of candidates) {
    if (themes.length >= limit) break;
    if (used.has(seed.term)) continue;

    // Terms sharing most of the seed's pages belong to the same subject.
    const related = candidates
      .filter((other) => {
        if (other.term === seed.term || used.has(other.term)) return false;
        const shared = [...other.docs].filter((url) => seed.docs.has(url)).length;
        return shared / Math.max(1, Math.min(other.docs.size, seed.docs.size)) >= 0.6;
      })
      .slice(0, 5);

    used.add(seed.term);
    for (const entry of related) used.add(entry.term);

    themes.push({
      label: titleCase(seed.term),
      weight: 0,
      terms: [seed.term, ...related.map((entry) => entry.term)],
      exampleUrls: [...seed.docs].slice(0, 3),
    });
  }

  const totalWeight = themes.reduce((sum, theme) => {
    const seed = candidates.find((entry) => entry.term === theme.terms[0]);
    return sum + (seed?.count ?? 0);
  }, 0);

  return themes.map((theme) => {
    const seed = candidates.find((entry) => entry.term === theme.terms[0]);
    return {
      ...theme,
      weight: totalWeight > 0 ? round((seed?.count ?? 0) / totalWeight) : 0,
    };
  });
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
