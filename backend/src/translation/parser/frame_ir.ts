/**
 * Frame / Opaque IR for the Turkish frame parser (Stage 1, Task 2: SHADOW
 * ONLY). No production module imports this yet.
 *
 * A parse is a gap-free, overlap-free sequence of nodes over the source:
 *  - `Frame`: ONE recognized action with typed slots. A frame carries source
 *    facts only (counts, glossary concept ids, spans), never target-language
 *    wording. Rendering is a later stage.
 *  - `Opaque`: everything not (yet) recognized. Unrecognized text is data, not
 *    an error, and is kept byte for byte.
 *
 * Every span is `{ start, end, raw }` in UTF-16 code units, with
 * `raw === source.slice(start, end)`. Concatenating the node spans gives back
 * the source exactly; no text disappears and none is invented.
 *
 * Import rules: none at runtime. Types only.
 */

export type SourceSpan = {
  /** Inclusive start, UTF-16 code units. */
  readonly start: number;
  /** Exclusive end, UTF-16 code units. */
  readonly end: number;
  /** Exactly `source.slice(start, end)`. */
  readonly raw: string;
};

/** Glossary concept ids (`PROJECT_NOTATION[].concept`) a stitch slot may name. */
export type StitchConcept = string;

/** "N<stitch> örüyoruz": work N stitches of one stitch type. */
export type StitchCountFrame = {
  readonly kind: "frame";
  readonly action: "stitch_count";
  /** From the first count digit to the end of the verb. */
  readonly span: SourceSpan;
  readonly slots: {
    readonly count: { readonly span: SourceSpan; readonly value: number };
    readonly stitch: { readonly span: SourceSpan; readonly concept: StitchConcept };
    readonly verb: { readonly span: SourceSpan };
  };
};

/** One union member per migrated frame family. */
export type Frame = StitchCountFrame;

export type Opaque = {
  readonly kind: "opaque";
  readonly span: SourceSpan;
};

export type ParseNode = Frame | Opaque;

export type FrameParse = {
  readonly source: string;
  readonly nodes: readonly ParseNode[];
};

export const reconstructParse = (nodes: readonly ParseNode[]): string =>
  nodes.map(({ span }) => span.raw).join("");

const slotSpans = (node: ParseNode): SourceSpan[] =>
  node.kind === "frame"
    ? [node.slots.count.span, node.slots.stitch.span, node.slots.verb.span]
    : [];

const spanIssues = (source: string, span: SourceSpan, label: string): string[] => {
  const issues: string[] = [];
  if (span.start < 0 || span.end <= span.start || span.end > source.length) {
    issues.push(`${label} has invalid range ${span.start}..${span.end}.`);
  }
  if (source.slice(span.start, span.end) !== span.raw) {
    issues.push(`${label} raw text is not the source slice ${span.start}..${span.end}.`);
  }
  return issues;
};

/**
 * Structural problems of a parse against its source. Empty when every node is
 * exact, nodes tile the source, and every slot lies inside its own frame
 * without overlapping another slot.
 */
export const parseInvariantIssues = (parse: FrameParse): string[] => {
  const { source, nodes } = parse;
  const issues: string[] = [];
  let cursor = 0;
  for (const [index, node] of nodes.entries()) {
    issues.push(...spanIssues(source, node.span, `Node ${index}`));
    if (node.span.start !== cursor) {
      issues.push(`Node ${index} starts at ${node.span.start}, expected ${cursor} (gap or overlap).`);
    }
    cursor = node.span.end;

    const slots = [...slotSpans(node)].sort((left, right) => left.start - right.start);
    for (const [slotIndex, slot] of slots.entries()) {
      issues.push(...spanIssues(source, slot, `Node ${index} slot ${slotIndex}`));
      if (slot.start < node.span.start || slot.end > node.span.end) {
        issues.push(`Node ${index} slot ${slotIndex} lies outside its frame.`);
      }
      const previous = slots[slotIndex - 1];
      if (previous !== undefined && slot.start < previous.end) {
        issues.push(`Node ${index} slots ${slotIndex - 1} and ${slotIndex} overlap.`);
      }
    }
  }
  if (cursor !== source.length) {
    issues.push(`Nodes cover ${cursor} of ${source.length} code units.`);
  }
  if (reconstructParse(nodes) !== source) {
    issues.push("Reconstruction from nodes differs from the source.");
  }
  return issues;
};
