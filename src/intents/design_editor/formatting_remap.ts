export type FormattingEditReason =
  | "INVALID_TEMPLATE"
  | "DIFF_LIMIT_EXCEEDED"
  | "AMBIGUOUS_INSERTION"
  | "CROSSES_FORMATTING_BOUNDARY"
  | "AMBIGUOUS_ALIGNMENT"
  | "PARAGRAPH_STYLE_CONFLICT";

export class FormattingRemapError extends Error {
  constructor(public readonly reason: FormattingEditReason) {
    super(reason);
  }
}

type Region = { id: string; start: number; end: number };

// Work in Unicode code points; return UTF-16 offsets expected by Canva.
const characters = (text: string) => {
  const chars = Array.from(text);
  const offsets = [0];
  for (const char of chars)
    offsets.push((offsets[offsets.length - 1] ?? 0) + char.length);
  return { chars, offsets };
};

export const remapFormattingRegions = (
  original: string,
  edited: string,
  regions: readonly Region[],
): Region[] => {
  const source = characters(original);
  const target = characters(edited);
  const boundaries = new Set(source.offsets);
  let end = 0;
  const ids = new Set<string>();
  for (const region of regions) {
    if (
      ids.has(region.id) ||
      region.start !== end ||
      region.end < region.start ||
      !boundaries.has(region.start) ||
      !boundaries.has(region.end)
    ) {
      throw new FormattingRemapError("INVALID_TEMPLATE");
    }
    ids.add(region.id);
    end = region.end;
  }
  if (end !== original.length || !regions.length) {
    throw new FormattingRemapError("INVALID_TEMPLATE");
  }

  const owners = source.chars.map((_, i) =>
    regions.findIndex(
      (region) =>
        region.start <= (source.offsets[i] ?? 0) &&
        region.end > (source.offsets[i] ?? 0),
    ),
  );
  const n = source.chars.length;
  const m = target.chars.length;
  const width = m + 1;
  const cells = (n + 1) * width;
  // Bound synchronous work and memory for unusually large/repetitive edits.
  if (cells > 1_000_000) throw new FormattingRemapError("DIFF_LIMIT_EXCEEDED");
  const distance = new Uint32Array(cells);
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      const at = i * width + j;
      if (i === n) distance[at] = m - j;
      else if (j === m) distance[at] = n - i;
      else
        distance[at] = Math.min(
          1 + (distance[at + width] ?? Infinity),
          1 + (distance[at + 1] ?? Infinity),
          Number(source.chars[i] !== target.chars[j]) +
            (distance[at + width + 1] ?? Infinity),
        );
    }
  }

  // An insertion at a boundary can belong to a replacement hunk. Find the
  // first source edit before the next unchanged character on every optimal
  // suffix. Only unanimous ownership can disambiguate that insertion.
  const followingEdit = new Int32Array(cells).fill(-1);
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      const at = i * width + j;
      const choices = new Set<number>();
      if (i < n && j < m) {
        const changed = source.chars[i] !== target.chars[j];
        if (
          distance[at] ===
          Number(changed) + (distance[at + width + 1] ?? Infinity)
        ) {
          choices.add(changed ? (owners[i] ?? -1) : -1);
        }
      }
      if (i < n && distance[at] === 1 + (distance[at + width] ?? Infinity))
        choices.add(owners[i] ?? -1);
      if (j < m && distance[at] === 1 + (distance[at + 1] ?? Infinity))
        choices.add(followingEdit[at + 1] ?? -1);
      followingEdit[at] =
        choices.size > 1 ? -3 : (choices.values().next().value ?? -1);
    }
  }

  // Visit ALL optimal edit paths, not an arbitrary tie-broken diff. A target
  // character must have the same region owner on every path. Track the last
  // edited region until an unchanged character separates edit hunks.
  // -2 = unreachable, -1 = no edit, -3 = multiple edited regions.
  const previousEdit = new Int32Array(cells).fill(-2);
  previousEdit[0] = -1;
  const withoutPreviousEdit = new Uint8Array(cells);
  withoutPreviousEdit[0] = 1;
  const targetOwners = new Int32Array(m).fill(-1);
  const visit = (
    from: number,
    to: number,
    owner: number,
    targetIndex: number | undefined,
    changed: boolean,
  ) => {
    const previous = previousEdit[from];
    if (changed && previous !== -1 && previous !== owner) {
      throw new FormattingRemapError("CROSSES_FORMATTING_BOUNDARY");
    }
    if (targetIndex !== undefined) {
      if (
        targetOwners[targetIndex] !== -1 &&
        targetOwners[targetIndex] !== owner
      ) {
        throw new FormattingRemapError("AMBIGUOUS_ALIGNMENT");
      }
      targetOwners[targetIndex] = owner;
    }
    if (!changed) withoutPreviousEdit[to] = 1;
    const next = changed ? owner : -1;
    const existing = previousEdit[to];
    // A path without a preceding edit imposes no additional restriction.
    if (existing === -2 || existing === -1) previousEdit[to] = next;
    else if (next !== -1 && existing !== next) previousEdit[to] = -3;
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const at = i * width + j;
      if (previousEdit[at] === -2) continue;
      if (i < n && j < m) {
        const changed = source.chars[i] !== target.chars[j];
        if (
          distance[at] ===
          Number(changed) + (distance[at + width + 1] ?? Infinity)
        ) {
          visit(at, at + width + 1, owners[i] ?? -1, j, changed);
        }
      }
      if (i < n && distance[at] === 1 + (distance[at + width] ?? Infinity)) {
        visit(at, at + width, owners[i] ?? -1, undefined, true);
      }
      if (j < m && distance[at] === 1 + (distance[at + 1] ?? Infinity)) {
        const left = owners[i - 1];
        const right = owners[i];
        let owner = left ?? right;
        if (left !== undefined && right !== undefined && left !== right) {
          const previous = previousEdit[at] ?? -1;
          const following = followingEdit[at + 1] ?? -1;
          if (previous >= 0 && !withoutPreviousEdit[at]) owner = previous;
          else if (following >= 0) owner = following;
          else throw new FormattingRemapError("AMBIGUOUS_INSERTION");
        }
        if (owner === undefined)
          throw new FormattingRemapError("INVALID_TEMPLATE");
        visit(at, at + 1, owner, j, true);
      }
    }
  }

  const result: Region[] = [];
  let previousOwner = -1;
  for (let j = 0; j < m; j++) {
    const owner = targetOwners[j] ?? -1;
    if (owner < previousOwner)
      throw new FormattingRemapError("AMBIGUOUS_ALIGNMENT");
    previousOwner = owner;
    const region = regions[owner];
    if (!region) throw new FormattingRemapError("INVALID_TEMPLATE");
    const last = result[result.length - 1];
    const start = target.offsets[j] ?? 0;
    const end = target.offsets[j + 1] ?? edited.length;
    if (last && last.id === region.id) last.end = end;
    else result.push({ id: region.id, start, end });
  }
  // Monotone edit paths must never reorder or split an original region.
  if (new Set(result.map(({ id }) => id)).size !== result.length) {
    throw new FormattingRemapError("AMBIGUOUS_ALIGNMENT");
  }
  return result;
};
