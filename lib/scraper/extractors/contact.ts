import * as cheerio from "cheerio";
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

/** Page text with script, style, and nav chrome removed. */
export function visibleText($: cheerio.CheerioAPI): string {
  const clone = $.root().clone();
  clone.find("script, style, noscript, template, svg").remove();
  return clone.text().replace(/\s+/g, " ").trim();
}
