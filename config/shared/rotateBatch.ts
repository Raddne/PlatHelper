/** Up to `size` items starting at `offset`, wrapping around, plus the offset
 *  the next call should start from - so every item gets a turn over successive
 *  calls instead of the same prefix winning forever. A list that fits in one
 *  batch is returned whole and resets the offset. */
export function rotateBatch<T>(
  list: readonly T[],
  offset: number,
  size: number,
): { items: T[]; nextOffset: number } {
  const total = list.length;
  if (total <= size) return { items: list.slice(), nextOffset: 0 };
  const start = ((offset % total) + total) % total;
  const items: T[] = [];
  for (let i = 0; i < size; i++) items.push(list[(start + i) % total] as T);
  return { items, nextOffset: (start + size) % total };
}
