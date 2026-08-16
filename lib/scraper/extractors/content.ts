import * as cheerio from "cheerio";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";
import { newId } from "@/lib/schema";
import { normalizeUrl } from "@/lib/utils/url";
import { visibleText } from "./contact";

/**
 * FAQs, blog posts, glossary terms, seasonal offers, and calls to action.
 *
 * The FAQ and glossary extractors exist because docs/SCHEMA-EXTENSIONS.md found
 * the reference output describing these signals in prose — "the content is
 * well-structured with FAQs" — while discarding the Q&A pairs and the term
 * definitions themselves, which are the parts a content generator can use.
 */

/* --------------------------------------------------------------- FAQ DOM */

const QUESTION = /\?\s*$/;

export function extractContent(page: PageInput, site: SiteContext): Evidence[] {
  const $ = cheerio.load(page.html);
  const out: Evidence[] = [];

  for (const faq of extractDomFaqs($)) {
    out.push(evidence("contentIntelligence.faqs", faq, "dom", page, { confidence: 0.7 }));
  }

  for (const cta of extractCtas($)) {
    out.push(evidence("market.ctas", cta, "dom", page, { confidence: 0.7 }));
  }

  for (const funnel of detectFunnels($, page.html)) {
    out.push(evidence("market.funnels", funnel, "dom", page, { confidence: 0.7 }));
  }

  for (const term of extractGlossary($)) {
    out.push(evidence("contentIntelligence.glossary", term, "dom", page, { confidence: 0.6 }));
  }

  for (const signal of extractSeasonal(visibleText($))) {
    out.push(
      evidence("contentIntelligence.seasonalSignals", signal, "heuristic", page, {
        confidence: 0.55,
      }),
    );
  }

  if (page.role === "blog-index") {
    for (const post of extractPostLinks($, page.url)) {
      out.push(evidence("contentIntelligence.posts", post, "dom", page, { confidence: 0.65 }));
    }
  }

  void site;
  return out;
}

/** `<details>/<summary>` and accordion markup, which is how most FAQs are built. */
function extractDomFaqs($: cheerio.CheerioAPI) {
  const faqs: Array<ReturnType<typeof toFaq>> = [];
  const seen = new Set<string>();

  const push = (question: string, answer: string) => {
    const q = question.replace(/\s+/g, " ").trim();
    const a = answer.replace(/\s+/g, " ").trim();
    if (!q || !a) return;
    if (q.length < 8 || q.length > 250) return;
    if (a.length < 15 || a.length > 2000) return;
    if (!QUESTION.test(q)) return;

    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    faqs.push(toFaq(q, a));
  };

  $("details").each((_, element) => {
    const details = $(element);
    const summary = details.find("summary").first();
    const question = summary.text();
    const answer = details.clone().children("summary").remove().end().text();
    push(question, answer);
  });

  $("[class*='accordion' i], [class*='faq' i]").each((_, element) => {
    const block = $(element);
    if (block.find("[class*='accordion' i], [class*='faq' i]").length > 0) return;

    const heading = block.find("h2, h3, h4, h5, [class*='question' i], button").first();
    const question = heading.text();
    if (!QUESTION.test(question.trim())) return;

    const answer =
      block.find("[class*='answer' i], [class*='content' i], [class*='panel' i], p").first().text() ||
      block.clone().children().first().remove().end().text();
    push(question, answer);
  });

  return faqs.slice(0, 40);
}

function toFaq(question: string, answer: string) {
  return {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.7,
    sourceUrls: [],
    question,
    answer,
    topic: null,
  };
}

/* ------------------------------------------------------------------ CTAs */

/** Wrapper and utility labels that are navigation, not a call to action. */
const NOT_A_CTA =
  /^(home|about|about us|services|products|contact|contact us|blog|news|faq|menu|search|login|log in|sign in|sign up|register|privacy|terms|sitemap|next|previous|prev|back|close|skip to content|read more|learn more|more|toggle navigation|español|english)$/i;

const CTA_VERB =
  /\b(call|get|request|schedule|book|start|contact|apply|shop|buy|order|subscribe|sign|join|download|claim|talk|speak|find|discover|explore|see|view|reserve|try|quote|estimate|consult|notify|submit)\b/i;

export function extractCtas($: cheerio.CheerioAPI): string[] {
  const counts = new Map<string, number>();

  $("a[class*='btn' i], a[class*='button' i], button, [role='button'], input[type='submit']").each(
    (_, element) => {
      const node = $(element);
      const label = (node.attr("value") ?? node.text()).replace(/\s+/g, " ").trim();
      if (!label || label.length < 3 || label.length > 60) return;
      if (NOT_A_CTA.test(label)) return;
      if (!CTA_VERB.test(label)) return;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    },
  );

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([label]) => label);
}

/* ---------------------------------------------------------------- funnels */

/**
 * Conversion paths present on the page. This is what the reference output's
 * `Funnels` field actually describes — the mechanisms a visitor can convert
 * through — which is why press mentions ending up there was a category error.
 */
export function detectFunnels($: cheerio.CheerioAPI, html: string): string[] {
  const funnels = new Set<string>();

  if ($("form").length > 0) {
    const formText = $("form").text().toLowerCase();
    if (/quote|estimate/.test(formText)) funnels.add("Quote request form");
    else if (/appointment|schedule|book/.test(formText)) funnels.add("Appointment scheduler");
    else if (/subscribe|newsletter|email updates/.test(formText)) funnels.add("Newsletter signup");
    else funnels.add("Contact form");
  }

  if ($("a[href^='tel:']").length > 0) funnels.add("Phone call");
  if ($("a[href^='mailto:']").length > 0) funnels.add("Email");
  if (/calendly\.com|acuityscheduling\.com|housecallpro\.com/i.test(html)) {
    funnels.add("Online booking");
  }
  if (/mailchimp|klaviyo|constantcontact|list-manage/i.test(html)) {
    funnels.add("Newsletter signup");
  }
  if ($("a[href*='/cart'], a[href*='/checkout'], form[action*='cart']").length > 0) {
    funnels.add("Online checkout");
  }
  if (/livechat|tawk\.to|intercom|drift\.com|messenger/i.test(html)) {
    funnels.add("Live chat");
  }

  return [...funnels];
}

/* --------------------------------------------------------------- glossary */

/**
 * Terms the company defines in its own words: `<dl>` pairs, and "X is …"
 * sentences under a matching heading. This is what gives generated content the
 * trade's vocabulary instead of an outsider's paraphrase of it.
 */
export function extractGlossary($: cheerio.CheerioAPI) {
  const terms: Array<ReturnType<typeof toTerm>> = [];
  const seen = new Set<string>();

  $("dl").each((_, list) => {
    const definitions = $(list);
    definitions.find("dt").each((_, element) => {
      const term = $(element).text().replace(/\s+/g, " ").trim();
      const definition = $(element).next("dd").text().replace(/\s+/g, " ").trim();
      if (!term || !definition) return;
      if (term.length > 60 || definition.length < 25 || definition.length > 600) return;
      if (seen.has(term.toLowerCase())) return;
      seen.add(term.toLowerCase());
      terms.push(toTerm(term, definition));
    });
  });

  $("h2, h3, h4").each((_, element) => {
    const heading = $(element).text().replace(/\s+/g, " ").trim();
    if (heading.length > 50 || heading.split(/\s+/).length > 5) return;
    if (/[?]$/.test(heading)) return;

    const body = $(element).next("p").text().replace(/\s+/g, " ").trim();
    if (body.length < 40 || body.length > 600) return;

    // Only a sentence that actually defines the heading counts.
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^(the\\s+)?${escaped}\\s+(is|are|refers to|means)\\b`, "i").test(body)) {
      return;
    }
    if (seen.has(heading.toLowerCase())) return;
    seen.add(heading.toLowerCase());
    terms.push(toTerm(heading, body));
  });

  return terms.slice(0, 25);
}

function toTerm(term: string, definition: string) {
  return {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.6,
    sourceUrls: [],
    term,
    definition,
  };
}

/* -------------------------------------------------------------- seasonal */

const SEASONAL =
  /\b((?:spring|summer|fall|autumn|winter|holiday|christmas|black friday|new year|memorial day|labor day|back[- ]to[- ]school)\b[^.!?]{0,60}(?:special|savings|sale|offer|promotion|discount|deal|event))/gi;

export function extractSeasonal(text: string) {
  const signals: Array<{
    id: string;
    method: "scraped";
    confidence: number;
    sourceUrls: string[];
    label: string;
    period: string | null;
    text: string;
  }> = [];
  const seen = new Set<string>();

  SEASONAL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SEASONAL.exec(text)) !== null) {
    const label = match[1].replace(/\s+/g, " ").trim();
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const period = label.match(/spring|summer|fall|autumn|winter|holiday|christmas/i);
    signals.push({
      id: newId(),
      method: "scraped",
      confidence: 0.55,
      sourceUrls: [],
      label,
      period: period ? capitalize(period[0]) : null,
      text: label,
    });
    if (signals.length >= 8) break;
  }
  return signals;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/* ------------------------------------------------------------ blog index */

function extractPostLinks($: cheerio.CheerioAPI, pageUrl: string) {
  const posts: Array<ReturnType<typeof toPost>> = [];
  const seen = new Set<string>();

  $("article, [class*='post' i], [class*='entry' i]").each((_, element) => {
    const item = $(element);
    if (item.find("article").length > 0) return;

    const link = item.find("a[href]").first();
    const href = link.attr("href");
    const title =
      item.find("h1, h2, h3, h4").first().text().replace(/\s+/g, " ").trim() ||
      link.text().replace(/\s+/g, " ").trim();
    if (!href || !title || title.length < 8 || title.length > 200) return;

    const url = normalizeUrl(href, pageUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);

    const time = item.find("time").first();
    posts.push(
      toPost({
        title,
        url,
        publishedAt: time.attr("datetime") ?? (time.text().trim() || null),
        excerpt: item.find("p").first().text().replace(/\s+/g, " ").trim() || null,
      }),
    );
  });

  return posts.slice(0, 40);
}

function toPost(input: {
  title: string;
  url: string;
  publishedAt: string | null;
  excerpt: string | null;
}) {
  return {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.65,
    sourceUrls: [],
    title: input.title,
    url: input.url,
    publishedAt: input.publishedAt,
    author: null,
    category: null,
    excerpt: input.excerpt ? input.excerpt.slice(0, 400) : null,
    wordCount: null,
    headings: [],
  };
}
