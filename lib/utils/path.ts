/**
 * Dot-path access into the knowledge base.
 *
 * Fields are addressed by path (`foundation.yearFounded`, `people.3.title`) so the
 * completeness scorer and the edit reducer stay generic across ~10 categories
 * instead of growing a case per field — see docs/EDIT-UX.md §3.
 */

export type PathSegment = string | number;

export function parsePath(path: string): PathSegment[] {
  return path
    .split(".")
    .filter((segment) => segment.length > 0)
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

/** Reads a value at `path`, or `undefined` if any segment is missing. */
export function getPath(root: unknown, path: string): unknown {
  let current: unknown = root;

  for (const segment of parsePath(path)) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<PathSegment, unknown>)[segment];
  }

  return current;
}

/**
 * Returns a copy of `root` with `path` set to `value`, sharing every untouched
 * branch. Structural sharing is what keeps `React.memo` on record cards effective
 * — an edit to one offering must not change the identity of the other thirteen.
 */
export function setPath<T>(root: T, path: string, value: unknown): T {
  const segments = parsePath(path);
  if (segments.length === 0) return value as T;

  const [head, ...rest] = segments;
  const restPath = rest.join(".");

  if (Array.isArray(root)) {
    const index = Number(head);
    const next = root.slice();
    next[index] =
      rest.length === 0 ? value : setPath(root[index], restPath, value);
    return next as T;
  }

  const source = (root ?? {}) as Record<string, unknown>;
  return {
    ...source,
    [head]:
      rest.length === 0 ? value : setPath(source[String(head)], restPath, value),
  } as T;
}
