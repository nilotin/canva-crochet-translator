import { describe, expect, it } from "vitest";
import { protectNotation } from "../../notation/protector.js";
import { normalizeSourceNaturalLanguage } from "../normalizer.js";

describe("normalizeSourceNaturalLanguage", () => {
  it.each([
    ["en", "4 stitches long"],
    ["es", "4 puntos de largo"],
  ] as const)("normalizes length shorthand for %s", (language, expected) => {
    expect(normalizeSourceNaturalLanguage("4x uzunluğunda", language)).toBe(
      expected,
    );
  });

  it.each([
    ["en", "9 stitches apart"],
    ["es", "separados por 9 puntos"],
  ] as const)("normalizes spacing shorthand for %s", (language, expected) => {
    expect(
      normalizeSourceNaturalLanguage("aralarında 9x kalacak şekilde", language),
    ).toBe(expected);
  });

  it.each([
    ["en", "4 rounds above the eye"],
    ["es", "4 filas por encima del ojo"],
  ] as const)("normalizes above-eye placement for %s", (language, expected) => {
    expect(
      normalizeSourceNaturalLanguage("gözden 4 sıra üzerinden", language),
    ).toBe(expected);
  });

  it.each([
    ["4x sayıyoruz", "en", "count 4 stitches"],
    ["4x sayıyoruz", "es", "contamos 4 puntos"],
    ["4x üzerinden", "en", "over 4 stitches"],
    ["2x üzerinden", "es", "sobre 2 puntos"],
    ["16x’ in üzerinden", "en", "over 16 stitches"],
    ["16x' in üzerinden", "es", "sobre 16 puntos"],
  ] as const)(
    "normalizes contextual stitch-count x without treating x as notation: %s",
    (source, language, expected) => {
      expect(normalizeSourceNaturalLanguage(source, language)).toBe(expected);
    },
  );

  it.each([
    ["en", "two chains"],
    ["es", "dos cadenas"],
  ] as const)(
    "normalizes written Turkish chain count without introducing digits for %s",
    (language, expected) => {
      expect(normalizeSourceNaturalLanguage("iki zincir", language)).toBe(
        expected,
      );
    },
  );

  it.each([
    ["flodan 32x", "FLO’dan 32x"],
    ["blodan 24x", "24sc in BLO"],
  ] as const)(
    "canonicalizes apostrophe-less FLO/BLO Turkish suffix forms",
    (source, expected) => {
      expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
    },
  );

  it("does not reinterpret ordinary crochet notation or repetition", () => {
    expect(normalizeSourceNaturalLanguage("6x", "en")).toBe("6x");
    expect(normalizeSourceNaturalLanguage("(1x, v) x 6", "es")).toBe(
      "(1x, v) x 6",
    );
    expect(protectNotation("6x").tokens).toHaveLength(1);
    expect(protectNotation("(1x, v) x 6").tokens).toHaveLength(2);
  });

  it("normalizes the live conditional FLO/BLO instruction", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Bu sırayı Flo’dan örüyoruz (çapraz ya da düz sık iğne tekniği ile örenler, Blo’dan örecekler), 6x",
        "en",
      ),
    ).toBe(
      "Work in FLO. If using crossed or regular single crochet, work in BLO instead. 6x",
    );
  });

  it("supports the reverse BLO/FLO conditional instruction", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Bu sırayı BLO’dan örüyoruz (çapraz sık iğne ile örenler FLO’dan örecekler).",
        "en",
      ),
    ).toBe(
      "Work in BLO. If using crossed single crochet, work in FLO instead.",
    );
  });

  it("normalizes a simple FLO instruction without inventing a condition", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Bu sırayı FLO’dan örüyoruz, 6x",
        "en",
      ),
    ).toBe("Work in FLO, 6x");
  });

  it("accepts apostrophe and spacing variants in conditional loop instructions", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Bu sırayı FLO' dan örüyoruz (düz sık iğne tekniği ile örenler, BLO' dan örecekler), 6x",
        "en",
      ),
    ).toBe(
      "Work in FLO. If using regular single crochet, work in BLO instead. 6x",
    );
  });

  it("preserves measurements next to a simple loop instruction", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.20 mm tığ ile bu sırayı FLO’dan örüyoruz",
        "en",
      ),
    ).toBe("2.20 mm tığ ile Work in FLO");
  });

  it("does not rewrite an unsupported conditional technique unsafely", () => {
    const source =
      "Bu sırayı FLO’dan örüyoruz (farklı bir teknik kullananlar, BLO’dan örecekler)";

    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(
      "Work in FLO (farklı bir teknik kullananlar, BLO’dan örecekler)",
    );
  });


  it("normalizes a hook intro when the yarn brand follows ile", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.20 numara tığ, siyah ip ile (catania 110) örüyoruz.",
        "en",
      ),
    ).toBe(
      "Using a 2.20 mm crochet hook and siyah yarn (catania 110), work as follows.",
    );
  });

  it("normalizes the live hook and yarn intro into crochet-native English", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.20 numara tığ, siyah ip (Catania 110) ile örüyoruz.",
        "en",
      ),
    ).toBe(
      "Using a 2.20 mm crochet hook and siyah Catania 110 yarn, work as follows.",
    );
  });

  it("normalizes a hook intro with color and parenthesized yarn brand", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.20 numara tığ, Mor renk (catania 240) ip ile örüyoruz.",
        "en",
      ),
    ).toBe(
      "Using a 2.20 mm crochet hook and purple yarn (catania 240), work as follows.",
    );
  });

  it("normalizes a simple hook intro", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.5 mm tığ ile örüyoruz.",
        "en",
      ),
    ).toBe("Using a 2.5 mm crochet hook, work as follows.");
  });

  it("normalizes hook-use phrasing without changing decimal precision", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "3.00 mm tığ kullanıyoruz.",
        "en",
      ),
    ).toBe("Use a 3.00 mm crochet hook.");
  });

  it("normalizes Turkish hook-number wording to millimeters", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.00 no tığ ile örüyoruz.",
        "en",
      ),
    ).toBe("Using a 2.00 mm crochet hook, work as follows.");
  });

  it("supports the same hook intro structure in Spanish", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.20 numara tığ ile örüyoruz.",
        "es",
      ),
    ).toBe(
      "Con un ganchillo de 2.20 mm, tejemos de la siguiente manera.",
    );
  });

  it.each([
    [
      "Sihirli halka içine 6x , Başlangıç noktamız burası olacak. İşaretleyiciyi buraya takıyoruz.",
      "6x into the magic ring. This will be the beginning of the round; place a stitch marker here.",
    ],
    ["12 sıra 66x", "12 rounds, 66x"],
    ["3 sıra 78x", "3 rounds, 78x"],
    ["Sihirli halka içine 6x", "6x into the magic ring"],
    ["2 zincir 2x atla", "ch 2, skip 2 sts"],
    ["zincir içine 2x", "2x into the chain space"],
  ])("normalizes crochet instruction structure: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "12. sıranın sonunda 4 zincir (düğme iliği) dön",
      "At the end of Round 12, ch 4 (buttonhole) and turn.",
    ],
    [
      "27. sıranın sonunda 3 zincir (düğme iliği) dön",
      "At the end of Round 27, ch 3 (buttonhole) and turn.",
    ],
  ])("normalizes round-end buttonhole turns: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "6 zincir atlayıp (düğme iliği oluşturuyoruz), yedinci zincirden itibaren 49x örüyoruz",
      "Skip 6 chains (to form a buttonhole), then work 49x starting from the seventh chain",
    ],
    [
      "4 zincir atlayıp (düğme iliği oluşturuyoruz), üçüncü zincirden itibaren 12x örüyoruz",
      "Skip 4 chains (to form a buttonhole), then work 12x starting from the third chain",
    ],
  ])("normalizes reusable buttonhole skip-and-work phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "42x - 5 zincir (düğme iliği) dön",
      "42x, ch 5 (buttonhole) and turn",
    ],
    [
      "18x – 4 zincir (düğme iliği) dön",
      "18x, ch 4 (buttonhole) and turn",
    ],
  ])("normalizes reusable buttonhole chain-turn phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    ["7 zincir çekip dönüyoruz.", "Ch 7 and turn."],
    ["4 zincir dön", "Ch 4 and turn"],
    ["3 zincir, dön", "Ch 3 and turn"],
    ["ikinci zincirden itibaren", "Starting from the second chain"],
    ["aynı ilmek içine 3x", "3sc in the same stitch"],
    ["aynı ilmek içine 3tr", "3tr in the same stitch"],
    [
      "zincirin diğer tarafından devam ediyoruz",
      "continue along the other side of the chain",
    ],
    ["32x BLO'dan", "32sc in BLO"],
    ["BLO'dan 32x", "32sc in BLO"],
    ["aynı zincir içine 3x", "3sc in the same chain"],
    ["aynı sık iğne içine 3tr", "3tr in the same stitch"],
  ])("normalizes reusable foot and leg phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "2 zincir çekip devam ediyoruz.",
      "Ch 2 and continue.",
    ],
    [
      "5 zincir çekip devam ediyoruz",
      "Ch 5 and continue",
    ],
  ])("normalizes chain-and-continue phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it("normalizes bangs count followed by long-hair continuation", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Toplamda 7 tane kahkülümüz olacak. Tekrar uzun saç tellerini örmeye devam ediyoruz.",
        "en",
      ),
    ).toBe(
      "We will have 7 bangs in total. Continue making the long hair strands.",
    );
  });

  it("normalizes a total bangs count", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Toplamda 7 tane kahkülümüz olacak.",
        "en",
      ),
    ).toBe("We will have 7 bangs in total.");
  });

  it("turns a comma-separated hair transition into a sentence boundary", () => {
    expect(
      normalizeSourceNaturalLanguage(
        ", 3 tane uzun saç teli ördükten sonra kahkülleri öreceğiz.",
        "en",
      ),
    ).toBe(
      ". After making 3 long hair strands, work the bangs.",
    );
  });

  it.each([
    [
      "1x atla sıradaki sık iğneye cc",
      "skip 1x, cc into the next stitch",
    ],
    [
      "3 tane uzun saç teli ördükten sonra kahkülleri öreceğiz.",
      "After making 3 long hair strands, work the bangs.",
    ],
  ])("normalizes reusable hair-strand phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "46 zincir çekip geriye dönüyoruz,",
      "Ch 46 and turn.",
    ],
    [
      "21 zincir çekip geriye dönüyoruz.",
      "Ch 21 and turn.",
    ],
    [
      "zincir üzerine ikinci zincirden itibaren 45x",
      "Starting from the second chain, 45x",
    ],
    [
      "ikinci zincirden itibaren 20x",
      "Starting from the second chain, 20x",
    ],
    [
      "1x atla, sıradaki sık iğneye cc",
      "skip 1x, cc into the next stitch",
    ],
  ])("normalizes reusable chain-turn hair-strand phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    ["4 zincir atlıyoruz", "skip 4 chains"],
    ["3. zincirden itibaren 18x", "Starting from the 3rd chain, work 18x"],
    ["zincir üzerine 5x", "work 5x along the chain"],
  ])("normalizes reusable chain-position phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "6 zincir atlayıp",
      "Skip 6 chains and",
    ],
    [
      "yedinci zincirden itibaren 49x örüyoruz",
      "Starting from the seventh chain, work 49x",
    ],
    [
      "üçüncü zincirden itibaren 12x",
      "Starting from the third chain, work 12x",
    ],
  ])("normalizes reusable written chain-position phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "1 zincir çekip ipimizi dikiş için uzun kesiyoruz.",
      "Ch 1 and cut the yarn, leaving a long tail for sewing.",
    ],
    [
      "1 zincir çekip ördüğümüz parçanın iki ucunu, görselde görüldüğü gibi cc ile birleştiriyoruz.",
      "Ch 1 and join the two ends of the piece with cc as shown in the image.",
    ],
    [
      "2 zincir çekip bir üst sıradan devam ediyoruz.",
      "Ch 2 and continue with the next round.",
    ],
  ])("normalizes reusable finishing and joining phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    ["1. zincirden itibaren 8x", "Starting from the 1st chain, work 8x"],
    ["2. zincirden itibaren 8x", "Starting from the 2nd chain, work 8x"],
    ["4. zincirden itibaren 8x", "Starting from the 4th chain, work 8x"],
    ["11. zincirden itibaren 8x", "Starting from the 11th chain, work 8x"],
    ["21. zincirden itibaren 8x", "Starting from the 21st chain, work 8x"],
    ["22. zincirden itibaren 8x", "Starting from the 22nd chain, work 8x"],
    ["23. zincirden itibaren 8x", "Starting from the 23rd chain, work 8x"],
  ])("renders numeric chain ordinals safely: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    ["9 zincir, 10x atla", "ch 9, skip 10 sts"],
    ["4 zincir, 3x atla", "ch 4, skip 3 sts"],
  ])("normalizes comma-separated chain-and-skip phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "zincir üzerine ikinci zincirden 37x örüyoruz",
      "Starting from the second chain, work 37x along the chain",
    ],
    [
      "Sıradaki sık iğneye cc",
      "cc into the next single crochet",
    ],
    [
      "yeniden 18 zincir çekip aynı şekilde devam ediyoruz",
      "then ch 18 again and aynı şekilde devam ediyoruz",
    ],
    [
      "Sıra sonuna geldiğimizde 2 zincir çekip ipimizi kesiyoruz.",
      "At the end of the round, ch 2 and cut the yarn.",
    ],
  ])("normalizes reusable continuation phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "2 zincir çekip ipimizi kesiyoruz",
      "ch 2 and cut the yarn",
    ],
    [
      "120dc, 2 zincir çekip ipimizi kesiyoruz",
      "120dc, ch 2 and cut the yarn",
    ],
  ])("normalizes standalone chain-and-cut phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "18x örüyoruz.",
      "Work 18x.",
    ],
    [
      "7dc örüyoruz.",
      "Work 7dc.",
    ],
    [
      "5tr örüyoruz.",
      "Work 5tr.",
    ],
  ])("normalizes standalone stitch-count work instructions: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "ilk parçanın bittiği yerden 3cc atlıyoruz.",
      "Skip 3cc from ilk parçanın bittiği yer.",
    ],
    [
      "başlangıç noktasının yanındaki yerden 2x atlıyoruz.",
      "Skip 2x from başlangıç noktasının yanındaki yer.",
    ],
  ])("normalizes location-aware counted stitch skipping: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "3cc atlıyoruz.",
      "Skip 3cc.",
    ],
    [
      "2x atlıyoruz.",
      "Skip 2x.",
    ],
  ])("normalizes counted stitch skipping: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "İkinci cc’nin BLO’sundan ipimizi sabitliyoruz.",
      "Attach the yarn to the BLO of the second cc.",
    ],
    [
      "İkinci cc'nin FLO'sundan ipimizi sabitliyoruz.",
      "Attach the yarn to the FLO of the second cc.",
    ],
    [
      "Üçüncü x’in BLO’sundan ipimizi sabitliyoruz.",
      "Attach the yarn to the BLO of the third x.",
    ],
  ])("normalizes ordinal stitch loop attachment: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "2 zincir, sıradaki sık iğneye 1x yaparak devam ediyoruz.",
      "Ch 2 and work 1x in the next single crochet while devam ediyoruz.",
    ],
    [
      "1 zincir, sıradaki sık iğneye 2x yaparak devam ediyoruz.",
      "Ch 1 and work 2x in the next single crochet while devam ediyoruz.",
    ],
  ])("normalizes a bare chain prefix before next-stitch phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "iki parça arasındaki cc üzerine yine cc yapıyoruz.",
      "Work another cc into the cc between the two pieces.",
    ],
    [
      "üç parça arasındaki x üzerine yine x yapıyoruz.",
      "Work another x into the x between the three pieces.",
    ],
  ])("normalizes repeated work into a referenced stitch: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "(3 zincir, sıradaki sık iğneye 1x)*12",
      "(ch 3, 1x in the next single crochet)*12",
    ],
    [
      "(2 zincir, sıradaki sık iğneye 2x)*8",
      "(ch 2, 2x in the next single crochet)*8",
    ],
  ])("normalizes repeated chain and next-stitch phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "sıradaki sık iğneye 1x",
      "1x in the next single crochet",
    ],
    [
      "sıradaki sık iğneye 3x",
      "3x in the next single crochet",
    ],
  ])("normalizes counted stitches worked into the next single crochet: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it("normalizes a counted slip-stitch instruction", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "12cc (ilmek kaydırma) yapıyoruz.",
        "en",
      ),
    ).toBe("Work 12cc (slip stitches).");
  });

  it.each([
    [
      "İlmek kaydırmaların BLO’sundan 9x örüyoruz.",
      "Work 9x in the BLO of the slip stitches.",
    ],
    [
      "İlmek kaydırmaların FLO'sundan 9x örüyoruz.",
      "Work 9x in the FLO of the slip stitches.",
    ],
  ])("normalizes loop work over a slip-stitch group: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it("normalizes chain-and-turn wording with geriye", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "8 zincir çekip geriye dönüyoruz.",
        "en",
      ),
    ).toBe("Ch 8 and turn.");
  });

  it("normalizes zincir üzerine before the second-chain instruction", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Zincir üzerine ikinci zincirden itibaren",
        "en",
      ),
    ).toBe("Starting from the second chain");
  });

  it("normalizes multi-stitch decrease explanations", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "M(aynı anda üç ilmeği birlikte kesmek)",
        "en",
      ),
    ).toBe("M (decrease 3 stitches together)");
  });

  it("normalizes a stitch-count row followed by a chain-and-cut instruction", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "52) 24x, 1 zincir çekip ipimizi kesiyoruz.",
        "en",
      ),
    ).toBe("52) 24sc. Ch 1 and cut the yarn.");
  });

  it("normalizes a yarn-color heading that also cuts the orange yarn", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Ekru renk ip ile; (Turuncu ipimizi kesiyoruz.)",
        "en",
      ),
    ).toBe("With ecru yarn: (Cut the orange yarn.)");
  });

  it("normalizes round counts followed by a written one-chain cut-yarn instruction", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "11-35) 25 sıra 12x bir zincir çekip ipimizi kesiyoruz.",
        "en",
      ),
    ).toBe(
      "11-35) 25 rounds, 12sc. Ch 1 and cut the yarn.",
    );
  });

  it.each([
    [
      "Başlangıç noktamız burası olacak. İşaretleyiciyi buraya takıyoruz.",
      "This will be the beginning of the round; place a stitch marker here.",
    ],
    [
      "Bu bizim başlangıç noktamız olacak, işaretleyiciyi buraya takıyoruz.",
      "This will be the beginning of the round; place a stitch marker here.",
    ],
    [
      "Burası başlangıç noktamız olacak; işaretleyicimizi buraya takıyoruz.",
      "This will be the beginning of the round; place a stitch marker here.",
    ],
    [
      "Bu başlangıç noktamızdır. Markeri buraya yerleştiriyoruz.",
      "This will be the beginning of the round; place a stitch marker here.",
    ],
  ])("normalizes reusable beginning-of-round marker phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "Ekru renk ip (catania 105) ile başlıyoruz.",
      "Start with ecru yarn (catania 105).",
    ],
    [
      "Turuncu ipimize (catania 411) geçiyoruz.",
      "Switch to orange yarn (catania 411).",
    ],
    [
      "Renk geçişlerinde bir önceki ipi kesmeden, içeride beklemeye alıyoruz.",
      "When changing colors, do not cut the previous yarn; leave it inside until needed again.",
    ],
    [
      "Ekru renk ip ile;",
      "With ecru yarn;",
    ],
    [
      "Turuncu ip ile;",
      "With orange yarn;",
    ],
  ])("normalizes reusable yarn-color phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "Bacakları örerken 6-7 sırada bir dolum yapalım.",
      "While crocheting the legs, add stuffing every 6-7 rounds.",
    ],
    [
      "Doldururken görselde görüldüğü gibi örgünün dönmemesine dikkat edelim.",
      "While stuffing, make sure the work does not twist, as shown in the image.",
    ],
    [
      "Dolum yaptıkça elimizle örgüyü sürekli düzeltirsek, örgümüz dönmez ve bacaklar çok muntazam olur.",
      "If you keep straightening the work with your hands as you stuff, it will not twist and the legs will look much neater.",
    ],
  ])("normalizes reusable stuffing guidance: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "İkinci bacakta da ilk 51 sırayı aynı şekilde örüyoruz.",
      "On the second leg, work the first 51 rounds in the same way.",
    ],
    [
      "12x örüyoruz, ipimizi kesmeden gövde ile devam ediyoruz.",
      "Work 12sc, then continue with the body without cutting the yarn.",
    ],
  ])("normalizes reusable second-leg continuation phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it("normalizes reusable leg-alignment guidance", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Bende her iki bacağın bitiş noktası bacağın iç kısmının ortasına denk geldi. Sizde denk gelmiyorsa 1-2 sık iğne eksik ya da fazla örerek orta noktaya gelin.",
        "en",
      ),
    ).toBe(
      "For me, the finishing point of both legs aligned with the center of the inner side of each leg. If yours does not align, work 1-2 fewer or additional single crochet stitches to reach the center.",
    );
  });

  it.each([
    [
      "İkinci bacaktan 3 zincir ile bacakların arka tarafı bize dönük olacak şekilde ilk bacak ile birleştiriyoruz.",
      "From the second leg, ch 3 and join to the first leg with the backs of the legs facing you.",
    ],
    [
      "26x(ilk bacak)",
      "26sc (first leg)",
    ],
    [
      "26x (ikinci bacak)",
      "26sc (second leg)",
    ],
    [
      "3x (zincir üstü)",
      "3sc (along the chain)",
    ],
  ])("normalizes reusable leg-join phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    "⊱KOL BIRLEŞTIRME⊰",
    "⊱KOL BİRLEŞTİRME⊰",
  ])("normalizes the arm-joining heading: %s", (source) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(
      "⊱ARM JOINING⊰",
    );
  });

  it("normalizes continuing with arm joining without cutting the yarn", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "15-29) 15 sıra 42x, İpimizi kesmeden kol birleştirme ile devam ediyoruz.",
        "en",
      ),
    ).toBe(
      "15-29) 15 rounds, 42x. Without cutting the yarn, continue by joining the arms.",
    );
  });

  it.each([
    ["FLO ‘dan (5x, 1v)*6 = 42x", "In FLO, (5x, 1v)*6 = 42x"],
    ["BLO'dan (5x, 1v)*6 = 42x", "In BLO, (5x, 1v)*6 = 42x"],
  ])("normalizes short loop-origin phrasing: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it("normalizes continuing with hair strands without cutting the yarn", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "60x örüyoruz ipimizi kesmeden saç telleri ile devam ediyoruz.",
        "en",
      ),
    ).toBe(
      "60sc. Without cutting the yarn, continue with the hair strands.",
    );
  });

  it("normalizes the representative-photo notice for pattern instructions", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Fotoğraf temsilidir.",
        "en",
      ),
    ).toBe("The images are for reference only.");
  });

  it("uses insert for amigurumi eye placement verbs", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Gözleri takacağız. Gözleri yerleştirebiliriz.",
        "en",
      ),
    ).toBe("we will insert the eyes. we can insert the eyes.");
  });

  it.each([
    [
      "Kirpikleri görsele bakarak işleyebiliriz.",
      "Embroider the eyelashes following the reference image.",
    ],
    [
      "Kaşları ve kirpikleri görsele bakarak işleyebiliriz.",
      "Embroider the eyebrows and eyelashes following the reference image.",
    ],
  ])(
    "normalizes reference-image embroidery phrasing: %s",
    (source, expected) => {
      expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
    },
  );

  it("normalizes directional ear placement from the eyelash edge", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Kirpik bitiminden 4x sayıyoruz, 1x, 3dc, 1x yukarıdan aşağı doğru örüyoruz. Diğer kulağı da aynı şekilde aşağıdan yukarı doğru örüyoruz.",
        "en",
      ),
    ).toBe(
      "Count 4 stitches from the end of the eyelashes. Work 1sc, 3dc, 1sc from top to bottom. Work the other ear in the same way, from bottom to top.",
    );
  });

  it("normalizes reusable ear sewing and placement instructions", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "1 zincir çekip kafaya dikmek için ipimizi uzun kesiyoruz. Üst kirpikten 6x sayıyoruz ve burayı işaretliyoruz. Aşağı doğru 5x sayıp burayı da işaretliyoruz. Bu 5x üzerinden kulakları dikiyoruz.",
        "en",
      ),
    ).toBe(
      "ch 1. Cut the yarn, leaving a long tail for sewing the ear to the head. Count 6 stitches from the upper eyelash and mark that point. Count 5 stitches downward and mark that point as well. Sew the ears along these 5 stitches.",
    );
  });

  it.each([
    [
      "Kaş: 5x uzunluğunda, aralarında 10x kalacak şekilde, gözden 3 sıra üzerinden işliyoruz.",
      "Eyebrow: Embroider the eyebrows 5 stitches long, 10 stitches apart, 3 rounds above the eyes.",
    ],
    [
      "Burun: gözün bir sıra altında 4x üzerinden dolama yöntemi ile işliyoruz.",
      "Nose: One round below the eyes, embroider over 4 stitches using the wrap-around method.",
    ],
    [
      "Ağız: Toz pastel ile boyadım. (İsterseniz burnun 4 sıra altından, 2x üzerinden işleyebilirsiniz.)",
      "Mouth: I colored it with soft pastels. (If you prefer, you can embroider the mouth 4 rounds below the nose over 2 stitches.)",
    ],
    [
      "13-38) 26 sıra 14x  örüyoruz, 1 zincir \nçekip ipimizi kesiyoruz.",
      "13-38) 26 rounds, 14 sc. Ch 1 and cut the yarn.",
    ],
  ])("normalizes a complete crochet instruction: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "Kaş — 5x uzunluğunda, aralarında 10x kalacak şekilde, gözden 3 sıra üzerinden işliyoruz.",
      "Eyebrow: Embroider the eyebrows 5 stitches long, 10 stitches apart, 3 rounds above the eyes.",
    ],
    [
      "Burun - gözün bir sıra altından, 4x üzerinden dolama yöntemi ile işliyoruz.",
      "Nose: One round below the eyes, embroider over 4 stitches using the wrap-around method.",
    ],
    [
      "Ağız; Toz pastel ile boyadım. (İsterseniz burnun 4 sıra altından, 2x üzerinden işleyebilirsiniz.)",
      "Mouth: I colored it with soft pastels. (If you prefer, you can embroider the mouth 4 rounds below the nose over 2 stitches.)",
    ],
  ])("normalizes punctuation and case variants: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "5x uzunluğunda, aralarında 10x kalacak şekilde, gözden 3 sıra üzerinden işliyoruz.",
      "Embroider the eyebrows 5 stitches long, 10 stitches apart, 3 rounds above the eyes.",
    ],
    [
      "gözün bir sıra altında 4x üzerinden dolama yöntemi ile işliyoruz.",
      "One round below the eyes, embroider over 4 stitches using the wrap-around method.",
    ],
    [
      "Toz pastel ile boyadım.",
      "I colored it with soft pastels.",
    ],
    [
      "İsterseniz burnun 4 sıra altından, 2x üzerinden işleyebilirsiniz.",
      "If you prefer, you can embroider the mouth 4 rounds below the nose over 2 stitches.",
    ],
  ])("normalizes split face-detail fragments: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it("leaves the new English-specific constructions unchanged in Spanish", () => {
    const source =
      "Burun: gözün bir sıra altında 4x üzerinden dolama yöntemi ile işliyoruz.";

    expect(normalizeSourceNaturalLanguage(source, "es")).not.toContain(
      "Nose:",
    );
  });

});
