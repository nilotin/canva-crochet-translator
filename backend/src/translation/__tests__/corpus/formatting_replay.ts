/**
 * Formatting checks for corpus replay and harvest classification (test support
 * only, Stage 0).
 *
 * The backend seam never sees source style VALUES. It receives region ids and
 * ranges and returns target regions. The frontend's fail-closed contract has
 * one decision that depends on the source styles: when a valid result carries
 * NO target regions, the frontend accepts it only if the source regions all
 * have the same style (`requiresFormattingProjection` is false). Everything
 * else in the contract (coverage, order, bounds, zero-width provenance,
 * absorbed ids) is decided by the geometry alone.
 *
 * So the checks are split, without ever inventing a style:
 *
 *  A) GEOMETRY. Always decidable from backend data.
 *  B) STYLE-DEPENDENT COMPLETENESS. Decidable only when `regionStyles` exist.
 *
 * When `regionStyles` are absent the unknown "does the source need a
 * projection?" is evaluated under BOTH possible answers (for a source of fewer
 * than two regions only "no" is possible). If the frontend
 * verdict is the same either way, it does not depend on the styles and is
 * reported normally. If the two answers disagree, the verdict is NOT EVALUATED:
 * it is reported in `notEvaluated`, never as a pass and never as a failure.
 * Missing styles are never treated as uniform.
 *
 * Formatting region ids are BLOCK-LOCAL (the frontend derives `fmt-N` per
 * block from its own snapshot list), so every check here is done one block at
 * a time: a block's own source regions, its own result's target regions, only
 * the `regionStyles` entries that name that block, and target bounds against
 * that block's own translated text. A region id repeating in another block
 * never collides with this one. Whether styles are "known" for the
 * style-dependent verdict is decided per block (does at least one entry name
 * this block?), not by the case-level presence of `regionStyles`, so a block
 * with zero entries is never treated as uniform.
 *
 * Import rules: only `./formatting_contract.js` and types from `./schema.js`.
 * No translator, provider or vitest code.
 */
import {
  checkFormattingContract,
  requiresFormattingProjection,
  styledSlices,
  type FormattingContractCheck,
} from "./formatting_contract.js";
import type { CorpusCase, ExpectedResult } from "./schema.js";

export type FormattingReplayCase = Pick<CorpusCase, "request" | "regionStyles">;

export type BlockScopedStyledSlice = { blockId: string; regionId: string; text: string };

/**
 * `styledSlices` per result, with the owning block id attached. Region ids
 * are block-local, so the block id is what makes an entry unambiguous when
 * two blocks share a region id. Same rules as the underlying helper: not
 * sorted, not deduped, throws on an unsliceable region. Invalid results are
 * skipped: the frontend never applies them.
 */
export const blockScopedStyledSlices = (
  results: readonly ExpectedResult[],
): BlockScopedStyledSlice[] =>
  results
    .filter((result) => result.valid && result.targetFormattingRegions !== undefined)
    .flatMap((result) =>
      styledSlices(result.translated, result.targetFormattingRegions ?? []).map((slice) => ({
        blockId: result.id,
        ...slice,
      })),
    );

export type FormattingNotEvaluated = {
  blockId: string;
  /** Number of source formatting regions of the block. */
  regionCount: number;
  reason: string;
};

export type FormattingReport = {
  /** Contract violations. Empty means every evaluated check held. */
  findings: string[];
  /** Style-dependent frontend verdicts that cannot be decided without source styles. */
  notEvaluated: FormattingNotEvaluated[];
};

const sameVerdict = (left: FormattingContractCheck, right: FormattingContractCheck): boolean => {
  if (left.complete || right.complete) {
    return left.complete === right.complete;
  }
  return left.issue.code === right.issue.code && left.issue.message === right.issue.message;
};

/**
 * Formatting findings for every VALID result. An invalid result is never
 * applied by the frontend, so its formatting fields are pinned by [contract]
 * only and produce neither findings nor "not evaluated" entries.
 */
export const formattingReport = (
  caseValue: FormattingReplayCase,
  results: readonly ExpectedResult[],
): FormattingReport => {
  const findings: string[] = [];
  const notEvaluated: FormattingNotEvaluated[] = [];
  const styles = caseValue.regionStyles;

  for (const block of caseValue.request.blocks) {
    const result = results.find((candidate) => candidate.id === block.id);
    if (result === undefined) {
      findings.push(`${block.id}: no result for this block`);
      continue;
    }
    if (!result.valid) {
      continue;
    }

    const sourceRegionIds = (block.formattingRegions ?? []).map((region) => region.id);
    // Region ids are block-local: only this block's own regionStyles entries
    // apply, matched by blockId, never by regionId alone. Whether styles are
    // "known" is decided PER BLOCK (at least one entry names this block), not
    // by the case-level presence of `regionStyles`: a loaded, valid case
    // always covers every region of every block it styles at all, but this
    // report must not assume that of an arbitrary caller, and must never treat
    // a block with zero entries as if its regions were known to be uniform.
    const stylesForBlock = styles?.filter((entry) => entry.blockId === block.id);
    const stylesKnownForBlock = stylesForBlock !== undefined && stylesForBlock.length > 0;
    const input = {
      sourceRegionIds,
      translated: result.translated,
      ...(result.targetFormattingRegions === undefined
        ? {}
        : { targetFormattingRegions: result.targetFormattingRegions }),
      ...(result.formattingProjection === undefined
        ? {}
        : { formattingProjection: result.formattingProjection }),
      ...(result.absorbedFormattingRegionIds === undefined
        ? {}
        : { absorbedFormattingRegionIds: result.absorbedFormattingRegionIds }),
    };

    let check: FormattingContractCheck;
    if (stylesKnownForBlock) {
      check = checkFormattingContract({
        ...input,
        requiresProjection: requiresFormattingProjection(sourceRegionIds, stylesForBlock ?? []),
      });
    } else {
      const ifUniform = checkFormattingContract({ ...input, requiresProjection: false });
      // By definition a projection is required only when the source regions
      // carry MORE THAN ONE distinct style group, which needs at least two
      // regions. With fewer, "uniform" is not an assumption about missing
      // styles, it is the only possible answer.
      const ifProjectionRequired =
        sourceRegionIds.length < 2
          ? ifUniform
          : checkFormattingContract({ ...input, requiresProjection: true });
      if (!sameVerdict(ifProjectionRequired, ifUniform)) {
        notEvaluated.push({
          blockId: block.id,
          regionCount: sourceRegionIds.length,
          reason:
            `Block "${block.id}" has ${sourceRegionIds.length} source formatting regions and a valid result ` +
            "without targetFormattingRegions. The frontend accepts that only when all source regions share one " +
            "style, and the backend never sees source styles, so the verdict is not evaluated.",
        });
        continue;
      }
      check = ifUniform;
    }

    if (!check.complete) {
      findings.push(`${block.id}: ${check.issue.code}: ${check.issue.message}`);
      continue;
    }
    if (result.targetFormattingRegions !== undefined) {
      const joined = styledSlices(result.translated, result.targetFormattingRegions)
        .map((slice) => slice.text)
        .join("");
      if (joined !== result.translated) {
        findings.push(`${block.id}: styled slices do not concatenate to the translated text`);
      }
    }
  }

  return { findings, notEvaluated };
};
