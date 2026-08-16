import type { PageRole } from "@/lib/schema";

/**
 * Scores a candidate URL into a page role, so the crawler visits the pages that
 * carry knowledge before it visits the ones that don't.
 *
 * This is what makes a truncated crawl still useful. With a 20-page budget on a
 * 200-page site, the difference between reading About/Services/Contact/Team and
 * reading twenty blog posts from 2019 is the whole result.
 */

export type Classification = {
  role: PageRole;
  /** Higher is crawled first. */
  priority: number;
  /** 0–1, how sure we are of the role. Low confidence still gets crawled. */
  confidence: number;
};

type Rule = {
  role: PageRole;
  /** Matched against the path, and separately against the link's anchor text. */
  patterns: RegExp[];
  priority: number;
};

/**
 * Ordered by value to the knowledge base, not by how common the page is.
 * `about` outranks `services` because it carries founding year, story, people,
 * and credentials — the fields that are hardest to get anywhere else.
 */
const RULES: Rule[] = [
  {
    role: "about",
    priority: 95,
    patterns: [
      /^\/(about|about-us|our-story|who-we-are|company|history|meet-us)(\/|$)/,
      /\/(about|about-us|our-story|who-we-are)(\/|$)/,
    ],
  },
  {
    role: "services",
    priority: 90,
    patterns: [
      /^\/(services|what-we-do|solutions|offerings|capabilities)(\/|$)/,
      /\/(services|solutions|what-we-do)(\/|$)/,
    ],
  },
  {
    role: "contact",
    priority: 85,
    patterns: [/^\/(contact|contact-us|get-in-touch|locations|find-us)(\/|$)/],
  },
  {
    role: "products",
    priority: 80,
    patterns: [/^\/(products|shop|catalog|catalogue|equipment)(\/|$)/],
  },
  {
    role: "team",
    priority: 75,
    patterns: [
      /^\/(team|our-team|staff|people|leadership|management|agents|attorneys|providers)(\/|$)/,
      /\/(our-team|meet-the-team|meet-our-team|staff-directory|staff-?bios|our-staff)(\/|$)/,
    ],
  },
  {
    role: "testimonials",
    priority: 70,
    patterns: [
      /^\/(testimonials|reviews|client-reviews|what-clients-say|success-stories|case-studies)(\/|$)/,
      /\/(testimonials|reviews|case-studies)(\/|$)/,
    ],
  },
  {
    role: "pricing",
    priority: 65,
    patterns: [/^\/(pricing|plans|rates|packages|quote|estimate)(\/|$)/],
  },
  {
    role: "faq",
    priority: 60,
    patterns: [/^\/(faq|faqs|frequently-asked|questions|help|resources)(\/|$)/],
  },
  {
    role: "blog-index",
    priority: 45,
    patterns: [/^\/(blog|news|articles|insights|resources|updates|posts)\/?$/],
  },
  {
    role: "blog-post",
    priority: 30,
    patterns: [
      /^\/(blog|news|articles|insights|posts)\/.+/,
      /^\/\d{4}\/\d{2}\/.+/,
    ],
  },
  {
    role: "legal",
    priority: 10,
    patterns: [
      /^\/(privacy|privacy-policy|terms|terms-of-service|terms-and-conditions|accessibility|sitemap|disclaimer|cookie-policy)(\/|$)/,
    ],
  },
];

/** Anchor-text hints, used when the path itself is uninformative (`/p/12345`). */
const ANCHOR_HINTS: Array<[RegExp, PageRole]> = [
  [/\babout\b|\bour story\b|\bwho we are\b/i, "about"],
  [/\bservices\b|\bwhat we do\b/i, "services"],
  [/\bcontact\b|\bget in touch\b/i, "contact"],
  [/\bteam\b|\bstaff\b|\bour people\b/i, "team"],
  [/\btestimonials\b|\breviews\b/i, "testimonials"],
  [/\bpricing\b|\brates\b|\bget a quote\b/i, "pricing"],
  [/\bfaq\b|\bfrequently asked\b/i, "faq"],
  [/\bblog\b|\bnews\b|\barticles\b/i, "blog-index"],
];

const OTHER_PRIORITY = 40;

const LEGAL_ANYWHERE =
  /\/(privacy|privacy-policy|terms|terms-of-service|terms-of-use|terms-and-conditions|cookie-policy|disclaimer|accessibility|legal|dmca)(\/|$)/;

export function classifyUrl(url: string, anchorText?: string): Classification {
  let path: string;
  try {
    const parsed = new URL(url);
    path = parsed.pathname.toLowerCase();
    if (path === "/" || path === "") {
      return { role: "home", priority: 100, confidence: 1 };
    }
  } catch {
    return { role: "other", priority: 0, confidence: 0 };
  }

  // Checked before the ordered rules because legal pages are commonly nested
  // under a help or resources section, and `/help/privacy-policy` matching the
  // FAQ rule would spend budget on boilerplate.
  if (LEGAL_ANYWHERE.test(path)) {
    return { role: "legal", priority: 10, confidence: 0.85 };
  }

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(path)) {
        return { role: rule.role, priority: rule.priority, confidence: 0.9 };
      }
    }
  }

  if (anchorText) {
    for (const [pattern, role] of ANCHOR_HINTS) {
      if (pattern.test(anchorText)) {
        const rule = RULES.find((candidate) => candidate.role === role);
        return {
          role,
          // Below any path match, above an unclassified page.
          priority: (rule?.priority ?? OTHER_PRIORITY) - 5,
          confidence: 0.5,
        };
      }
    }
  }

  // A single-segment path on a small site is usually a real service page
  // ("/well-drilling"), so it outranks a deeply nested one.
  const depth = path.split("/").filter(Boolean).length;
  return {
    role: "other",
    priority: depth <= 1 ? OTHER_PRIORITY + 5 : OTHER_PRIORITY - depth,
    confidence: 0.2,
  };
}

/** Roles worth spending the budget on before anything unclassified. */
export const HIGH_VALUE_ROLES: ReadonlySet<PageRole> = new Set<PageRole>([
  "home",
  "about",
  "services",
  "contact",
  "products",
  "team",
  "testimonials",
  "pricing",
  "faq",
]);
