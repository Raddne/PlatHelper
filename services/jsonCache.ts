import fs from "node:fs";

import { writeFileAtomicSync } from "./atomicFile";
import { withScope } from "./logger";
import { userDataPath } from "./userDataPath";

const log = withScope("jsonCache");

interface JsonCache<T> {
  read(): T | null;
  write(payload: T): void;
}

// `revive` owns shape validation; an unreadable file and a failed write both
// degrade so a corrupt cache never blocks a rebuild from source.
export function createJsonCache<T>(
  filename: string,
  revive: (parsed: unknown) => T | null,
  options: { keepUnreadable?: boolean } = {},
): JsonCache<T> {
  const cachePath = (): string => userDataPath(filename);

  // For files that hold user-entered data rather than a rebuildable cache: a
  // file this version cannot read (damaged, or written by a newer version) is
  // copied aside before the caller's empty default can overwrite it.
  const keepUnreadableCopy = (): void => {
    if (!options.keepUnreadable) return;
    try {
      if (fs.statSync(cachePath()).size === 0) return;
      fs.copyFileSync(cachePath(), `${cachePath()}.unreadable-${Date.now()}.bak`);
      log.warn(`${filename} could not be read; a copy was kept next to it`);
    } catch {
      // No file yet: nothing to keep.
    }
  };

  return {
    read(): T | null {
      let revived: T | null;
      try {
        revived = revive(JSON.parse(fs.readFileSync(cachePath(), "utf8")));
      } catch {
        revived = null;
      }
      if (revived === null) keepUnreadableCopy();
      return revived;
    },
    write(payload: T): void {
      try {
        writeFileAtomicSync(cachePath(), JSON.stringify(payload));
      } catch (err) {
        log.warn(`Failed to write ${filename}`, err);
      }
    },
  };
}
