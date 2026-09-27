import { formattingRegionSignature } from "./formatting_freshness";
import type {
  CanvaTranslationBlock,
  FormattingRegionSnapshot,
} from "./translation_review";
import type { WholeDocumentInventory } from "./whole_document_inventory";

type InventoryBlock = WholeDocumentInventory["pages"][number]["blocks"][number];

const fingerprint = (
  sourceText: string,
  formattingRegions: readonly FormattingRegionSnapshot[],
): string =>
  JSON.stringify([
    sourceText,
    formattingRegionSignature(formattingRegions),
  ]);

export const reconcileReviewReadingOrder = (
  liveBlocks: readonly CanvaTranslationBlock[],
  formattingSnapshots: ReadonlyMap<string, FormattingRegionSnapshot[]>,
  inventoryBlocks: readonly InventoryBlock[],
): readonly CanvaTranslationBlock[] => {
  if (liveBlocks.length < 2 || liveBlocks.length !== inventoryBlocks.length) {
    return liveBlocks;
  }

  if (inventoryBlocks.some(({ readingOrder }) => readingOrder === undefined)) {
    return liveBlocks;
  }

  const inventoryByFingerprint = new Map<string, InventoryBlock[]>();

  for (const block of inventoryBlocks) {
    const key = fingerprint(block.sourceText, block.formattingRegions);
    const existing = inventoryByFingerprint.get(key) ?? [];
    inventoryByFingerprint.set(key, [...existing, block]);
  }

  if ([...inventoryByFingerprint.values()].some((matches) => matches.length !== 1)) {
    return liveBlocks;
  }

  const used = new Set<InventoryBlock>();
  const augmented: CanvaTranslationBlock[] = [];

  for (const block of liveBlocks) {
    const snapshot = formattingSnapshots.get(block.localId);
    if (snapshot === undefined) return liveBlocks;

    const key = fingerprint(block.sourceText, snapshot);
    const matches = inventoryByFingerprint.get(key);

    if (matches === undefined || matches.length !== 1) {
      return liveBlocks;
    }

    const [match] = matches;
    if (match === undefined || used.has(match) || match.readingOrder === undefined) {
      return liveBlocks;
    }

    used.add(match);
    augmented.push({
      ...block,
      readingOrder: match.readingOrder,
    });
  }

  if (used.size !== inventoryBlocks.length) return liveBlocks;

  return augmented;
};
