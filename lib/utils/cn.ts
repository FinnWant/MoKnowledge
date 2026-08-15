type ClassValue = string | false | null | undefined;

/**
 * Joins class names, dropping falsy values.
 *
 * Deliberately not `clsx` + `tailwind-merge`: two dependencies to do this is a
 * poor trade when the component variants below are the only place classes are
 * composed, and each one owns a disjoint set of utilities so there is nothing to
 * de-conflict.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
