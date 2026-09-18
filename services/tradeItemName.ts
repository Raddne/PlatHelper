// Dialog rank suffixes are not part of WFM listing names.

import { parseTradedItemName } from "../config/shared/tradeItemName";
import * as wfmCatalog from "./wfmCatalog";

export { parseTradedItemName };

export function lookupTradedCatalogItem(
  displayName: string,
): ReturnType<typeof wfmCatalog.lookupByName> {
  const { baseName } = parseTradedItemName(displayName);
  if (!baseName) return null;
  return (
    wfmCatalog.lookupByName(baseName) ||
    wfmCatalog.lookupByName(baseName.replace(/ Blueprint$/i, ""))
  );
}
