/** Minimal class-name joiner. Falsy entries are dropped. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    out = out === '' ? part : `${out} ${part}`;
  }
  return out;
}
