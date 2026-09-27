// Semantic reading order for the text blocks of ONE page (next stage,
// Task 10). Pure and deterministic; no Canva SDK access.
//
// `readingOrder` is NOT the existing `order` field. `order` is the raw SDK
// iteration index that apply/freshness/template logic relies on and is never
// changed here. `readingOrder` is a page-local rank that is only produced
// when the page's layout makes the reading order unambiguous.
//
// Policy ("single vertical stack or nothing"): a crochet pattern page is read
// top to bottom. When every pair of text boxes is vertically separable --
// neither box's vertical centre lies inside the other box's vertical span --
// the boxes form one column and the reading order is simply top to bottom.
// Anything else (side-by-side boxes, multi-column layouts, overlapping
// decorative text, identical positions) is ambiguous, and the whole page gets
// NO reading order rather than a guessed one. Missing or non-finite geometry,
// a non-positive size, or any rotation also fail the whole page closed.
// Horizontal position never decides the order.

export type ReadingOrderBox = {
  /** The block's position in the SDK iteration; a unique, stable tie-breaker. */
  originalIndex: number;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
  /** Degrees; absent means unrotated. */
  rotation?: number;
};

export type ReadingOrderResult =
  | {
      trusted: true;
      /** readingOrder[i] is the rank of boxes[i]: 0..n-1, unique. */
      readingOrder: number[];
    }
  | {
      trusted: false;
      reason:
        | "missing_geometry"
        | "rotated"
        | "ambiguous_layout"
        | "duplicate_index";
    };

type Box = {
  /** Index of the box in the input array. */
  position: number;
  originalIndex: number;
  top: number;
  bottom: number;
  center: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isRotated = (rotation: number | undefined): boolean =>
  rotation !== undefined &&
  (!isFiniteNumber(rotation) || rotation % 360 !== 0);

/** True when neither box's vertical centre lies inside the other's span. */
const verticallySeparable = (first: Box, second: Box): boolean =>
  (first.center <= second.top || first.center >= second.bottom) &&
  (second.center <= first.top || second.center >= first.bottom);

export const computeReadingOrder = (
  boxes: readonly ReadingOrderBox[],
): ReadingOrderResult => {
  const indices = new Set(boxes.map(({ originalIndex }) => originalIndex));

  if (
    indices.size !== boxes.length ||
    boxes.some(({ originalIndex }) => !Number.isSafeInteger(originalIndex))
  ) {
    return { trusted: false, reason: "duplicate_index" };
  }

  const measured: Box[] = [];

  for (const box of boxes) {
    const { top, left, width, height } = box;

    if (
      !isFiniteNumber(top) ||
      !isFiniteNumber(left) ||
      !isFiniteNumber(width) ||
      !isFiniteNumber(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return { trusted: false, reason: "missing_geometry" };
    }

    if (isRotated(box.rotation)) {
      return { trusted: false, reason: "rotated" };
    }

    measured.push({
      position: measured.length,
      originalIndex: box.originalIndex,
      top,
      bottom: top + height,
      center: top + height / 2,
    });
  }

  for (const [index, first] of measured.entries()) {
    for (const second of measured.slice(index + 1)) {
      if (!verticallySeparable(first, second)) {
        return { trusted: false, reason: "ambiguous_layout" };
      }
    }
  }

  // Separable boxes have distinct tops; originalIndex only keeps the sort
  // total and deterministic.
  const ranked = [...measured].sort(
    (left, right) =>
      left.top - right.top || left.originalIndex - right.originalIndex,
  );
  const readingOrder = measured.map(() => 0);

  ranked.forEach(({ position }, rank) => {
    readingOrder[position] = rank;
  });

  return { trusted: true, readingOrder };
};
