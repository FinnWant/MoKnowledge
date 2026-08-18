import type { ScrapeWarning, WarningCode } from "@/lib/schema";

/**
 * Typed results instead of thrown exceptions.
 *
 * ROADMAP §3.2: a failure must never cross a boundary as a throw, because a
 * half-scraped knowledge base is still valuable. One dead page should cost us
 * that page, not the run — so every fetch returns a `Result` the crawler folds
 * into a warning and carries on.
 */
export type Result<T, E = ScrapeError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export type ScrapeErrorKind =
  | "dns"
  | "timeout"
  | "http-error"
  | "too-large"
  | "non-html"
  | "robots-disallow"
  | "offsite-redirect"
  | "bot-challenge"
  | "network"
  | "invalid-url"
  | "blocked-address";

export type ScrapeError = {
  kind: ScrapeErrorKind;
  url: string;
  /** Already written for a non-technical reader; the UI renders it verbatim. */
  message: string;
  status?: number;
  /** Whether one retry is worth attempting. */
  retryable: boolean;
};

export function scrapeError(
  kind: ScrapeErrorKind,
  url: string,
  message: string,
  extra: { status?: number; retryable?: boolean } = {},
): ScrapeError {
  return {
    kind,
    url,
    message,
    status: extra.status,
    retryable: extra.retryable ?? false,
  };
}

const WARNING_FOR_KIND: Record<ScrapeErrorKind, WarningCode> = {
  dns: "fetch-failed",
  timeout: "fetch-failed",
  "http-error": "fetch-failed",
  "too-large": "fetch-failed",
  "non-html": "non-html",
  "robots-disallow": "robots-disallow",
  "offsite-redirect": "redirect-offsite",
  "bot-challenge": "bot-challenge",
  network: "fetch-failed",
  "invalid-url": "fetch-failed",
  // No warning code of its own: `warningCodeSchema` is part of the saved
  // document, and a knowledge base is never produced from a blocked address —
  // the scrape is refused before it starts. This mapping only exists for a link
  // discovered mid-crawl, where it is one skipped page like any other.
  "blocked-address": "fetch-failed",
};

/**
 * Turns an error into the user-facing warning that ships with the knowledge base.
 * Every failure mode in docs/DATA-QUALITY.md §7 reaches the user this way rather
 * than as a generic "something went wrong".
 */
export function toWarning(error: ScrapeError): ScrapeWarning {
  return {
    code: WARNING_FOR_KIND[error.kind],
    message: error.message,
    url: error.url,
  };
}
