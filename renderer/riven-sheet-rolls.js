// Cells of the riven overlay's "Good rolls" block: the sheet's raw text split into
// stat tokens, the same way the sheet importer reads it.

/** Splits on "/", ">" and ">>" outside parentheses, keeping the separators.
 * @param {string} text
 * @returns {Array<{ text: string, token: boolean }>} */
export function sheetCellParts(text) {
  const parts = [];
  let token = "";
  let separator = "";
  let depth = 0;
  const pushToken = () => {
    const trimmed = token.trimEnd();
    if (trimmed) parts.push({ text: trimmed, token: true });
    separator = token.slice(trimmed.length) + separator;
    token = "";
  };
  for (const char of String(text ?? "")) {
    if (depth === 0 && (char === "/" || char === ">")) {
      if (token) pushToken();
      separator += char;
      continue;
    }
    if (separator && !token && /\s/.test(char)) {
      separator += char;
      continue;
    }
    if (separator) {
      parts.push({ text: separator, token: false });
      separator = "";
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    token += char;
  }
  if (token) pushToken();
  if (separator) parts.push({ text: separator, token: false });
  return parts;
}

/** The cell's parts, each token paired in order with the cell's stat code. Without
 *  codes when the counts differ, as in ANY or NONE cells.
 * @param {string} text
 * @param {string[] | null | undefined} codes
 * @returns {Array<{ text: string, code: string | null }>} */
export function sheetCellTokens(text, codes) {
  const parts = sheetCellParts(text);
  const tokens = parts.filter((part) => part.token).length;
  const paired = Array.isArray(codes) && codes.length === tokens;
  let index = 0;
  return parts.map((part) => ({
    text: part.text,
    code: part.token && paired ? String(codes[index++]) : null,
  }));
}
