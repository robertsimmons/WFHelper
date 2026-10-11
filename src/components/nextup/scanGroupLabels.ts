import type { MessageKey } from "../../lib/i18n.js";
import type { ScanGroup } from "../../lib/suggest/scannables.js";

export const SCAN_GROUP_LABEL: Record<ScanGroup, MessageKey> = {
  somachords: "nextUp.scanCategorySomachords",
  fragments: "nextUp.scanCategoryFragments",
  prex: "nextUp.scanCategoryPrex",
  frameFighter: "nextUp.scanCategoryFrameFighter",
  objects: "nextUp.scanCategoryObjects",
};

export const SCAN_GROUP_SHORT: Record<ScanGroup, MessageKey> = {
  somachords: "nextUp.scanGroupSomachords",
  fragments: "nextUp.scanGroupFragments",
  prex: "nextUp.scanCategoryPrex",
  frameFighter: "nextUp.scanGroupFrameFighter",
  objects: "nextUp.scanGroupObjects",
};
