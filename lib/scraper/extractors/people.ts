import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";
import { newId } from "@/lib/schema";
import { normalizeUrl } from "@/lib/utils/url";

/**
 * Staff from team-page DOM structures.
 *
 * Only runs on pages classified `team` or `about`, and only inside a container
 * that looks like a person card. A name-shaped-string detector loose enough to
 * work sitewide produces a roster of testimonial authors, blog bylines, and
 * street names — which is roughly what the reference output did for Bee Cave,
 * where seven of eight "Key People" are customers quoting staff.
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

const NAME = /^[A-Z][a-zA-Z.'’-]+(?:\s+[A-Z][a-zA-Z.'’-]+){0,3}$/;

/** Job-title words, used to tell a title line from a stray sentence. */
const TITLE_HINT =
  /\b(owner|founder|co-?founder|president|vice president|vp|ceo|cfo|coo|cto|director|manager|supervisor|lead|principal|partner|associate|agent|broker|realtor|consultant|specialist|technician|engineer|developer|designer|coordinator|administrator|assistant|advisor|attorney|accountant|cpa|inspector|estimator|foreman|superintendent|representative|rep|sales|marketing|service|operations|support)\b/i;

export function extractPeople(page: PageInput, site: SiteContext): Evidence[] {
  if (page.role !== "team" && page.role !== "about") return [];

  const $ = cheerio.load(page.html);
  const out: Evidence[] = [];
  const seen = new Set<string>();

  $(CARD_SELECTOR).each((_, element) => {
    const card = $(element);
    // A grid wrapper matches the same selector as the cards inside it.
    if (card.find(CARD_SELECTOR).length > 0) return;

    const person = readCard($, card, page.url);
    if (!person) return;

    const key = person.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    out.push(evidence("people", person, "dom", page, { confidence: 0.7 }));
  });

  void site;
  return out.slice(0, 30);
}

function readCard(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
  pageUrl: string,
) {
  // The name is the card's most prominent text: a heading, or the first line.
  const headingText = card.find("h1, h2, h3, h4, h5, h6").first().text();
  const nameCandidate = (headingText || card.find("[class*='name' i]").first().text())
    .replace(/\s+/g, " ")
    .trim();

  if (!nameCandidate || !NAME.test(nameCandidate)) return null;
  if (nameCandidate.length > 45) return null;

  const title = findTitle($, card, nameCandidate);
  const bio = findBio($, card, nameCandidate, title);

  // Without a title or a bio, a matching heading is just a heading.
  if (!title && !bio) return null;

  const image =
    card.find("img").first().attr("src") ?? card.find("img").first().attr("data-src");
  const linkedin = card
    .find("a[href*='linkedin.com']")
    .first()
    .attr("href");
  const email = card
    .find("a[href^='mailto:']")
    .first()
    .attr("href")
    ?.replace(/^mailto:/i, "")
    .split("?")[0];

  return {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.7,
    sourceUrls: [],
    name: nameCandidate,
    title,
    role: roleFromTitle(title),
    gender: null,
    bio,
    email: email ?? null,
    phone: null,
    imageUrl: image ? (normalizeUrl(image, pageUrl) ?? null) : null,
    profileUrl: null,
    linkedin: linkedin ? (normalizeUrl(linkedin) ?? null) : null,
  };
}

function findTitle(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
  name: string,
): string | null {
  const explicit = card
    .find("[class*='title' i], [class*='role' i], [class*='position' i], [class*='job' i]")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  if (explicit && explicit !== name && explicit.length <= 70) return explicit;

  for (const line of textLines(card)) {
    if (line === name || line.length > 70) continue;
    if (TITLE_HINT.test(line) && !/[.!?]$/.test(line)) return line;
  }
  return null;
}

function findBio(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
  name: string,
  title: string | null,
): string | null {
  for (const line of textLines(card)) {
    if (line === name || line === title) continue;
    if (line.length >= 60 && /[.!?]/.test(line)) return line.slice(0, 800);
  }
  return null;
}

function textLines(card: cheerio.Cheerio<AnyNode>): string[] {
  return card
    .text()
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
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
