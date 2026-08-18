import * as cheerio from "cheerio";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";

/**
 * Third-party vendor fingerprinting from script, iframe, and link hosts.
 *
 * This reproduces the reference output's `Suppliers` field, which is not prose
 * at all — Account IT's list of thirteen (Box.com, Google, Rackspace, DialogTech,
 * Wufoo.com, Sendgrid, Twilio, Plausible, AWS, Yext, MailGun, Bright Local,
 * TransUnion) is a technology fingerprint, and the only way to produce it is a
 * signature table over the hosts a page loads from.
 *
 * It is genuinely useful beyond matching the baseline: knowing a business runs
 * Mailchimp and Calendly tells a content generator which calls to action are
 * actually wired up.
 */

export type VendorSignature = {
  name: string;
  /** Matched against the hostname of every script/iframe/link/img the page loads. */
  hosts: RegExp;
  category:
    | "analytics"
    | "marketing"
    | "email"
    | "forms"
    | "scheduling"
    | "payments"
    | "reviews"
    | "chat"
    | "hosting"
    | "cdn"
    | "crm"
    | "listings"
    | "other";
};

export const VENDOR_SIGNATURES: readonly VendorSignature[] = [
  { name: "Google Analytics", hosts: /google-analytics\.com|googletagmanager\.com/, category: "analytics" },
  { name: "Google", hosts: /(^|\.)(google|gstatic|googleapis|googleusercontent)\.com$/, category: "other" },
  { name: "Google Ads", hosts: /googleadservices\.com|doubleclick\.net/, category: "marketing" },
  { name: "Plausible", hosts: /plausible\.io/, category: "analytics" },
  { name: "Fathom", hosts: /usefathom\.com/, category: "analytics" },
  { name: "Hotjar", hosts: /hotjar\.com/, category: "analytics" },
  { name: "Meta Pixel", hosts: /connect\.facebook\.net/, category: "marketing" },
  { name: "HubSpot", hosts: /hubspot\.com|hs-scripts\.com|hsforms\.(net|com)/, category: "crm" },
  { name: "Salesforce", hosts: /salesforce\.com|force\.com/, category: "crm" },
  { name: "Mailchimp", hosts: /mailchimp\.com|list-manage\.com|chimpstatic\.com/, category: "email" },
  { name: "Sendgrid", hosts: /sendgrid\.(net|com)/, category: "email" },
  { name: "MailGun", hosts: /mailgun\.(net|org|com)/, category: "email" },
  { name: "Klaviyo", hosts: /klaviyo\.com/, category: "email" },
  { name: "Constant Contact", hosts: /constantcontact\.com/, category: "email" },
  { name: "ActiveCampaign", hosts: /activehosted\.com|activecampaign\.com/, category: "email" },
  { name: "Wufoo", hosts: /wufoo\.com/, category: "forms" },
  { name: "Typeform", hosts: /typeform\.com/, category: "forms" },
  { name: "Jotform", hosts: /jotform\.com/, category: "forms" },
  { name: "Gravity Forms", hosts: /gravityforms\.com/, category: "forms" },
  { name: "Calendly", hosts: /calendly\.com/, category: "scheduling" },
  { name: "Acuity Scheduling", hosts: /acuityscheduling\.com/, category: "scheduling" },
  { name: "Housecall Pro", hosts: /housecallpro\.com/, category: "scheduling" },
  { name: "ServiceTitan", hosts: /servicetitan\.com/, category: "scheduling" },
  { name: "Stripe", hosts: /stripe\.(com|network)/, category: "payments" },
  { name: "PayPal", hosts: /paypal(objects)?\.com/, category: "payments" },
  { name: "Square", hosts: /squareup\.com|squarecdn\.com/, category: "payments" },
  { name: "Birdeye", hosts: /birdeye\.com/, category: "reviews" },
  { name: "Trustpilot", hosts: /trustpilot\.com/, category: "reviews" },
  { name: "Yotpo", hosts: /yotpo\.com/, category: "reviews" },
  { name: "Podium", hosts: /podium\.com/, category: "reviews" },
  { name: "NiceJob", hosts: /nicejob\.co/, category: "reviews" },
  { name: "Yelp", hosts: /yelp\.com/, category: "listings" },
  { name: "Yext", hosts: /yext(apis)?\.com/, category: "listings" },
  { name: "Bright Local", hosts: /brightlocal\.com/, category: "listings" },
  { name: "Intercom", hosts: /intercom\.(io|com)/, category: "chat" },
  { name: "Drift", hosts: /drift\.com/, category: "chat" },
  { name: "Tawk.to", hosts: /tawk\.to/, category: "chat" },
  { name: "Zendesk", hosts: /zendesk\.com|zdassets\.com/, category: "chat" },
  { name: "Twilio", hosts: /twilio\.com|twiliocdn\.com/, category: "other" },
  { name: "DialogTech", hosts: /dialogtech\.com/, category: "marketing" },
  { name: "CallRail", hosts: /callrail\.com/, category: "marketing" },
  { name: "Cloudflare", hosts: /cloudflare(insights)?\.com|cdnjs\.cloudflare\.com/, category: "cdn" },
  { name: "Amazon Web Services", hosts: /amazonaws\.com|awsstatic\.com/, category: "hosting" },
  { name: "Rackspace", hosts: /rackspace\.com|rackcdn\.com/, category: "hosting" },
  { name: "Box.com", hosts: /box\.(com|net)/, category: "other" },
  { name: "Dropbox", hosts: /dropbox(static)?\.com/, category: "other" },
  { name: "Vimeo", hosts: /vimeo(cdn)?\.com/, category: "other" },
  { name: "YouTube", hosts: /youtube(-nocookie)?\.com|ytimg\.com/, category: "other" },
  { name: "Wistia", hosts: /wistia\.(com|net)/, category: "other" },
  { name: "TransUnion", hosts: /transunion\.com|tlo\.com/, category: "other" },
  { name: "Elfsight", hosts: /elfsight\.com/, category: "other" },
  { name: "jQuery", hosts: /code\.jquery\.com/, category: "cdn" },
  { name: "WordPress.com", hosts: /wp\.com|wordpress\.com/, category: "hosting" },
  { name: "Wix", hosts: /wix(static|apps)?\.com|parastorage\.com/, category: "hosting" },
  { name: "Squarespace", hosts: /squarespace(-cdn)?\.com/, category: "hosting" },
  { name: "Shopify", hosts: /shopify(cdn|cloud)?\.com/, category: "hosting" },
  { name: "Webflow", hosts: /webflow\.(com|io)/, category: "hosting" },
  { name: "HighLevel", hosts: /gohighlevel\.com|leadconnectorhq\.com/, category: "crm" },
  // Added after reading what the golden sites actually load: each of these was
  // reported as an unrecognised host by its own domain before it had a name.
  { name: "Usercentrics", hosts: /usercentrics\.(eu|com)/, category: "other" },
  { name: "UserWay", hosts: /userway\.org/, category: "other" },
  { name: "jsDelivr", hosts: /jsdelivr\.net/, category: "cdn" },
  { name: "unpkg", hosts: /unpkg\.com/, category: "cdn" },
  { name: "LiveChat", hosts: /livechatinc\.com/, category: "chat" },
  { name: "Popupsmart", hosts: /popupsmart\.com/, category: "marketing" },
  { name: "Diverse Solutions", hosts: /diversesolutions\.com/, category: "listings" },
  { name: "CountingWorks Pro", hosts: /countingworkspro\.com/, category: "hosting" },
  { name: "UI Avatars", hosts: /ui-avatars\.com/, category: "other" },
] as const;

/** Attributes that point at a host we might be loading a third party from. */
const ASSET_SELECTORS = "script[src], iframe[src], link[href], img[src]";

/**
 * Hosts that are never worth reporting as a supplier: the company's own social
 * profiles (already in `onlinePresence`), and hosts that say nothing about who
 * the business buys from.
 */
const NOT_A_SUPPLIER =
  /(^|\.)(facebook|instagram|twitter|x|linkedin|youtube|tiktok|pinterest|reddit|yelp|example)\.(com|org|net)$/;

/**
 * Specification and boilerplate hosts. They were meant to be in the list above
 * and never matched anything: the pattern required a `.com|.org|.net` suffix
 * *after* the alternation, so `w3.org` only matched `w3.org.org`. Every profile
 * carried `Gmpg.org` — a 2003 XFN spec URL in a WordPress `<link rel="profile">`
 * — as a supplier.
 */
const NOT_A_HOST_WORTH_REPORTING = /(^|\.)(w3|schema|gmpg|purl|xmlns|dublincore)\.org$/;

/**
 * Machine-generated hostnames: `ksrndkehqnwntyxlhgto.com`, which a real Bee Cave
 * scrape reported as a supplier. A brand name has vowels; a random string that
 * long does not. Applied only to unrecognised hosts, so a signature match always
 * wins.
 */
function looksMachineGenerated(label: string): boolean {
  if (label.length < 8) return false;
  const vowels = label.replace(/[^aeiouy]/g, "").length;
  return vowels / label.length < 0.25;
}

/** Known-signature hits and unrecognised third-party hosts, kept apart. */
export type VendorHits = { known: string[]; unknown: string[] };

export function detectVendors(html: string, ownDomain: string): string[] {
  const hits = detectVendorHits(html, ownDomain);
  return [...hits.known, ...hits.unknown].sort();
}

export function detectVendorHits(html: string, ownDomain: string): VendorHits {
  const $ = cheerio.load(html);
  const found = new Set<string>();
  const unknownHosts = new Set<string>();

  $(ASSET_SELECTORS).each((_, element) => {
    const raw = $(element).attr("src") ?? $(element).attr("href");
    if (!raw) return;

    let hostname: string;
    try {
      hostname = new URL(raw, "https://placeholder.invalid").hostname.toLowerCase();
    } catch {
      return;
    }
    // Relative URLs resolve to the placeholder; first-party assets aren't vendors.
    if (hostname === "placeholder.invalid") return;
    if (hostname.endsWith(ownDomain)) return;

    const matched = VENDOR_SIGNATURES.filter((signature) => signature.hosts.test(hostname));
    for (const signature of matched) found.add(signature.name);

    // A 60-entry table cannot know every vendor an SMB uses, and the interesting
    // ones are usually the unfamiliar ones — the reference profile for Account
    // IT lists `Wufoo.com` and `DialogTech`, which are exactly this case. An
    // unrecognised third-party host is reported under its own domain rather than
    // dropped, because "we found a vendor we can't name" is still a finding.
    if (
      matched.length === 0 &&
      !NOT_A_SUPPLIER.test(hostname) &&
      !NOT_A_HOST_WORTH_REPORTING.test(hostname)
    ) {
      unknownHosts.add(hostname);
    }
  });

  return {
    known: [...found].sort(),
    unknown: unknownVendorNames(unknownHosts).filter((name) => !found.has(name)).sort(),
  };
}

/** Registrable-ish domain, title-cased: `cdn.userway.org` → `Userway.org`. */
function unknownVendorNames(hosts: Set<string>): string[] {
  const names = new Set<string>();

  for (const host of hosts) {
    const parts = host.replace(/^www\./, "").split(".");
    const domain = parts.slice(-2).join(".");
    if (domain.length < 5) continue;
    if (looksMachineGenerated(parts.at(-2) ?? "")) continue;
    names.add(domain.charAt(0).toUpperCase() + domain.slice(1));
  }

  return [...names].slice(0, 15);
}

export function extractVendors(page: PageInput, site: SiteContext): Evidence[] {
  const hits = detectVendorHits(page.html, site.domain);

  return [
    ...hits.known.map((vendor) =>
      evidence("market.suppliersPartners", vendor, "dom", page, { confidence: 0.8 }),
    ),
    // Named by their domain rather than recognised, so they carry the lower
    // confidence that earns — the host is certain, the relationship is not.
    ...hits.unknown.map((vendor) =>
      evidence("market.suppliersPartners", vendor, "heuristic", page, {
        confidence: 0.45,
        note: "Third-party host loaded by the site; not in the known-vendor table",
      }),
    ),
  ];
}
