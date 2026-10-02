// Keyed each blocks throw each_key_duplicate on a repeated key, and stored rows
// can repeat an id (an old or hand-edited file, two rows made in the same
// millisecond). Every row stays listed: a repeat gets a key of its own.

interface KeyedItem<T> {
  key: string;
  item: T;
}

/** Each item with a key no other item in the list has: its own key, or for a
 *  repeat that key plus a counter. */
export function withUniqueKeys<T>(items: readonly T[], keyOf: (item: T) => string): KeyedItem<T>[] {
  const seen = new Set<string>();
  return items.map((item) => {
    const base = String(keyOf(item));
    let key = base;
    for (let n = 2; seen.has(key); n++) key = `${base}\u0000${n}`;
    seen.add(key);
    return { key, item };
  });
}
