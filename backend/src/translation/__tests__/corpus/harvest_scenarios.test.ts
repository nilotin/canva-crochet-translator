/**
 * Stage 0, Step 6 (identity revision): harvested cases identify a SCENARIO,
 * that is the source request plus the replay provider config, while the repro
 * and curated lanes keep their request-only ids.
 *
 * Why: the same request can legitimately appear in several tests whose provider
 * doubles behave differently (a passing provider, a corrupted one). The
 * provider double is part of the effective input, so those are separate
 * behaviors and need separate ids. The request hash still identifies the
 * source request alone.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalScenarioJson,
  canonicalizeProvider,
  caseIdMatchesRequest,
  caseIdMatchesScenario,
  deriveCaseId,
  deriveHarvestedCaseId,
  scenarioSha256,
} from "./canonicalize.js";
import { loadCorpus } from "./load_corpus.js";
import type { CorpusRequest, ProviderConfig } from "./schema.js";

const request: CorpusRequest = { targetLanguage: "en", blocks: [{ id: "b1", text: "Normal metin." }] };
const oracle = (translated: string): ProviderConfig => ({
  mode: "oracle",
  entries: [{ source: "Normal metin.", translated }],
});

describe("harvested scenario ids", () => {
  it("have the shape h-<request hash>-s<scenario hash> and share the request hash with other lanes", () => {
    const id = deriveHarvestedCaseId(request, { mode: "none" });
    expect(id).toMatch(/^h-[0-9a-f]{10}-s[0-9a-f]{8}$/);
    expect(id.slice(0, 12)).toBe(deriveCaseId("harvested", request));
    expect(id.slice(0, 12).replace(/^h/, "r")).toBe(deriveCaseId("repro", request));
  });

  it("are deterministic and do not depend on oracle entry order", () => {
    const entries = [
      { source: "a", translated: "1" },
      { source: "b", translated: "2" },
    ];
    const two = { targetLanguage: "en", blocks: [{ id: "b1", text: "a" }, { id: "b2", text: "b" }] };
    const forward = deriveHarvestedCaseId(two, { mode: "oracle", entries });
    const backward = deriveHarvestedCaseId(two, { mode: "oracle", entries: [...entries].reverse() });
    expect(backward).toBe(forward);
    expect(deriveHarvestedCaseId(two, { mode: "oracle", entries })).toBe(forward);
  });

  it("differ when the replay provider config differs, and keep the request hash", () => {
    const none = deriveHarvestedCaseId(request, { mode: "none" });
    const echo = deriveHarvestedCaseId(request, { mode: "echo" });
    const first = deriveHarvestedCaseId(request, oracle("__XQZZZZQX__"));
    const second = deriveHarvestedCaseId(request, oracle("crochet __XQZZZZQX__"));
    expect(new Set([none, echo, first, second]).size).toBe(4);
    expect(new Set([none, echo, first, second].map((id) => id.slice(0, 12))).size).toBe(1);
  });

  it("differ when the request differs", () => {
    const other = { targetLanguage: "es", blocks: request.blocks };
    expect(deriveHarvestedCaseId(other, { mode: "none" })).not.toBe(
      deriveHarvestedCaseId(request, { mode: "none" }),
    );
  });

  it("take only request and provider config: the scenario key has no room for provenance", () => {
    const key = JSON.parse(canonicalScenarioJson(request, oracle("x"))) as Record<string, unknown>;
    expect(Object.keys(key).sort()).toEqual(["provider", "request"]);
    expect(canonicalScenarioJson(request, oracle("x"))).toBe(canonicalScenarioJson(request, oracle("x")));
    expect(scenarioSha256(request, oracle("x"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("append a cosmetic slug that never changes the hashes", () => {
    const base = deriveHarvestedCaseId(request, { mode: "none" });
    expect(deriveHarvestedCaseId(request, { mode: "none" }, "normal-metin")).toBe(`${base}-normal-metin`);
    expect(() => deriveHarvestedCaseId(request, { mode: "none" }, "Bad Slug")).toThrow(TypeError);
  });

  it("are checked by caseIdMatchesScenario, which rejects request-only and wrong-provider ids", () => {
    const provider = oracle("x");
    const id = deriveHarvestedCaseId(request, provider);
    expect(caseIdMatchesScenario({ id, request, provider })).toBe(true);
    expect(caseIdMatchesScenario({ id: `${id}-with-slug`, request, provider })).toBe(true);
    expect(caseIdMatchesScenario({ id: deriveCaseId("harvested", request), request, provider })).toBe(false);
    expect(caseIdMatchesScenario({ id, request, provider: oracle("y") })).toBe(false);
  });

  it("canonicalize the provider config: oracle entries sorted, shape checked", () => {
    expect(
      canonicalizeProvider({
        mode: "oracle",
        entries: [
          { source: "b", translated: "2" },
          { source: "a", translated: "1" },
        ],
      }),
    ).toEqual({
      mode: "oracle",
      entries: [
        { source: "a", translated: "1" },
        { source: "b", translated: "2" },
      ],
    });
    expect(() => canonicalizeProvider({ mode: "oracle", entries: [] })).toThrow();
    expect(() => canonicalizeProvider({ mode: "guess" })).toThrow();
  });
});

describe("repro and curated ids stay request-based", () => {
  // Pinned literally: these ids were frozen in Step 3 and must never change.
  // R4 (`r-9fd3d972ce-unit-drift-turning`) left the repro lane when Task 18B
  // fixed it; its request hash lives on, unchanged, in the curated id below.
  const FROZEN_REPRO_IDS = [
    "r-0b3aaf317b-cross-block-row-context",
    "r-7a5acffa51-ordinal-at-block-start",
    "r-7f044c15ff-ordinal-mid-block",
  ];

  it("keeps the promoted R4 request hash under its curated id", () => {
    expect(loadCorpus().cases.map(({ caseId }) => caseId))
      .toContain("c-9fd3d972ce-course-end-turn");
  });

  it("keeps the three open frozen repro ids byte-identical", () => {
    const ids = loadCorpus()
      .cases.filter((entry) => entry.lane === "repro")
      .map((entry) => entry.caseId)
      .sort();
    expect(ids).toEqual(FROZEN_REPRO_IDS);
  });

  it("derives every non-harvested committed id from the request alone", () => {
    for (const entry of loadCorpus().cases) {
      if (entry.lane === "harvested") {
        continue;
      }
      expect(caseIdMatchesRequest(entry.value)).toBe(true);
      expect(entry.caseId.startsWith(deriveCaseId(entry.lane, entry.value.request))).toBe(true);
    }
  });
});
