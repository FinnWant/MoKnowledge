import { err, ok, scrapeError, type Result, type ScrapeError } from "./errors";
import { isSameSite } from "@/lib/utils/url";

/**
 * A single polite, budgeted HTTP fetch.
 *
 * The etiquette rules in docs/VALIDATION.md §5 are enforced here rather than left
 * to the caller: these are real small businesses, not test targets.
 */

export const USER_AGENT =
  "MoKnowledgeBot/0.1 (+https://github.com/moknowledge; knowledge-base builder; contact via repository)";

export const DEFAULT_TIMEOUT_MS = 10_000;
/** Responses beyond this are almost always a file we mis-identified as a page. */
export const MAX_RESPONSE_BYTES = 2_000_000;

export type FetchedPage = {
  /** The URL after redirects, normalized by the caller. */
  url: string;
  requestedUrl: string;
  status: number;
  html: string;
  bytes: number;
  contentType: string;
  fetchedAt: string;
};

export type FetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  /** Rejects a redirect that leaves the registrable domain. */
  originUrl?: string;
  signal?: AbortSignal;
};

/** Cloudflare and friends answer with 403/503 plus a recognisable body. */
function looksLikeBotChallenge(status: number, html: string): boolean {
  if (status !== 403 && status !== 503 && status !== 429) return false;
  return /cf-browser-verification|challenge-platform|Just a moment|Attention Required|captcha/i.test(
    html.slice(0, 4000),
  );
}

export async function fetchPage(
  url: string,
  options: FetchOptions = {},
): Promise<Result<FetchedPage, ScrapeError>> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = MAX_RESPONSE_BYTES,
    originUrl,
    signal,
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    // `response.url` is empty for some runtimes and for synthetic responses.
    // Falling back to the requested URL matters: an empty string fails the
    // same-site check, which would report every page as an offsite redirect.
    const finalUrl = response.url || url;

    if (originUrl && !isSameSite(finalUrl, originUrl)) {
      return err(
        scrapeError(
          "offsite-redirect",
          url,
          `${url} redirects to ${new URL(finalUrl).hostname}, which is a different site. We stopped there.`,
        ),
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > maxBytes) {
      return err(
        scrapeError(
          "too-large",
          url,
          `${url} is larger than we read (${Math.round(declaredLength / 1024)} KB). We skipped it.`,
        ),
      );
    }

    const body = await readCapped(response, maxBytes);
    if (!body.ok) return body;
    const html = body.value;

    if (looksLikeBotChallenge(response.status, html)) {
      return err(
        scrapeError(
          "bot-challenge",
          url,
          "This site uses bot protection that blocked our reader. We couldn't read it.",
          { status: response.status },
        ),
      );
    }

    if (!response.ok) {
      return err(
        scrapeError(
          "http-error",
          url,
          `${url} responded with ${response.status}. Everything else scraped fine.`,
          { status: response.status, retryable: response.status >= 500 },
        ),
      );
    }

    // Checked after the status so a 404 reports as a 404 rather than "not HTML".
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
      return err(
        scrapeError(
          "non-html",
          url,
          `${url} isn't a web page (${contentType.split(";")[0]}). We skipped it.`,
        ),
      );
    }

    return ok({
      url: finalUrl,
      requestedUrl: url,
      status: response.status,
      html,
      bytes: Buffer.byteLength(html),
      contentType,
      fetchedAt: new Date().toISOString(),
    });
  } catch (cause) {
    return err(describeFetchFailure(url, cause));
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Reads the body but stops at `maxBytes` instead of buffering whatever arrives.
 * `content-length` is advisory and frequently absent, so the cap has to be
 * enforced while streaming.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Result<string, ScrapeError>> {
  const reader = response.body?.getReader();
  if (!reader) return ok(await response.text());

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return err(
        scrapeError(
          "too-large",
          response.url,
          `${response.url} is larger than we read. We skipped it.`,
        ),
      );
    }
    chunks.push(value);
  }

  return ok(new TextDecoder("utf-8").decode(Buffer.concat(chunks)));
}

function describeFetchFailure(url: string, cause: unknown): ScrapeError {
  const error = cause as { name?: string; code?: string; cause?: { code?: string } };
  const code = error?.code ?? error?.cause?.code;

  if (error?.name === "AbortError") {
    return scrapeError("timeout", url, `${url} didn't respond in time.`, {
      retryable: true,
    });
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return scrapeError(
      "dns",
      url,
      `We couldn't find ${safeHostname(url)}. Check the address is right.`,
    );
  }
  if (code === "ECONNREFUSED" || code === "ECONNRESET") {
    return scrapeError("network", url, `${safeHostname(url)} refused the connection.`, {
      retryable: true,
    });
  }
  return scrapeError("network", url, `We couldn't reach ${url}.`, {
    retryable: true,
  });
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Serialises requests to one host at a minimum interval.
 *
 * Concurrency in the crawler is across the budget, not across a single host —
 * four parallel connections to one small business's shared hosting is rude and
 * risks looking like an attack.
 */
export class HostRateLimiter {
  private nextAvailableAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const readyAt = Math.max(now, this.nextAvailableAt);
    this.nextAvailableAt = readyAt + this.minIntervalMs;
    const delay = readyAt - now;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
