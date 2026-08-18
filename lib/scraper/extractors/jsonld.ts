import * as cheerio from "cheerio";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";
import { newId } from "@/lib/schema";
import { normalizeUrl } from "@/lib/utils/url";

/**
 * schema.org JSON-LD — by a wide margin the highest-leverage extractor.
 *
 * Six of the seven captured golden sites emit it, five of them on every page,
 * and it supplies name, address, phone, email, logo, socials, founding date,
 * people, offerings, reviews, ratings and FAQs in one pass with no heuristics at
 * all. Everything else in `extractors/` exists to cover the seventh site and the
 * gaps in the other six.
 */

type Node = Record<string, unknown>;

/** Every object in the document's `@graph`, flattened and indexed by `@id`. */
export type JsonLdGraph = {
  nodes: Node[];
  byId: Map<string, Node>;
};

export function parseJsonLd(html: string): JsonLdGraph {
  const $ = cheerio.load(html);
  const nodes: Node[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim();
    if (!raw) return;
    try {
      collect(JSON.parse(raw) as unknown, nodes);
    } catch {
      // Malformed JSON-LD is common on SMB sites and is never worth failing a
      // page over — the other extractors still run.
    }
  });

  const byId = new Map<string, Node>();
  for (const node of nodes) {
    const id = str(node["@id"]);
    if (id && !byId.has(id)) byId.set(id, node);
  }

  return { nodes, byId };
}

function collect(value: unknown, out: Node[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;

  const node = value as Node;
  if (node["@type"]) out.push(node);
  for (const key of Object.keys(node)) {
    if (key === "@type") continue;
    collect(node[key], out);
  }
}

/* ------------------------------------------------------------- accessors */

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function arr(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function types(node: Node): string[] {
  return arr(node["@type"]).flatMap((type) => (typeof type === "string" ? [type] : []));
}

function hasType(node: Node, ...wanted: string[]): boolean {
  const own = types(node);
  return wanted.some((type) => own.includes(type));
}

/**
 * Resolves a `{ "@id": "…" }` reference against the graph.
 *
 * Yoast and Rank Math — which between them generate most of this markup — split
 * everything into `@id`-linked nodes, so a Review's `author` is usually a
 * reference rather than an inline object.
 */
function deref(value: unknown, graph: JsonLdGraph): Node | null {
  const node = arr(value)[0];
  if (!node || typeof node !== "object") return null;

  const record = node as Node;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === "@id") {
    const id = str(record["@id"]);
    return id ? (graph.byId.get(id) ?? null) : null;
  }
  return record;
}

/**
 * Business-like types we treat as "this is the company". `Organization` is the
 * base, but SMB sites usually emit a specific subtype instead —
 * `HomeAndConstructionBusiness`, `AccountingService`, `RealEstateAgent` — and
 * many of schema.org's `LocalBusiness` subtypes that do not end in a recognisable
 * suffix. A site that declares `"@type": "Plumber"` has said it is a business
 * as clearly as one that says `LocalBusiness`, and missing them means missing
 * every field on the node.
 */
const BUSINESS_TYPES = new Set([
  "Organization","Corporation","LocalBusiness","NGO","Airline","Consortium",
  "Plumber","Electrician","Locksmith","Roofing","RoofingContractor","HVACBusiness",
  "GeneralContractor","HousePainter","MovingCompany","Dentist","Physician",
  "MedicalClinic","Optician","Pharmacy","VeterinaryCare","LegalService","Attorney",
  "Notary","AccountingService","InsuranceAgency","FinancialService","RealEstateAgent",
  "TravelAgency","AutoRepair","AutoDealer","AutoBodyShop","GasStation","Restaurant",
  "Bakery","CafeOrCoffeeShop","BarOrPub","Hotel","Motel","Campground","Winery",
  "Brewery","Distillery","BeautySalon","HairSalon","NailSalon","DaySpa","TattooParlor",
  "HealthClub","SportsClub","Gym","ChildCare","Preschool","School","Library","Museum",
  "Church","Casino","Florist","Bookstore","ClothingStore","GroceryStore","HardwareStore",
  "PetStore","FurnitureStore","JewelryStore","Photographer","EventVenue","SelfStorage",
  "Landscaper","PestControl","WasteManagement","SecurityService","Emergency",
]);

function isBusiness(node: Node): boolean {
  return types(node).some(
    (type) =>
      BUSINESS_TYPES.has(type) ||
      /Business$|Service$|Agent$|Store$|Shop$|Agency$|Practice$|Contractor$|Company$/.test(type),
  );
}

/* ------------------------------------------------------------- extraction */

export function extractJsonLd(page: PageInput, site: SiteContext): Evidence[] {
  const graph = parseJsonLd(page.html);
  if (graph.nodes.length === 0) return [];

  const out: Evidence[] = [];
  const add = <T,>(path: string, value: T, options?: { confidence?: number; note?: string }) =>
    out.push(evidence(path, value, "json-ld", page, options));

  const business = graph.nodes.find(isBusiness);
  if (business) extractBusiness(business, graph, add, site);

  const bylines = articleAuthorIds(graph);

  for (const node of graph.nodes) {
    if (hasType(node, "Person")) extractPerson(node, graph, add, bylines);
    if (hasType(node, "Product", "Service", "Offer")) extractOffering(node, graph, add);
    if (hasType(node, "Review")) extractReview(node, graph, add);
    if (hasType(node, "AggregateRating")) extractRating(node, graph, add, page.url);
    if (hasType(node, "Question")) extractFaq(node, graph, add);
    if (hasType(node, "BlogPosting", "Article", "NewsArticle")) extractPost(node, add);
  }

  return out;
}

type Add = <T>(path: string, value: T, options?: { confidence?: number; note?: string }) => void;

function extractBusiness(
  node: Node,
  graph: JsonLdGraph,
  add: Add,
  site: SiteContext,
): void {
  const name = str(node.name);
  if (name) add("companyName", name);

  const industry = industryFromType(node);
  if (industry) add("foundation.industry", industry, { confidence: 0.8 });

  const url = str(node.url);
  if (url) add("foundation.website", normalizeUrl(url) ?? url);

  const phone = str(node.telephone);
  if (phone) add("foundation.phone", phone);

  const email = str(node.email)?.replace(/^mailto:/i, "");
  if (email) add("foundation.email", email);

  const founded = str(node.foundingDate);
  if (founded) {
    const year = Number(founded.slice(0, 4));
    // Tier 1 of the fallback chain in docs/DATA-QUALITY.md §3.
    if (year >= 1600 && year <= new Date().getFullYear()) {
      add("foundation.yearFounded", year);
    }
  }

  const employees = num(deref(node.numberOfEmployees, graph)?.value ?? node.numberOfEmployees);
  if (employees !== null && employees > 0) {
    add("foundation.employeeCount", Math.round(employees));
  }

  const description = str(node.description);
  if (description && description.length > 40) {
    // A meta-style description is a weak overview: usually SEO copy rather than
    // a real summary. It seeds enrichment rather than standing as the answer.
    add("foundation.overview", description, { confidence: 0.55 });
  }

  const address = deref(node.address, graph);
  if (address) {
    const formatted = formatAddress(address);
    if (formatted) {
      add("foundation.mainAddress", {
        formatted,
        street: str(address.streetAddress),
        city: str(address.addressLocality),
        region: str(address.addressRegion),
        postalCode: str(address.postalCode),
        country: str(address.addressCountry),
      });
    }
  }

  const logo = deref(node.logo, graph) ?? { url: node.logo };
  const logoUrl = str(logo.contentUrl) ?? str(logo.url) ?? str(node.logo);
  if (logoUrl) {
    add("branding.logos", {
      id: newId(),
      method: "scraped" as const,
      confidence: 0.95,
      sourceUrls: [],
      url: normalizeUrl(logoUrl) ?? logoUrl,
      alt: str(logo.caption) ?? name,
      kind: "logo" as const,
      width: num(logo.width),
      height: num(logo.height),
    });
  }

  // `sameAs` is the single best source of social profiles — tier 1 of the
  // socials chain in docs/DATA-QUALITY.md §3.
  for (const raw of arr(node.sameAs)) {
    const href = str(raw);
    if (!href) continue;
    const profile = toSocialProfile(href, site);
    if (profile) add("onlinePresence.profiles", profile);
  }

  for (const raw of arr(node.areaServed)) {
    const area = typeof raw === "string" ? raw : str((raw as Node)?.name);
    if (area) add("foundation.serviceLocations", area);
  }

  const alt = str(node.alternateName) ?? str(node.legalName);
  if (alt && alt !== name) add("foundation.altNames", alt);

  const legal = str(node.legalName) ?? name;
  const entity = legal?.match(/\b(LLC|L\.L\.C\.|Inc\.?|Incorporated|Ltd\.?|Corp\.?|Corporation|LLP|PLLC|P\.?C\.?|P\.?A\.?)\b\s*$/i);
  if (entity) {
    add("foundation.legalEntityType", entity[1].replace(/\.$/, ""), { confidence: 0.7 });
  }
}

/**
 * Industry from the schema.org type.
 *
 * `Industry` appears in all eight reference profiles and no extractor produces
 * it from prose without guessing — but a site that declares
 * `"@type": "WellDrillingBusiness"` has stated its industry in machine-readable
 * form, and schema.org's `LocalBusiness` subtypes are exactly a trade taxonomy.
 * The generic parents carry no information, so they are skipped rather than
 * reported as "Local Business".
 */
const GENERIC_TYPES = new Set([
  "Organization",
  "Corporation",
  "LocalBusiness",
  "ProfessionalService",
  "Service",
  "Store",
  "Thing",
]);

function industryFromType(node: Node): string | null {
  const specific = types(node).find((type) => !GENERIC_TYPES.has(type));
  if (!specific) return null;

  const words = specific
    // "HVACBusiness" → "HVAC Business"; "GeneralContractor" → "General Contractor".
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\bBusiness\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return words.length >= 3 ? words : null;
}

function formatAddress(address: Node): string | null {
  const parts = [
    str(address.streetAddress),
    str(address.addressLocality),
    [str(address.addressRegion), str(address.postalCode)].filter(Boolean).join(" ") || null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

const SOCIAL_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)facebook\.com$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(twitter|x)\.com$/, "x"],
  [/(^|\.)youtube\.com$/, "youtube"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)pinterest\.com$/, "pinterest"],
  [/(^|\.)yelp\.com$/, "yelp"],
  [/(^|\.)(g\.page|business\.google\.com)$/, "google-business"],
];

export function toSocialProfile(href: string, site: SiteContext) {
  const normalized = normalizeUrl(href);
  if (!normalized) return null;

  let hostname: string;
  try {
    hostname = new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (hostname.endsWith(site.domain)) return null;

  const match = SOCIAL_HOSTS.find(([pattern]) => pattern.test(hostname));
  if (!match) return null;

  const handle = new URL(normalized).pathname.split("/").filter(Boolean).pop() ?? null;
  return {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.9,
    sourceUrls: [],
    platform: match[1] as
      | "linkedin"
      | "facebook"
      | "instagram"
      | "x"
      | "youtube"
      | "tiktok"
      | "pinterest"
      | "yelp"
      | "google-business",
    url: normalized,
    handle,
  };
}

/**
 * `@id`s the graph names as the author of an article.
 *
 * WordPress gives every blog author a full `Person` node with a Gravatar and a
 * biography, which is indistinguishable from a staff profile until you notice
 * what points at it. A real scrape of Planet Orange listed the writer of "Pests
 * in My House? Not on My Watch!" as one of the company's key people.
 */
function articleAuthorIds(graph: JsonLdGraph): Set<string> {
  const ids = new Set<string>();

  for (const node of graph.nodes) {
    if (!hasType(node, "BlogPosting", "Article", "NewsArticle", "WebPage")) continue;
    for (const reference of arr(node.author)) {
      const id = str((reference as Node)?.["@id"]);
      if (id) ids.add(id);
    }
  }

  return ids;
}

function extractPerson(
  node: Node,
  graph: JsonLdGraph,
  add: Add,
  bylines: Set<string> = new Set(),
): void {
  const name = str(node.name);
  // Review authors come through as Person nodes too. They're real people worth
  // keeping, but they belong to the testimonial, not to the company's staff —
  // the review extractor links them, so skip the bare ones here.
  if (!name || name.length > 60) return;
  if (!node.jobTitle && !node.description && !node.worksFor && !node.image) return;

  const id = str(node["@id"]);
  if (id && bylines.has(id)) return;
  // The author archive is the other tell: `/author/aidan/` is a byline page,
  // never a staff profile.
  if (/\/author\//i.test(str(node.url) ?? "")) return;
  // WordPress emits its post authors as `Person`, so the graph is full of login
  // handles — `webdev@drivinglocalleads.com`, `christy23424232hey`. A CMS
  // account is not a member of staff, and publishing one as a "key person"
  // would put an internal username in front of a customer.
  if (!looksLikePersonName(name)) return;

  add("people", {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.9,
    sourceUrls: [],
    name,
    title: str(node.jobTitle),
    role: null,
    gender: null,
    bio: str(node.description),
    email: str(node.email)?.replace(/^mailto:/i, "") ?? null,
    phone: str(node.telephone),
    imageUrl: str(deref(node.image, graph)?.url) ?? str(node.image),
    profileUrl: str(node.url),
    linkedin:
      arr(node.sameAs)
        .map(str)
        .find((href) => href?.includes("linkedin.com")) ?? null,
  });
}

/** A human name: capitalised words, no digits, no `@`, no URL fragments. */
function looksLikePersonName(name: string): boolean {
  if (/[@\d_/\\]/.test(name)) return false;
  return /^[A-Z][\p{L}.'’-]*(?:\s+[A-Z][\p{L}.'’-]*){0,4}$/u.test(name.trim());
}

function extractOffering(node: Node, graph: JsonLdGraph, add: Add): void {
  const name = str(node.name);
  if (!name) return;

  const offer = deref(node.offers, graph);
  const price = offer ? (str(offer.price) ?? str(offer.priceSpecification)) : null;
  const currency = offer ? str(offer.priceCurrency) : null;

  add("offerings", {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.9,
    sourceUrls: [],
    name,
    category: null,
    description: str(node.description),
    features: arr(node.additionalProperty)
      .map((property) => {
        const record = property as Node;
        const label = str(record.name);
        const value = str(record.value);
        return label && value ? `${label}: ${value}` : (label ?? value);
      })
      .filter((feature): feature is string => Boolean(feature)),
    // Copied verbatim, never estimated — see prompts/02-offering-normalization.md.
    pricing: price ? [currency, price].filter(Boolean).join(" ") : null,
    url: str(node.url),
    sourceCandidateIndexes: [],
  });

  const rating = deref(node.aggregateRating, graph);
  if (rating) {
    const value = num(rating.ratingValue);
    if (value !== null) {
      add("proof.aggregateRatings", {
        id: newId(),
        method: "scraped" as const,
        confidence: 0.9,
        sourceUrls: [],
        platform: name,
        ratingValue: value,
        bestRating: num(rating.bestRating),
        reviewCount: num(rating.reviewCount) ?? num(rating.ratingCount),
      });
    }
  }
}

function extractReview(node: Node, graph: JsonLdGraph, add: Add): void {
  const quote = str(node.reviewBody) ?? str(node.description);
  if (!quote || quote.length < 20) return;

  const author = deref(node.author, graph);
  const rating = deref(node.reviewRating, graph);

  add("proof.testimonials", {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.95,
    sourceUrls: [],
    quote,
    authorName: author ? str(author.name) : null,
    authorRole: author ? str(author.jobTitle) : null,
    authorCompany: author ? str(deref(author.worksFor, graph)?.name) : null,
    authorLocation: null,
    rating: rating ? num(rating.ratingValue) : null,
    date: str(node.datePublished),
    platform: str(deref(node.publisher, graph)?.name),
    mediaUrl: null,
    topics: [],
    mentionsPeople: [],
    mentionsOfferings: [],
  });
}

function extractRating(node: Node, graph: JsonLdGraph, add: Add, pageUrl: string): void {
  const value = num(node.ratingValue);
  if (value === null) return;

  add("proof.aggregateRatings", {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.95,
    sourceUrls: [],
    platform: str(deref(node.itemReviewed, graph)?.name) ?? hostOf(pageUrl),
    ratingValue: value,
    bestRating: num(node.bestRating),
    reviewCount: num(node.reviewCount) ?? num(node.ratingCount),
  });
}

function extractFaq(node: Node, graph: JsonLdGraph, add: Add): void {
  const question = str(node.name) ?? str(node.text);
  const answerNode = deref(node.acceptedAnswer, graph) ?? deref(node.suggestedAnswer, graph);
  const answer = answerNode ? (str(answerNode.text) ?? str(answerNode.name)) : null;
  if (!question || !answer) return;

  add("contentIntelligence.faqs", {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.95,
    sourceUrls: [],
    question: stripTags(question),
    answer: stripTags(answer),
    topic: null,
  });
}

function extractPost(node: Node, add: Add): void {
  const title = str(node.headline) ?? str(node.name);
  const url = str(node.url) ?? str(node.mainEntityOfPage);
  if (!title || !url) return;

  add("contentIntelligence.posts", {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.9,
    sourceUrls: [],
    title,
    url: normalizeUrl(url) ?? url,
    publishedAt: str(node.datePublished),
    author: str((arr(node.author)[0] as Node)?.name),
    category: str(node.articleSection),
    excerpt: str(node.description),
    wordCount: num(node.wordCount),
    headings: [],
  });
}

/** JSON-LD answers routinely contain HTML. */
function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
