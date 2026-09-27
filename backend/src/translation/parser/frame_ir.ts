/**
 * Frame / Opaque IR for the Turkish frame parser (Stage 1, Task 2). Its only
 * production use is the same-block course-decision pre-pass
 * (`context/course_decisions.ts`, next-stage Task 8).
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

/** Glossary concept ids (`PROJECT_NOTATION[].concept`) a slot may name. */
export type StitchConcept = string;

/**
 * How the verb token is used, read from the parser lexicon entry for the
 * whole word (no morphology is split):
 *  - `finite`: the clause's own verb ("örüyoruz", "dönüyoruz");
 *  - `converb`: a linked verb ("çekip") whose clause continues with the next
 *    frame. A converb frame never stands alone (see `parseInvariantIssues`).
 */
export type VerbForm = "finite" | "converb";

export type VerbSlot<Form extends VerbForm = VerbForm> = {
  readonly span: SourceSpan;
  readonly form: Form;
};

type CountSlot = { readonly span: SourceSpan; readonly value: number };

/** "N<stitch> örüyoruz": work N stitches of one stitch type. */
export type StitchCountFrame = {
  readonly kind: "frame";
  readonly action: "stitch_count";
  /** From the first count digit to the end of the verb. */
  readonly span: SourceSpan;
  readonly slots: {
    readonly count: CountSlot;
    readonly stitch: { readonly span: SourceSpan; readonly concept: StitchConcept };
    readonly verb: VerbSlot<"finite">;
  };
};

/** "N zincir çekip": make N chains, linked to the next frame. */
export type ChainFrame = {
  readonly kind: "frame";
  readonly action: "chain";
  /** From the first count digit to the end of the converb. */
  readonly span: SourceSpan;
  readonly slots: {
    readonly count: CountSlot;
    readonly unit: { readonly span: SourceSpan; readonly concept: StitchConcept };
    readonly verb: VerbSlot<"converb">;
  };
};

/** "dönüyoruz": turn the work. No direction and no row/round meaning. */
export type TurnFrame = {
  readonly kind: "frame";
  readonly action: "turn";
  readonly span: SourceSpan;
  readonly slots: { readonly verb: VerbSlot<"finite"> };
};

/**
 * What the Turkish course-end phrase literally says, and nothing more:
 *  - `every`:  "bütün sıra sonlarında" (quantifier + plural "at the ends");
 *  - `plural`: "sıra sonlarında" (plural, no quantifier);
 *  - `single`: "sıra sonunda" (singular "at the end").
 * It carries no row/round meaning; that is a later PatternContext policy.
 */
export type CourseEndScope = "every" | "plural" | "single";

/**
 * "[Bütün] sıra sonlarında|sonunda N zincir çekip dönüyoruz": at the course
 * end(s), make N chains and turn. One flat frame: its chain and turn parts are
 * slots, never child frames, and it is not rendered yet.
 */
export type CourseEndTurnFrame = {
  readonly kind: "frame";
  readonly action: "course_end_turn";
  /** From the first scope word to the end of the finite verb. */
  readonly span: SourceSpan;
  readonly slots: {
    readonly scope: { readonly span: SourceSpan; readonly value: CourseEndScope };
    readonly count: CountSlot;
    readonly unit: { readonly span: SourceSpan; readonly concept: StitchConcept };
    readonly converb: VerbSlot<"converb">;
    readonly verb: VerbSlot<"finite">;
  };
};

/**
 * "N sıra Mx": work M stitches of one type for N courses. `sıra` is the course
 * noun only: the frame carries no row/round meaning (a later PatternContext
 * decides that). It has no verb slot.
 */
export type CourseCountFrame = {
  readonly kind: "frame";
  readonly action: "course_count";
  /** From the course count to the end of the stitch abbreviation. */
  readonly span: SourceSpan;
  readonly slots: {
    readonly courses: CountSlot;
    readonly course: { readonly span: SourceSpan };
    readonly count: CountSlot;
    readonly stitch: { readonly span: SourceSpan; readonly concept: StitchConcept };
  };
};

/** One union member per migrated frame family. */
export type Frame =
  | StitchCountFrame
  | ChainFrame
  | TurnFrame
  | CourseEndTurnFrame
  | CourseCountFrame;

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

const slotSpans = (node: ParseNode): SourceSpan[] => {
  if (node.kind === "opaque") return [];
  switch (node.action) {
    case "stitch_count":
      return [node.slots.count.span, node.slots.stitch.span, node.slots.verb.span];
    case "chain":
      return [node.slots.count.span, node.slots.unit.span, node.slots.verb.span];
    case "turn":
      return [node.slots.verb.span];
    case "course_end_turn":
      return [
        node.slots.scope.span,
        node.slots.count.span,
        node.slots.unit.span,
        node.slots.converb.span,
        node.slots.verb.span,
      ];
    case "course_count":
      return [
        node.slots.courses.span,
        node.slots.course.span,
        node.slots.count.span,
        node.slots.stitch.span,
      ];
  }
};

/** Horizontal whitespace only: the lexer's `whitespace` token, never a line break. */
const MEMBER_SEPARATOR = /^[^\S\n\r\u2028\u2029]+$/u;

/**
 * A converb frame is only half a clause. In this IR the one converb frame is
 * `chain`, and its only admitted continuation is `turn`: the chain must be
 * followed by one whitespace-only Opaque node and then that turn frame.
 */
const danglingConverbIssues = (nodes: readonly ParseNode[]): string[] =>
  nodes.flatMap((node, index) => {
    // Only `chain` has a converb verb slot; verb-less frames have nothing to link.
    if (node.kind !== "frame" || node.action !== "chain" || node.slots.verb.form !== "converb") return [];
    const separator = nodes[index + 1];
    const linked = nodes[index + 2];
    const separated =
      separator?.kind === "opaque" && MEMBER_SEPARATOR.test(separator.span.raw);
    return separated && linked?.kind === "frame" && linked.action === "turn"
      ? []
      : [`Node ${index} is a converb ${node.action} frame without its linked turn frame.`];
  });

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
 * exact, nodes tile the source, every slot lies inside its own frame without
 * overlapping another slot, and no converb frame is left without its linked
 * frame.
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
  issues.push(...danglingConverbIssues(nodes));
  return issues;
};
