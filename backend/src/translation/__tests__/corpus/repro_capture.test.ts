/**
 * Stage 0, Step 3, reduced in Step 5: inventory of the measured repros that are
 * still open (R1 to R3). R4 (`row-round-unit-drift`) was fixed in Task 18B and
 * promoted, with its unchanged request, to the curated lane as the approved
 * regression case `c-9fd3d972ce-course-end-turn`; it is no longer a known-bad
 * repro.
 *
 * Step 3 proved the harness by replaying each repro through the real
 * translateBlocks here. Step 5 moved that replay to the general suite
 * (`../corpus_replay.test.ts`), which runs the same [contract], [trace] and
 * [determinism] promises for every case, repros included, plus four more. The
 * loader (`./load_corpus.ts`) now enforces file name equals id, id matches the
 * request hash, and canonical bytes. What remains here is what neither of those
 * covers: the repro lane must keep exactly one case per required hazard, and
 * each repro must keep its desired output as data.
 *
 * `known.desired` and `known.observedLive` are evidence only and are never
 * compared against pipeline output anywhere.
 *
 * Pure file inspection: no pipeline, no provider, no network.
 */
import { describe, expect, it } from "vitest";
import { loadCorpus } from "./load_corpus.js";

const REQUIRED_HAZARDS = [
  "ordinal-at-block-start", // R1
  "ordinal-mid-block", // R2
  "cross-block-context", // R3
] as const;

const repros = loadCorpus().cases.filter((entry) => entry.lane === "repro");

describe("Stage 0 repro cases: inventory", () => {
  it("contain exactly one known-bad repro for each required hazard", () => {
    for (const { value } of repros) {
      expect(value.status).toBe("known-bad");
    }
    for (const hazard of REQUIRED_HAZARDS) {
      expect(
        repros.filter(({ value }) => value.labels.hazards.includes(hazard)),
      ).toHaveLength(1);
    }
  });

  it.each(repros.map((entry): [string, string[]] => [entry.file, [...(entry.value.known?.desired ?? [])]]))(
    "%s keeps desired output as data that is never asserted",
    (_file, desired) => {
      expect(desired.length).toBeGreaterThan(0);
    },
  );

  it("keeps fixed R4 as an approved curated regression, not as a known-bad repro", () => {
    const r4 = loadCorpus().cases.filter(({ value }) =>
      value.labels.hazards.includes("row-round-unit-drift"));
    expect(r4.map(({ caseId, lane, value }) => [caseId, lane, value.status, value.labels.zeroProvider]))
      .toEqual([["c-9fd3d972ce-course-end-turn", "curated", "approved", true]]);
    expect(r4[0]?.value.expected?.results[0]?.translated).toBe("When you reach the end, ch 1 and turn.");
  });

  it("R3 puts both blocks in one request", () => {
    const r3 = repros.find(({ value }) => value.labels.hazards.includes("cross-block-context"));
    expect(r3?.value.request.blocks).toHaveLength(2);
  });
});
