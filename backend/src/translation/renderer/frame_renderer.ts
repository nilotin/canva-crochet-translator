/**
 * Deterministic frame renderer (Stage 1, Task 4: SHADOW ONLY, English only).
 *
 * Turns the parser's recognized frames into canonical target-language text.
 * No production module imports this yet; translation output is unchanged.
 *
 * A RENDER UNIT is the smallest thing that can be rendered on its own:
 *  - one `stitch_count` frame      -> "work {count}{stitch}"   ("work 20sc");
 *  - one linked `chain` (converb) + whitespace Opaque + `turn` (finite) pair
 *                                  -> "ch {count} and turn"   ("ch 1 and turn").
 * A chain or turn frame is never rendered on its own: a converb is only half a
 * clause, and a turn is only admitted as the second half of that pair.
 *
 * Every unit carries the exact source span it replaces (for the pair, from the
 * chain's first digit to the end of the turn verb, the whitespace between
 * included), so a later assembly step can splice it without losing
 * provenance.
 *
 * Responsibilities NOT taken here:
 *  - casing, sentence punctuation and joining with neighbouring text ("Work",
 *    "Ch", ", then", "."): assembly;
 *  - Opaque text: provider or later frame families;
 *  - row/round wording: PatternContext (no current frame needs it);
 *  - languages other than English: no unit is produced.
 *
 * Target abbreviations are read from `PROJECT_NOTATION` by concept id; a
 * concept with no English abbreviation produces no unit.
 *
 * Import rules: `../glossary.js`, and types only from `../parser/frame_ir.js`
 * and `../types.js`. No parser, lexer, translator, normalizer, validator,
 * provider or corpus code.
 */
import { PROJECT_NOTATION } from "../glossary.js";
import type {
  ChainFrame,
  FrameParse,
  ParseNode,
  SourceSpan,
  StitchCountFrame,
  TurnFrame,
} from "../parser/frame_ir.js";
import type { TargetLanguage } from "../types.js";

export type RenderUnit = {
  readonly kind: "stitch_count" | "chain_turn";
  /** Exactly the source text this unit renders. */
  readonly sourceSpan: SourceSpan;
  /** Canonical lowercase target text, without casing or punctuation. */
  readonly text: string;
};

/** English glossary abbreviation for a concept id, or undefined. */
const englishAbbreviation = (concept: string): string | undefined =>
  PROJECT_NOTATION.find((entry) => entry.concept === concept)?.en?.abbreviation;

/** Horizontal whitespace only, the same separator the parser emits. */
const PAIR_SEPARATOR = /^[^\S\n\r\u2028\u2029]+$/u;

const spanOf = (source: string, start: number, end: number): SourceSpan => ({
  start,
  end,
  raw: source.slice(start, end),
});

const renderStitchCount = (frame: StitchCountFrame): RenderUnit | undefined => {
  const stitch = englishAbbreviation(frame.slots.stitch.concept);
  if (stitch === undefined) return undefined;
  return {
    kind: "stitch_count",
    sourceSpan: frame.span,
    text: `work ${frame.slots.count.value}${stitch}`,
  };
};

const renderChainTurn = (
  source: string,
  chain: ChainFrame,
  separator: ParseNode | undefined,
  turn: ParseNode | undefined,
): RenderUnit | undefined => {
  if (
    separator?.kind !== "opaque" ||
    !PAIR_SEPARATOR.test(separator.span.raw) ||
    turn?.kind !== "frame" ||
    turn.action !== "turn"
  ) {
    return undefined;
  }
  const unit = englishAbbreviation(chain.slots.unit.concept);
  if (unit === undefined) return undefined;
  const linkedTurn: TurnFrame = turn;
  return {
    kind: "chain_turn",
    sourceSpan: spanOf(source, chain.span.start, linkedTurn.span.end),
    text: `${unit} ${chain.slots.count.value} and turn`,
  };
};

/**
 * Render units of a parse, in source order. English only: any other target
 * language yields no units. Opaque nodes, unlinked chain frames and turn
 * frames outside the linked pair yield nothing.
 */
export const renderUnits = (
  parse: FrameParse,
  targetLanguage: TargetLanguage,
): RenderUnit[] => {
  if (targetLanguage !== "en") return [];
  const units: RenderUnit[] = [];
  const { nodes } = parse;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node?.kind !== "frame") continue;
    if (node.action === "stitch_count") {
      const unit = renderStitchCount(node);
      if (unit !== undefined) units.push(unit);
    } else if (node.action === "chain") {
      const unit = renderChainTurn(parse.source, node, nodes[index + 1], nodes[index + 2]);
      if (unit !== undefined) {
        units.push(unit);
        index += 2;
      }
    }
    // A turn frame is rendered only as the second half of its chain pair.
  }
  return units;
};
