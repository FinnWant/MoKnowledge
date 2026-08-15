/**
 * URL normalization and same-site checks for the crawler.
 *
 * Getting this wrong is the classic scraper failure: without normalization a
 * crawl budget of 20 pages gets spent on `/about`, `/about/`, `/About/`, and
 * `/about?utm_source=google` — four fetches of one page.
 */

/**
 * Query parameters that never change the page. Stripped so tracking-tagged links
 * in a nav or footer don't fork the crawl.
 */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "_ga",
  "_gl",
  "hsa_acc",
  "hsa_cam",
]);

/**
 * Two-part public suffixes common enough to matter for SMB sites.
 *
 * A full Public Suffix List is ~15k entries and a dependency; this covers the
 * cases we actually hit and errs toward treating an unknown suffix as one label,
 * which at worst keeps the crawl narrower than necessary.
 */
const MULTIPART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "co.nz",
  "co.za",
  "com.au",
  "net.au",
  "org.au",
  "com.br",
  "com.mx",
  "co.in",
  "co.jp",
  "com.sg",
]);

/** Non-HTML endpoints that a nav or footer will happily link to. */
const NON_HTML_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|mp4|webm|mov|mp3|wav|zip|gz|tar|dmg|exe|css|js|json|xml|rss|woff2?|ttf|eot)$/i;

/**
 * Canonical form of a URL, or `null` if it isn't an http(s) page we should fetch.
 *
 * - adds `https://` when the scheme is missing (users type `example.com`)
 * - lowercases scheme and host, drops `www.`
 * - drops the fragment, default ports, and tracking parameters
 * - sorts remaining query parameters so ordering can't create duplicates
 * - removes a trailing slash except at the root
 */
export function normalizeUrl(input: string, base?: string): string | null {
  const raw = input.trim();
  if (raw.length === 0) return null;
  if (/^(mailto|tel|javascript|data|sms):/i.test(raw)) return null;

  let url: URL;
  try {
    if (base) {
      url = new URL(raw, base);
    } else {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    }
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  for (const [param, value] of [...url.searchParams.entries()]) {
    // An empty-valued parameter never selects content — it's a theme or plugin
    // artifact. Divi emits `?et_blog=` on every archive link, which cost a real
    // golden site three of its twenty budget slots on duplicate pages.
    if (value === "" || TRACKING_PARAMS.has(param.toLowerCase())) {
      url.searchParams.delete(param);
    }
  }
  url.searchParams.sort();

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

/** The registrable domain (`beecavedrilling.com` from `www.beecavedrilling.com`). */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const labels = host.split(".");
  if (labels.length <= 2) return host;

  const lastTwo = labels.slice(-2).join(".");
  const take = MULTIPART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/**
 * Whether two URLs share a registrable domain. Subdomains count as the same site,
 * so a crawl follows `blog.example.com` — that is often where the content lives.
 */
export function isSameSite(a: string, b: string): boolean {
  try {
    return (
      registrableDomain(new URL(a).hostname) ===
      registrableDomain(new URL(b).hostname)
    );
  } catch {
    return false;
  }
}

/** Filters out links that clearly aren't crawlable HTML pages. */
export function looksLikeHtmlPage(url: string): boolean {
  try {
    return !NON_HTML_EXTENSIONS.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Filesystem-safe slug for a site, used to name fixture directories. */
export function siteSlug(url: string): string {
  try {
    return registrableDomain(new URL(url).hostname).replace(/[^a-z0-9]+/g, "-");
  } catch {
    return "unknown-site";
  }
}

/** Stable, readable filename for one snapshotted page inside a fixture directory. */
export function pageSlug(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    const base = `${pathname}${search}`
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    return (base || "index").slice(0, 80);
  } catch {
    return "index";
  }
}
