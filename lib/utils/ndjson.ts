/**
 * Reading newline-delimited JSON off a `fetch` response.
 *
 * The only subtlety worth writing down: a chunk boundary lands wherever the
 * network puts it, which is routinely in the middle of a line — the result event
 * carries a whole knowledge base and is several hundred kilobytes, so it is
 * *always* split. Anything that parses per chunk works on a small site and
 * throws on a real one.
 */

/** Splits a stream of text chunks into complete lines, buffering the remainder. */
export function createLineSplitter(): {
  push: (chunk: string) => string[];
  flush: () => string[];
} {
  let buffer = "";

  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      // The last element is either an incomplete line or "" — either way it
      // stays in the buffer until the next chunk completes it.
      buffer = lines.pop() ?? "";
      return lines.filter((line) => line.trim().length > 0);
    },
    flush() {
      const rest = buffer.trim();
      buffer = "";
      return rest.length > 0 ? [rest] : [];
    },
  };
}

/**
 * Yields one parsed value per line. Malformed lines are skipped rather than
 * thrown: a truncated final line at the end of an aborted response should not
 * discard the twenty good events that preceded it.
 */
export async function* readNdjson<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
  const reader = body.getReader();
  // A manual decoder rather than `TextDecoderStream`: `{ stream: true }` is what
  // keeps a multi-byte character split across two chunks intact, and this avoids
  // the DOM lib's variance mismatch on `pipeThrough`.
  const decoder = new TextDecoder();
  const splitter = createLineSplitter();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of splitter.push(decoder.decode(value, { stream: true }))) {
        const parsed = parseLine<T>(line);
        if (parsed !== undefined) yield parsed;
      }
    }
    for (const line of splitter.flush()) {
      const parsed = parseLine<T>(line);
      if (parsed !== undefined) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseLine<T>(line: string): T | undefined {
  try {
    return JSON.parse(line) as T;
  } catch {
    return undefined;
  }
}
