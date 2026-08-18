import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";
import { toSocialProfile } from "./jsonld";

/**
 * Phone, email, address, and social links from the DOM.
 *
 * Tiers 2–3 of the fallback chains in docs/DATA-QUALITY.md §3: `tel:`/`mailto:`
 * links first because they are explicit markup, then regex over the visible text
 * of the contact page and footer.
 */

const PHONE_TEXT =
  /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const EMAIL_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Addresses on SMB sites are almost always `street, city, ST 12345`. */
const US_ADDRESS =
  /\d{1,6}\s+[A-Za-z0-9.'\- ]{2,40}(?:\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Hwy|Highway|Pkwy|Parkway|Cir|Circle|Ste|Suite|Unit|#)\b[A-Za-z0-9.'\- ]{0,30})?,?\s+[A-Za-z .'-]{2,30},?\s+(?:A[LKZR]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\s+\d{5}(?:-\d{4})?/g;

/** Marketing numbers that regex will happily mistake for a phone number. */
const FALSE_PHONE = /^(?:1{7,}|0{7,}|1234567890|\d{4}[- ]?\d{2}[- ]?\d{2})$/;

export function extractContact(page: PageInput, site: SiteContext): Evidence[] {
  const $ = cheerio.load(page.html);
  const out: Evidence[] = [];

  /* ------------------------------------------------------------- phone */

  const telHrefs = new Set<string>();
  $('a[href^="tel:"]').each((_, element) => {
    const raw = $(element).attr("href")?.replace(/^tel:/i, "").trim();
    const normalized = raw ? normalizePhone(raw) : null;
    if (normalized) telHrefs.add(normalized);
  });

  for (const phone of telHrefs) {
    out.push(evidence("foundation.phone", phone, "dom", page, { confidence: 0.85 }));
  }

  if (telHrefs.size === 0) {
    const text = visibleText($);
    const seen = new Set<string>();
    for (const match of text.match(PHONE_TEXT) ?? []) {
      const normalized = normalizePhone(match);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(
        evidence("foundation.phone", normalized, "heuristic", page, {
          confidence: 0.55,
        }),
      );
    }
  }

  /* ------------------------------------------------------------- email */

  const mailtos = new Set<string>();
  $('a[href^="mailto:"]').each((_, element) => {
    const raw = $(element)
      .attr("href")
      ?.replace(/^mailto:/i, "")
      .split("?")[0]
      .trim()
      .toLowerCase();
    if (raw && EMAIL_TEXT.test(raw)) mailtos.add(raw);
    EMAIL_TEXT.lastIndex = 0;
  });

  for (const email of mailtos) {
    if (isJunkEmail(email)) continue;
    out.push(evidence("foundation.email", email, "dom", page, { confidence: 0.85 }));
  }

  if (mailtos.size === 0) {
    const found = new Set(
      (visibleText($).match(EMAIL_TEXT) ?? []).map((email) => email.toLowerCase()),
    );
    for (const email of found) {
      if (isJunkEmail(email)) continue;
      out.push(
        evidence("foundation.email", email, "heuristic", page, { confidence: 0.5 }),
      );
    }
  }

  /* ----------------------------------------------------------- address */

  const addresses = new Set<string>();
  $("address").each((_, element) => {
    const text = $(element).text().replace(/\s+/g, " ").trim();
    if (text.length > 10 && text.length < 200) addresses.add(text);
  });

  for (const formatted of addresses) {
    out.push(
      evidence(
        "foundation.mainAddress",
        { formatted, street: null, city: null, region: null, postalCode: null, country: null },
        "dom",
        page,
        { confidence: 0.7 },
      ),
    );
  }

  if (addresses.size === 0) {
    const found = new Set(
      (visibleText($).match(US_ADDRESS) ?? []).map((address) =>
        address.replace(/\s+/g, " ").trim(),
      ),
    );
    for (const formatted of found) {
      out.push(
        evidence(
          "foundation.mainAddress",
          parseUsAddress(formatted),
          "heuristic",
          page,
          { confidence: 0.5 },
        ),
      );
    }
  }

  /* ---------------------------------------------------------- socials */

  const socialHrefs = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (href) socialHrefs.add(href);
  });

  const claimed = new Set<string>();
  for (const href of socialHrefs) {
    const profile = toSocialProfile(href, site);
    if (!profile) continue;
    // A site links its own Facebook page from every footer; one claim is enough.
    if (claimed.has(profile.url)) continue;
    claimed.add(profile.url);
    out.push(
      evidence("onlinePresence.profiles", profile, "dom", page, { confidence: 0.8 }),
    );
  }

  return out;
}

/** `(512) 273-7389` and `512.273.7389` are the same number. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) return null;
  if (FALSE_PHONE.test(digits)) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Placeholder and third-party addresses that appear in template markup. */
function isJunkEmail(email: string): boolean {
  return (
    /(example|test|your|domain|email|sentry|wixpress|sample)\.(com|org|net)$/i.test(email) ||
    /^(user|name|youremail|info@example)/i.test(email) ||
    /\.(png|jpe?g|gif|webp|svg)$/i.test(email)
  );
}

export function parseUsAddress(formatted: string) {
  const match = formatted.match(
    /^(.*?),?\s*([A-Za-z .'-]{2,30}),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/,
  );
  return {
    formatted,
    street: match ? match[1].trim() || null : null,
    city: match ? match[2].trim() : null,
    region: match ? match[3] : null,
    postalCode: match ? match[4] : null,
    country: null,
  };
}

/**
 * Elements whose edges are word boundaries when the page is read aloud.
 *
 * Inline formatting (`b`, `em`, `span`) is deliberately absent: those sit
 * *inside* a word often enough — `<b>Bee</b>Cave` — that separating them would
 * invent spaces that aren't there.
 */
const TEXT_BOUNDARY = [
  "address", "article", "aside", "blockquote", "br", "button", "dd", "div",
  "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
  "h3", "h4", "h5", "h6", "header", "hr", "label", "li", "main", "nav", "ol",
  "option", "p", "pre", "section", "table", "td", "tfoot", "th", "thead", "tr",
  "ul", "a",
].join(", ");

/**
 * Page text with script, style, and nav chrome removed.
 *
 * `.text()` concatenates the DOM's text nodes with nothing between them, so a
 * footer reading `…All Rights Reserved</p><a>Privacy Policy</a>` came out as
 * "All Rights ReservedPrivacy Policy" — which is how a company's registered name
 * ended up with a menu item welded to the end of it, and how any regex anchored
 * on `\b` silently stops matching. Every consumer of this function was reading
 * text with words fused across element boundaries; inserting the boundary here
 * fixes all of them at once.
 */
export function visibleText($: cheerio.CheerioAPI): string {
  return readableText($.root());
}

/**
 * The same treatment for one part of a page — a footer, a card, a section.
 *
 * Anything reading `.text()` off a selection has the fusing problem too, so
 * callers take this instead.
 */
export function readableText(node: cheerio.Cheerio<AnyNode>): string {
  const clone = node.clone();
  clone.find("script, style, noscript, template, svg").remove();
  clone.find(TEXT_BOUNDARY).before(" ").after(" ");
  return clone.text().replace(/\s+/g, " ").trim();
}
