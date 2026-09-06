import type { RichtextFormatting } from "@canva/design";

export type FormattingSignatureRegion = {
  index: number;
  length: number;
  text: string;
  formatting: Partial<RichtextFormatting>;
};

const hash = (value: string): string => {
  let first = 2166136261;
  let second = 2246822519;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }

  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
};

export const formattingRegionSignature = (
  regions: readonly FormattingSignatureRegion[],
): string => {
  const serialized = JSON.stringify(
    regions.map(({ index, length, text, formatting }) => [
      index,
      length,
      text,
      formatting.color,
      formatting.fontWeight,
      formatting.fontStyle,
      formatting.decoration,
      formatting.strikethrough,
      formatting.link,
      formatting.fontRef,
      formatting.fontSize,
      formatting.letterSpacingEm,
      formatting.lineHeightEm,
      formatting.textAlign,
      formatting.listLevel,
      formatting.listMarker,
    ]),
  );

  return `formatting-v1-${hash(serialized)}`;
};

export const formattingBlocksSignature = (
  blocks: readonly {
    id: string;
    order: number;
    formattingRegions: readonly FormattingSignatureRegion[];
  }[],
): string => {
  const serialized = JSON.stringify(
    [...blocks]
      .sort((left, right) => left.order - right.order)
      .map(({ id, order, formattingRegions }) => [
        id,
        order,
        formattingRegionSignature(formattingRegions),
      ]),
  );

  return `page-formatting-v1-${hash(serialized)}`;
};
