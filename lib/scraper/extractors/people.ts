import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";
import { newId } from "@/lib/schema";
import { normalizeUrl } from "@/lib/utils/url";

/**
 * Staff, from the three shapes SMB sites actually publish them in.
 *
 * The first version read person *cards* only, and it worked on exactly one of
 * the seven golden sites — Bee Cave, whose `/staffbios` page uses a card grid.
 * The other six publish their people as:
 *
 * - **a heading sequence**: `<h2>TRISTAN</h2>` then "President & Co-Founder",
 *   with the two in unrelated containers (moflo.ai, built in Framer). Nothing
 *   about the DOM structure says "person"; the *sequence* does.
 * - **a page per person**: `/kelly-jones`, `/team/kamran-zand`,
 *   `/about-us/doug-cohen`. The name is the page's own heading, and the URL slug
 *   confirms it — which is the guard that keeps this from firing on every page
 *   with a name-shaped heading.
 *
 * The looseness has a hard limit: a name-shaped-string detector let loose
 * sitewide returns testimonial authors and blog bylines. The reference output
 * shows what that costs — seven of Bee Cave's eight "Key People" are customers
 * quoting staff, and a live scrape here reported a blog byline as an employee.
 */

const CARD_SELECTOR = [
  '[class*="team-member" i]',
  '[class*="teammember" i]',
  '[class*="staff-member" i]',
  '[class*="team_member" i]',
  '[class*="person" i]',
  '[class*="agent-card" i]',
  '[class*="bio-card" i]',
  '[class*="profile-card" i]',
  "article[class*='team' i]",
  "li[class*='team' i]",
  "div[class*='team' i] > div",
].join(", ");

/**
 * Blog chrome. A byline is not a staff directory — see the live-scrape note above.
 *
 * Matched on whole class words rather than as a substring: `[class*='post']`
 * also matches Divi's `et-l--post`, which wraps the entire body of every page it
 * renders, and silently discarded all 108 person cards on Bee Cave's staff page.
 */
const BLOG_CLASS =
  /(?:^|[\s_-])(?:byline|post-author|entry-author|entry-meta|post-meta|posts?-list|recent-posts?|blog-list|blog-roll|comment|commenter)(?:[\s_-]|$)/i;

const NAME = /^[A-Z][a-zA-Z.'’-]+(?:\s+[A-Z][a-zA-Z.'’-]+){0,3}$/;

/** Job-title words, used to tell a title line from a stray sentence. */
const TITLE_HINT =
  /\b(owner|founder|co-?founder|president|vice president|vp|ceo|cfo|coo|cto|director|manager|supervisor|lead|principal|partner|associate|agent|broker|realtor|consultant|specialist|technician|engineer|developer|dev|designer|coordinator|administrator|administration|admin|assistant|advisor|attorney|accountant|cpa|inspector|estimator|foreman|superintendent|representative|rep|sales|marketing|service|operations|support|driller|installer|apprentice|controller|officer|chief|head of|analyst|architect|strategist|editor|writer|instructor|trainer)\b/i;

/**
 * Headings that are section labels, not people. Checked before the name shape,
 * because "Our Team" and "Meet Kelly" both pass a capitalised-words test.
 */
const NOT_A_PERSON =
  /^(meet|our|the|about|contact|home|services?|products?|team|staff|leadership|management|who|why|what|how|welcome|overview|careers?|blog|news|search|menu|more|read|view|learn|get|call|book|schedule)\b/i;

/** A company is not a person, however capitalised its name is. */
const COMPANY_SUFFIX = /\b(LLC|Inc\.?|Ltd\.?|Corp\.?|Corporation|Company|Group|Associates|Partners|Services|Solutions|Realty|Team)\b/i;

/**
 * Nouns that appear in product and page names and never in a person's.
 *
 * Every entry was a false positive from a real fixture: "Pumping Systems",
 * "Water Pressure", "Pest Library", "Kids Corner", "IRS Tax Problems",
 * "Learning Center", "Privacy Policy". Capitalised two-word headings are
 * everywhere on an SMB site, and name-shape alone does not tell them from people.
 */
const NOT_A_NAME_WORD =
  /\b(systems?|control|library|corner|policy|policies|cent(?:er|re)|problems?|pressure|flow|quality|insurance|estate|reviews?|monitoring|repairs?|installations?|drilling|pumping|plumbing|tax|pest|water|air|heating|cooling|inspections?|financing|training|videos?|promotions?|terms|privacy|faqs?|blog|news|pricing|support|login|search|sitemap|guide|tips|equipment|maintenance|emergency|residential|commercial)\b/i;

/** Function words. "Working With Us" is capitalised like a name and is not one. */
const NAME_STOPWORD =
  /\b(with|us|we|our|your|you|the|and|or|for|to|in|on|at|by|from|of|my)\b/i;

/** Roles a single-word heading can't be: nav labels look exactly like first names. */
const NAV_WORD =
  /^(home|about|contact|services?|products?|pricing|blog|news|careers?|team|staff|faq|support|login|search|menu|more|next|previous|close|open|share|reviews?|testimonials?|gallery|projects?|resources?|welcome)$/i;

/** Pages whose name-shaped headings are customers or authors, never staff. */
const NEVER_A_PERSON_PAGE = new Set(["testimonials", "blog-post", "blog-index", "legal", "faq"]);

/** Path segments a site uses when it files a page under its people. */
const PEOPLE_PATH = /\/(team|staff|our-team|people|agents?|realtors?|bios?|profiles?|leadership|about-us|about)\//i;

type PersonRecord = ReturnType<typeof makePerson>;

export function extractPeople(page: PageInput, site: SiteContext): Evidence[] {
  const $ = cheerio.load(page.html);
  $("script, style, noscript, template, svg").remove();

  const found = new Map<string, { person: PersonRecord; confidence: number }>();

  // Cards first: they carry bios, photos and emails, so a person found twice
  // keeps the richer record.
  if (page.role === "team" || page.role === "about") {
    fromCards($, page, found);
    fromHeadingSequence($, page, found);
  }
  fromPersonPage($, page, found);

  void site;

  return [...found.values()]
    .slice(0, 30)
    .map((entry) =>
      evidence("people", entry.person, "dom", page, { confidence: entry.confidence }),
    );
}

function add(
  found: Map<string, { person: PersonRecord; confidence: number }>,
  person: PersonRecord | null,
  confidence: number,
): void {
  if (!person) return;
  const key = person.name.toLowerCase();
  if (found.has(key)) return;
  found.set(key, { person, confidence });
}

/* ------------------------------------------------------------------ cards */

function fromCards(
  $: cheerio.CheerioAPI,
  page: PageInput,
  found: Map<string, { person: PersonRecord; confidence: number }>,
): void {
  $(CARD_SELECTOR).each((_, element) => {
    const card = $(element);
    // A grid wrapper matches the same selector as the cards inside it.
    if (card.find(CARD_SELECTOR).length > 0) return;
    if (inBlogContext(card)) return;

    add(found, readCard($, card, page.url), 0.7);
  });
}

function readCard(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
  pageUrl: string,
): PersonRecord | null {
  // The name is the card's most prominent text: a heading, or the first line.
  const headingText = card.find("h1, h2, h3, h4, h5, h6").first().text();
  const name = cleanName(
    (headingText || card.find("[class*='name' i]").first().text()) ?? "",
  );
  if (!isPersonName(name)) return null;

  const lines = cardLines(card);
  const title = explicitTitle($, card, name) ?? findTitle(lines, name);
  const bio = findBio(lines, name, title);

  // Without a title or a bio, a matching heading is just a heading.
  if (!title && !bio) return null;

  return makePerson({
    name,
    title,
    bio,
    imageUrl: card.find("img").first().attr("src") ?? card.find("img").first().attr("data-src"),
    linkedin: card.find("a[href*='linkedin.com']").first().attr("href"),
    email: mailto(card.find("a[href^='mailto:']").first().attr("href")),
    pageUrl,
  });
}

function explicitTitle(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
  name: string,
): string | null {
  const text = card
    .find("[class*='title' i], [class*='role' i], [class*='position' i], [class*='job' i]")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  return text && text !== name && text.length <= 70 ? text : null;
}

/* -------------------------------------------------------- heading sequence */

/**
 * A name-shaped heading followed, within a line or two, by a job title.
 *
 * This is what reads a team section whose markup carries no semantics at all:
 * the framework emits `<div><h2>NATHAN</h2></div><div>CEO & Co-Founder</div>`,
 * and the only thing tying the two together is that one follows the other.
 */
function fromHeadingSequence(
  $: cheerio.CheerioAPI,
  page: PageInput,
  found: Map<string, { person: PersonRecord; confidence: number }>,
): void {
  const lines = documentLines($);

  lines.forEach((line, index) => {
    if (!line.isHeading) return;
    const name = cleanName(line.text);
    if (!isPersonName(name)) return;
    if (inBlogContext(line.node)) return;

    // Two lines of slack: many layouts put a photo caption or a location
    // between the name and the role.
    const title = findTitle(
      lines.slice(index + 1, index + 3).map((entry) => entry.text),
      name,
    );
    if (!title) return;

    add(
      found,
      makePerson({
        name,
        title,
        bio: findBio(
          lines.slice(index + 1, index + 8).map((entry) => entry.text),
          name,
          title,
        ),
        imageUrl: line.node.closest("div, li, article").find("img").first().attr("src"),
        pageUrl: page.url,
      }),
      0.6,
    );
  });
}

/* ------------------------------------------------------------- person page */

/**
 * A page that is about one person, confirmed by its own URL.
 *
 * `/team/kamran-zand` with `<h1>Kamran Zand</h1>` is a bio page in a way that
 * `/testimonials/9501-balatta-canyon-court` never is, and requiring the slug to
 * match the heading is what separates them without a page-role heuristic that
 * every site names differently.
 */
function fromPersonPage(
  $: cheerio.CheerioAPI,
  page: PageInput,
  found: Map<string, { person: PersonRecord; confidence: number }>,
): void {
  if (NEVER_A_PERSON_PAGE.has(page.role)) return;

  const slug = slugWords(page.url);
  if (!slug) return;

  const lines = documentLines($);
  const index = lines.findIndex(
    (line) => line.isHeading && matchesSlug(line.text, slug),
  );
  if (index < 0) return;

  const name = cleanName(lines[index].text);
  if (!isPersonName(name)) return;

  const after = lines.slice(index + 1, index + 12).map((line) => line.text);
  const title = findTitle(after, name);
  const bio = findBio(after, name, title);

  // A person-shaped page needs a second signal, because "/pumping-systems" with
  // an `<h1>Pumping Systems</h1>` matches its slug just as neatly as
  // "/kelly-jones" does. Either the site files the page under people, or a job
  // title sits directly beneath the name.
  const filedUnderPeople =
    page.role === "team" || PEOPLE_PATH.test(pathOf(page.url));
  const titledImmediately = findTitle(after.slice(0, 3), name) !== null;
  if (!filedUnderPeople && !titledImmediately) return;
  if (!title && !bio && !filedUnderPeople) return;

  add(
    found,
    makePerson({
      name,
      title,
      bio,
      imageUrl: $("img").first().attr("src"),
      linkedin: $("a[href*='linkedin.com']").first().attr("href"),
      email: mailto($("a[href^='mailto:']").first().attr("href")),
      phone: $("a[href^='tel:']").first().attr("href")?.replace(/^tel:/i, "").trim(),
      profileUrl: page.url,
      pageUrl: page.url,
    }),
    0.75,
  );
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** `https://x.com/team/kamran-zand/` → `["kamran", "zand"]`, or null. */
function slugWords(url: string): string[] | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const last = pathname.split("/").filter(Boolean).at(-1);
  if (!last) return null;

  const words = last
    .replace(/\.\w+$/, "")
    .split(/[-_]/)
    .filter(Boolean);

  // Two or three words, all alphabetic: a person's name. Street addresses and
  // article slugs are longer, and contain digits.
  if (words.length < 2 || words.length > 3) return null;
  if (!words.every((word) => /^[a-z]{2,}$/i.test(word))) return null;
  return words.map((word) => word.toLowerCase());
}

function matchesSlug(heading: string, slug: string[]): boolean {
  const normalized = heading.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  // "Doug Cohen, CPA" and "Kamran Zand - Luxury Homes" both start with the slug;
  // "Kelly Jones Real Estate Listings" does too, which is why the heading is
  // cleaned to its first clause before it becomes a name.
  return normalized.startsWith(slug.join(" "));
}

/* ------------------------------------------------------------------ lines */

type DocumentLine = {
  text: string;
  isHeading: boolean;
  node: cheerio.Cheerio<AnyNode>;
};

/**
 * Every leaf block of text on the page, in document order.
 *
 * Leaf-only, because an ancestor's `.text()` is the concatenation of everything
 * below it — reading those as lines would compare a name against the whole page.
 */
function documentLines($: cheerio.CheerioAPI): DocumentLine[] {
  const lines: DocumentLine[] = [];

  $("body *").each((_, element) => {
    const node = $(element);
    if (node.children().length > 0 && node.children().text().trim().length > 0) return;

    const text = node.text().replace(/\s+/g, " ").trim();
    if (!text || text.length > 400) return;

    const isHeading =
      node.is("h1, h2, h3, h4, h5, h6") ||
      /name|title/i.test(node.attr("class") ?? "");

    // The same text twice in a row is one thing said twice — a breadcrumb
    // immediately above the `<h1>` it names, most often. Keep the heading:
    // dropping it cost every one of Luxury Homes' ten agent pages, because the
    // breadcrumb came first and the `<h1>` was discarded as its duplicate.
    const previous = lines.at(-1);
    if (previous?.text === text) {
      if (isHeading && !previous.isHeading) lines[lines.length - 1] = { text, isHeading, node };
      return;
    }

    lines.push({ text, isHeading, node });
  });

  return lines;
}

function cardLines(card: cheerio.Cheerio<AnyNode>): string[] {
  return card
    .text()
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ fields */

/** "Doug Cohen, CPA" → "Doug Cohen"; "Kamran Zand - Luxury Homes" → "Kamran Zand". */
function cleanName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .split(/\s*[|–—•·]\s*|\s+-\s+|,\s*/)[0]
    .trim();
}

function isPersonName(name: string): boolean {
  if (!name || name.length > 45 || !NAME.test(name)) return false;
  if (NOT_A_PERSON.test(name) || COMPANY_SUFFIX.test(name)) return false;
  if (NOT_A_NAME_WORD.test(name) || NAME_STOPWORD.test(name)) return false;
  // A single-word heading is a person only when it is styled as one: team
  // sections that use first names alone set them in caps ("NATHAN",
  // "TRISTAN"). A sentence-case single word is a nav label or a section title
  // far more often than it is somebody's name.
  if (!name.includes(" ") && (NAV_WORD.test(name) || name !== name.toUpperCase())) {
    return false;
  }
  return true;
}

function findTitle(lines: string[], name: string): string | null {
  for (const line of lines) {
    const text = line.replace(/[.]$/, "").trim();
    if (!text || text === name || text.length > 70) continue;
    // A job title is a short noun phrase with no numbers in it. Without this,
    // "Includes 25' cable with flying lead" reads as a title, because "lead" is
    // a role word.
    if (/\d/.test(text) || text.split(/\s+/).length > 8) continue;
    if (TITLE_HINT.test(text)) return text;
  }
  return null;
}

function findBio(lines: string[], name: string, title: string | null): string | null {
  for (const line of lines) {
    if (line === name || line === title) continue;
    if (line.length >= 60 && /[.!?]/.test(line)) return line.slice(0, 800);
  }
  return null;
}

/** Walks ancestors testing whole class words — see `BLOG_CLASS`. */
function inBlogContext(node: cheerio.Cheerio<AnyNode>): boolean {
  let current = node;
  for (let depth = 0; depth < 12 && current.length > 0; depth += 1) {
    if (BLOG_CLASS.test(current.attr("class") ?? "")) return true;
    current = current.parent();
  }
  return false;
}

function mailto(href: string | undefined): string | undefined {
  return href?.replace(/^mailto:/i, "").split("?")[0];
}

function makePerson(input: {
  name: string;
  title: string | null;
  bio: string | null;
  imageUrl?: string;
  linkedin?: string;
  email?: string;
  phone?: string;
  profileUrl?: string;
  pageUrl: string;
}) {
  return {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.7,
    sourceUrls: [] as string[],
    name: input.name,
    title: input.title,
    role: roleFromTitle(input.title),
    gender: null,
    bio: input.bio,
    email: input.email ?? null,
    phone: input.phone ?? null,
    imageUrl: input.imageUrl
      ? (normalizeUrl(input.imageUrl, input.pageUrl) ?? null)
      : null,
    profileUrl: input.profileUrl ?? null,
    linkedin: input.linkedin ? (normalizeUrl(input.linkedin) ?? null) : null,
  };
}

function roleFromTitle(title: string | null) {
  if (!title) return null;
  if (/\b(owner|founder|co-?founder|proprietor)\b/i.test(title)) return "owner" as const;
  if (/\b(ceo|cfo|coo|cto|president|vice president|vp|principal|partner)\b/i.test(title)) {
    return "executive" as const;
  }
  if (/\b(manager|director|supervisor|lead|foreman|superintendent)\b/i.test(title)) {
    return "manager" as const;
  }
  if (/\b(advisor|consultant|attorney|accountant)\b/i.test(title)) return "advisor" as const;
  return "staff" as const;
}
