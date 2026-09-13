import { describe, expect, it } from "vitest";
import { normalizeTranslationStyle } from "../style_normalizer.js";

describe("normalizeTranslationStyle", () => {
  it.each([
    ["Ch 55 ch.", "Ch 55."],
    ["Ch 2 ch", "Ch 2"],
    ["Ch 55 ch. Fasten off. Ch 2 ch.", "Ch 55. Fasten off. Ch 2."],
  ])("removes redundant English chain notation from %s", (input, expected) => {
    expect(normalizeTranslationStyle("zn", input, "en")).toBe(expected);
  });

  it("does not globally remove English ch", () => {
    expect(normalizeTranslationStyle("zn", "Work 2 ch stitches.", "en")).toBe(
      "Work 2 ch stitches.",
    );
  });

  it.each([
    ["FLO work.", "Work in FLO."],
    ["FLO Work.", "Work in FLO."],
    ["BLO work.", "Work in BLO."],
    ["BLO Work.", "Work in BLO."],
    ["FLO crochet.", "Work in FLO."],
    ["BLO crochet.", "Work in BLO."],
    ["FLO We crochet.", "Work in FLO."],
    ["BLO We crochet.", "Work in BLO."],
  ])("normalizes simple English loop instruction %s", (input, expected) => {
    expect(normalizeTranslationStyle("örüyoruz", input, "en")).toBe(expected);
  });

  it.each([
    ["Flo tejemos.", "Tejemos en Flo."],
    ["Blo tejemos.", "Tejemos en Blo."],
  ])("normalizes simple Spanish loop instruction %s", (input, expected) => {
    expect(normalizeTranslationStyle("örüyoruz", input, "es")).toBe(expected);
  });

  it.each([
    ["FLO örüyoruz.", "en", "FLO.", "Work in FLO."],
    ["BLO örüyoruz.", "en", "BLO.", "Work in BLO."],
    ["FLO örüyoruz.", "es", "Flo.", "Tejemos en Flo."],
    ["BLO örüyoruz.", "es", "Blo.", "Tejemos en Blo."],
  ] as const)(
    "uses the exact short loop source for stable %s output",
    (source, language, input, expected) => {
      expect(normalizeTranslationStyle(source, input, language)).toBe(expected);
    },
  );

  it.each([
    ["en", "Create sc with 6mr.", "1. Work 6sc into a mr."],
    ["es", "Formamos pb con 6am.", "1. Hacemos 6 pb en un am."],
  ] as const)(
    "normalizes the recognized magic-ring source for %s",
    (language, input, expected) => {
      expect(
        normalizeTranslationStyle(
          "1. 6x ile sh oluşturuyoruz.",
          input,
          language,
        ),
      ).toBe(expected);
    },
  );

  it("does not infer a magic-ring rewrite from unrelated source text", () => {
    expect(
      normalizeTranslationStyle(
        "Başka bir talimat.",
        "Create sc with 6mr.",
        "en",
      ),
    ).toBe("Create sc with 6mr.");
  });

  it.each([
    [
      "13) 7. sırada Flo’dan ördüğümüz sık iğnelerin, Blo’sundan ipimizi sabitliyoruz. Sonra devam ediyoruz.",
      "13) in Round 7 FLO of the single crochets we worked, BLO we secure our yarn from. Then continue.",
      "13) Attach the yarn to the BLO of the single crochet stitches worked in the FLO of Round 7. Then continue.",
    ],
    [
      "4) 12. sırada BLO’dan ördüğümüz sık iğnelerinin FLO’sundan ipimizi sabitliyoruz.",
      "4) in Round 12 BLO stitches worked FLO attach yarn.",
      "4) Attach the yarn to the FLO of the single crochet stitches worked in the BLO of Round 12.",
    ],
  ])(
    "normalizes a nested round/loop attachment relation",
    (source, translated, expected) => {
      expect(
        normalizeTranslationStyle(source, translated, "en"),
      ).toBe(expected);
    },
  );

  it.each([
    [
      "4) 12. sırada BLO’dan ördüğümüz sık iğnelerinin FLO’sundan ipimizi sabitliyoruz.",
      "4) in Round 12 BLO stitches worked FLO attach yarn.",
      "4) Attach the yarn to the FLO of the single crochet stitches worked in the BLO of Round 12.",
    ],
    [
      "6) 18. sırada FLO’dan ördüğümüz sık iğnelerin BLO’sundan ipimizi sabitliyoruz.",
      "6) in Round 18 FLO stitches worked BLO attach yarn.",
      "6) Attach the yarn to the BLO of the single crochet stitches worked in the FLO of Round 18.",
    ],
    [
      "9) 18. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan siyah ipimizi sabitliyoruz.",
      "9) in Round 18 BLO stitches worked FLO secure black yarn.",
      "9) Attach the black yarn to the FLO of the single crochet stitches worked in the BLO of Round 18.",
    ],
  ])(
    "normalizes directional loop attachment with optional yarn color",
    (source, translated, expected) => {
      expect(
        normalizeTranslationStyle(source, translated, "en"),
      ).toBe(expected);
    },
  );

  it("accepts a comma before the colored yarn in loop attachment phrasing", () => {
    expect(
      normalizeTranslationStyle(
        "8) 18. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan, yeşil ipimizi sabitliyoruz.",
        "8) in Round 18 BLO stitches worked FLO secure green yarn.",
        "en",
      ),
    ).toBe(
      "8) Attach the green yarn to the FLO of the single crochet stitches worked in the BLO of Round 18.",
    );
  });

  it("drops duplicated provider prose before the next numbered instruction", () => {
    const source =
      "27) 23. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan siyah ipimizi sabitliyoruz. " +
      "1) 72dcv = 144dc, 2 zincir, dön, " +
      "2) 144dc, 1 zincir çekip ipimizi kesiyoruz.";

    const translated =
      "27) in Round 23 BLO of the single crochets we made from FLO we secure our black yarn through the " +
      "1) 72dc-inc = 144dc, Ch 2 and turn, " +
      "2) 144dc, Ch 1 and cut the yarn.";

    expect(
      normalizeTranslationStyle(source, translated, "en"),
    ).toBe(
      "27) Attach the black yarn to the FLO of the single crochet stitches worked in the BLO of Round 23. " +
        "1) 72dc-inc = 144dc, Ch 2 and turn, " +
        "2) 144dc, Ch 1 and cut the yarn.",
    );
  });

  it("does not rewrite longer FLO/BLO instructions", () => {
    expect(
      normalizeTranslationStyle(
        "FLO örüyoruz.",
        "FLO work across the entire round.",
        "en",
      ),
    ).toBe("FLO work across the entire round.");
  });

  it.each([
    ["2.00 no tığ ile örüyoruz.", "2.00 crochet without a hook."],
    ["2.5 mm tığ ile örüyoruz.", "2.5 mm crochet hook."],
    ["3.00 mm tığ kullanıyoruz.", "3.00 mm crochet hook."],
  ])(
    "does not introduce a source numeric literal during style normalization: %s",
    (source, translated) => {
      const normalized = normalizeTranslationStyle(source, translated, "en");
      expect(normalized).toBe(translated);
      expect(normalized.match(/\d+(?:[.,]\d+)?/gu)).toHaveLength(1);
    },
  );

  it.each([
    ["en", "(1sc, inc) x 6"],
    ["es", "(1pb, aum) x 6"],
    ["en", "6sc, inc, 6sc, SL.ST"],
    ["es", "6pb, aum, 6pb, pd"],
    ["en", "hdc-inc, dc-inc, dc-dec, esc-inc"],
    ["es", "aum-mpa, aum-pa, dism-pa, aum-pb-ex"],
    ["en", "esc, esc-inc, escw"],
    ["es", "pb-ex, aum-pb-ex, W-pb-ex"],
  ] as const)("leaves known-good %s notation unchanged", (language, text) => {
    expect(normalizeTranslationStyle("pattern", text, language)).toBe(text);
  });

  it("uses back/front terminology in reverse single crochet explanations", () => {
    const source =
      "Ters sık iğne tekniğinde sık iğnelerin ters yüzü dışarı bakar, düz yüzü içeride kalır.";

    expect(
      normalizeTranslationStyle(
        source,
        "In the reverse single crochet technique, the wrong side of the single crochet stitches faces outward, while the right side of the single crochet stitches remains on the inside.",
        "en",
      ),
    ).toBe(
      "In the reverse single crochet technique, the back of the single crochet stitches faces outward, while the front of the single crochet stitches remains on the inside.",
    );
  });

  it("does not globally replace wrong side and right side outside the crochet context", () => {
    expect(
      normalizeTranslationStyle(
        "Parçanın ters yüzünü kontrol ediyoruz.",
        "Check the wrong side of the piece.",
        "en",
      ),
    ).toBe("Check the wrong side of the piece.");
  });

  it("does not infer reverse single crochet from ordinary fabric-side wording", () => {
    const source =
      "Sık iğnelerin ters yüzü dışarı bakıyor, düz yüzü içeride kalıyor.";

    expect(
      normalizeTranslationStyle(
        source,
        "The wrong side of the single crochet stitches faces outward, while the right side remains on the inside.",
        "en",
      ),
    ).toBe(
      "The wrong side of the single crochet stitches faces outward, while the right side remains on the inside.",
    );
  });

  it("supports the shorter wrong-side/right-side wording in reverse single crochet context", () => {
    const source =
      "Ters sık iğne örerken ters yüz dışarıda, düz yüz içeride kalıyor.";

    expect(
      normalizeTranslationStyle(
        source,
        "The wrong side faces outward and the right side remains on the inside.",
        "en",
      ),
    ).toBe(
      "The back of the stitches faces outward and the front of the stitches remains on the inside.",
    );
  });

  it.each([
    ["12 sıra 66x", "12 round 66sc", "12 rounds, 66 sc"],
    ["3 sıra 78x", "3 round 78sc", "3 rounds, 78 sc"],
    [
      "Sihirli halka içine 6x",
      "Into the magic ring 6sc",
      "6sc into the magic ring",
    ],
  ])(
    "uses source counts to normalize crochet instruction phrasing: %s",
    (source, translated, expected) => {
      expect(normalizeTranslationStyle(source, translated, "en")).toBe(
        expected,
      );
    },
  );

  it("normalizes a combined chain-and-skip round", () => {
    expect(
      normalizeTranslationStyle(
        "24) 15x, 2 zincir 2x atla, 9x, 2 zincir 2x atla, 38x (zincirlerle oluşturduğumuz boşluklara daha sonra gözleri takacağız)",
        "24) 15sc, 2 chain skip 2sc, 9sc, 2 chain skip 2sc, 38sc (the spaces created with the chains, we will attach the eyes later)",
        "en",
      ),
    ).toBe(
      "24) 15sc, ch 2, skip 2 sts, 9sc, ch 2, skip 2 sts, 38sc (we will insert the eyes into these chain spaces later)",
    );
  });

  it("normalizes a combined chain-space round without changing its equation", () => {
    expect(
      normalizeTranslationStyle(
        "25) 15x, zincir içine 2x, 9x, zincir içine 2x, 38x = 66x",
        "25) 15sc, into the chain 2sc, 9sc, into the chain 2sc, 38sc = 66sc",
        "en",
      ),
    ).toBe(
      "25) 15sc, 2sc into the chain space, 9sc, 2sc into the chain space, 38sc = 66sc",
    );
  });


  it("uses singular stitch grammar when skipping one stitch", () => {
    expect(
      normalizeTranslationStyle(
        "23) 29x, 1 zincir 1x atla, 9x, 1 zincir 1x atla, 20x",
        "23) 29sc, 1 chain skip 1sc, 9sc, 1 chain skip 1sc, 20sc",
        "en",
      ),
    ).toBe(
      "23) 29sc, ch 1, skip 1 st, 9sc, ch 1, skip 1 st, 20sc",
    );
  });

  it("normalizes stitches worked over a chain space", () => {
    expect(
      normalizeTranslationStyle(
        "24) 29x, zincir üzeri 1x, 9x, zincir üzeri 1x, 20x = 60x",
        "24) 29sc, along the chain 1sc, 9sc, along the chain 1sc, 20sc = 60sc",
        "en",
      ),
    ).toBe(
      "24) 29sc, 1sc into the chain space, 9sc, 1sc into the chain space, 20sc = 60sc",
    );
  });

  it("normalizes eye placement into the chain spaces", () => {
    expect(
      normalizeTranslationStyle(
        "✦ Bu sıradan sonra gözleri boşluklara takıyoruz.",
        "✦ After this round, attach the eyes in the gaps.",
        "en",
      ),
    ).toBe(
      "✦ After this round, insert the eyes into the chain spaces.",
    );
  });

  it.each([
    [
      "(zincirlerle oluşturduğumuz boşluklara daha sonra gözleri takacağız)",
      "(the spaces created with the chains, we will attach the eyes later)",
      "(we will insert the eyes into these chain spaces later)",
    ],
    [
      "Bu sıradan sonra gözleri boşluklara yerleştirebiliriz.",
      "After this row, we can place the eyes in the gaps.",
      "After this round, we can insert the eyes into the chain spaces.",
    ],
  ])("normalizes amigurumi eye insertion wording", (source, input, expected) => {
    expect(normalizeTranslationStyle(source, input, "en")).toBe(expected);
  });

  it("normalizes continuing with hair strands", () => {
    expect(
      normalizeTranslationStyle(
        "11) 60x örüyoruz ipimizi kesmeden saç telleri ile devam ediyoruz.",
        "11) 60sc We continue crocheting the hair strands without cutting the yarn.",
        "en",
      ),
    ).toBe(
      "11) 60sc. Without cutting the yarn, continue with the hair strands.",
    );
  });

  it("normalizes a short FLO round", () => {
    expect(
      normalizeTranslationStyle(
        "7) FLO ‘dan (5x, 1v)*6 = 42x",
        "7) FLO from (5sc, 1inc)*6 = 42sc",
        "en",
      ),
    ).toBe(
      "7) In FLO, (5sc, 1inc)*6 = 42sc",
    );
  });

  it("normalizes a branded color-yarn hook intro", () => {
    expect(
      normalizeTranslationStyle(
        "✦ 2.20 numara tığ, Mor renk (catania 240) ip ile örüyoruz.",
        "✦ 2.20 size crochet hook, Purple color (Catania 240) We crochet with yarn.",
        "en",
      ),
    ).toBe(
      "✦ Using a 2.20 mm crochet hook and purple yarn (catania 240), work as follows.",
    );
  });

  it("prefers Using for a crochet-hook instruction intro", () => {
    expect(
      normalizeTranslationStyle(
        "2.00 mm tığ ile örüyoruz.",
        "With a 2.00 mm crochet hook, work as follows.",
        "en",
      ),
    ).toBe("Using a 2.00 mm crochet hook, work as follows.");
  });

  it("normalizes a finishing hair-strand instruction", () => {
    expect(
      normalizeTranslationStyle(
        "✦ 46 zincir çekip geriye dönüyoruz, zincir üzerine ikinci zincirden itibaren 45x, 1x atla, sıradaki sık iğneye cc... bu şekilde sıra sonuna kadar devam ediyoruz. Sıra sonuna geldiğimizde 1 zincir çekip dikiş için ipimizi uzun kesiyoruz.",
        "✦ Ch 46 and turn, Starting from the second chain 45sc, skip 1sc, the next single crochet SL.ST... we continue in this way until the end of the round. When we reach the end of the round 1 we chain and cut the yarn long for sewing.",
        "en",
      ),
    ).toBe(
      "✦ Ch 46 and turn. Starting from the second chain, 45sc, skip 1sc, SL.ST into the next stitch. Continue in this way to the end of the round. At the end of the round, ch 1 and cut the yarn, leaving a long tail for sewing.",
    );
  });

  it("normalizes a repeated hair-strand instruction", () => {
    expect(
      normalizeTranslationStyle(
        "(21 zincir çekip geriye dönüyoruz, zincir üzerine ikinci zincirden itibaren 20x, 1x atla, sıradaki sık iğneye cc)*7",
        "(21 Chain and turn, Starting from the second chain 20sc, skip 1sc, SL.ST into the next single crochet)*7",
        "en",
      ),
    ).toBe(
      "(Ch 21 and turn. Starting from the second chain, 20sc, skip 1sc, SL.ST into the next stitch)*7",
    );
  });

  it("normalizes repeated long hair strands followed by bangs", () => {
    expect(
      normalizeTranslationStyle(
        "12) (46 zincir çekip geriye dönüyoruz, zincir üzerine ikinci zincirden itibaren 45x, 1x atla sıradaki sık iğneye cc)*3, 3 tane uzun saç teli ördükten sonra kahkülleri öreceğiz.",
        "12) (Ch 46 and turn, Starting from the second chain 45sc, skip 1sc to the next single crochet SL.ST)*3, 3 After crocheting the long hair strands, we will crochet the bangs.",
        "en",
      ),
    ).toBe(
      "12) (Ch 46 and turn. Starting from the second chain, 45sc, skip 1sc, SL.ST into the next stitch)*3. After making 3 long hair strands, work the bangs.",
    );
  });

  it("normalizes a chain-turn foundation instruction with a stitch marker", () => {
    expect(
      normalizeTranslationStyle(
        "1) 4 zincir dön, ikinci zincirden itibaren 2x, aynı ilmek içine 3x, (zincirin diğer tarafından devam ediyoruz), 1x, 1v = 8x   Başlangıç noktamız burası olacak. İşaretleyiciyi buraya takıyoruz.",
        "1) 4 Chain and turn, Starting from the second chain 2sc, into the same stitch 3sc, (We continue along the other side of the chain), 1sc, 1inc = 8sc This will be our starting point. We attach the stitch marker here.",
        "en",
      ),
    ).toBe(
      "1) Ch 4 and turn. Starting from the second chain, 2sc, 3sc in the same stitch (continue along the other side of the chain), 1sc, 1inc = 8sc. This will be the beginning of the round; place a stitch marker here.",
    );
  });

  it("normalizes a chain-turn foundation with side stitches", () => {
    expect(
      normalizeTranslationStyle(
        "1) 8 zincir çekip geriye dönüyoruz. Zincir üzerine ikinci zincirden itibaren 1v, 5x, aynı zincir içine 4x, (zincirin diğer tarafından devam ediyoruz), 5x, 1v = 18x Başlangıç noktamız burası olacak. İşaretleyiciyi buraya takıyoruz.",
        "1) 8 Chain and turn back. On the chain, starting from the second chain 1inc, 5sc, 4sc in the same chain, (continue along the other side of the chain), 5sc, 1inc = 18sc This will be our starting point. Attach the marker here.",
        "en",
      ),
    ).toBe(
      "1) Ch 8 and turn. Starting from the second chain, 1inc, 5sc, 4sc in the same chain (continue along the other side of the chain), 5sc, 1inc = 18sc. This will be the beginning of the round; place a stitch marker here.",
    );
  });

  it("normalizes stitches worked into the same stitch", () => {
    expect(
      normalizeTranslationStyle(
        "6) Aynı ilmek içine 3tr, 11x",
        "6) Into the same stitch 3tr, 11sc",
        "en",
      ),
    ).toBe("6) 3tr in the same stitch, 11sc");
  });

  it("normalizes multi-stitch decrease explanations", () => {
    expect(
      normalizeTranslationStyle(
        "7) M(aynı anda üç ilmeği birlikte kesmek), 11x",
        "7) M(decrease three stitches together at once), 11sc",
        "en",
      ),
    ).toBe("7) M (decrease 3 stitches together), 11sc");
  });

  it("normalizes written one-chain cut-yarn endings", () => {
    expect(
      normalizeTranslationStyle(
        "11-35) 25 sıra 12x bir zincir çekip ipimizi kesiyoruz.",
        "11-35) 25 rounds, 12sc We chain one and cut the yarn.",
        "en",
      ),
    ).toBe(
      "11-35) 25 rounds, 12sc. Ch 1 and cut the yarn.",
    );
  });

  it("normalizes continuing with arm joining", () => {
    expect(
      normalizeTranslationStyle(
        "15-29) 15 sıra 42x, İpimizi kesmeden kol birleştirme ile devam ediyoruz.",
        "15-29) 15 rounds, 42sc, Without cutting the yarn, we continue by joining the arms.",
        "en",
      ),
    ).toBe(
      "15-29) 15 rounds, 42sc. Without cutting the yarn, continue by joining the arms.",
    );
  });

  it("normalizes the arm-joining heading", () => {
    expect(
      normalizeTranslationStyle(
        "⊱KOL BIRLEŞTIRME⊰",
        "⊱ARM ASSEMBLY⊰",
        "en",
      ),
    ).toBe("⊱ARM JOINING⊰");
  });

  it("normalizes joining the second leg to the first leg", () => {
    expect(
      normalizeTranslationStyle(
        "✦ İkinci bacaktan 3 zincir ile bacakların arka tarafı bize dönük olacak şekilde ilk bacak ile birleştiriyoruz.",
        "✦ From the second leg 3 we join it to the first leg with a chain, keeping the backs of the legs facing us.",
        "en",
      ),
    ).toBe(
      "✦ From the second leg, ch 3 and join to the first leg with the backs of the legs facing you.",
    );
  });

  it("normalizes the first joined-leg body round", () => {
    expect(
      normalizeTranslationStyle(
        "1) 26x(ilk bacak), 3x (zincir üstü), 26x (ikinci bacak), 3x (zincir üstü) ilmek belirleyiciyi buraya takıyoruz. Başlangıç noktamız burası olacak = 58x",
        "1) 26sc(first leg), 3sc (along the chain), 26sc (second leg), 3sc (along the chain) Attach the stitch marker here. This will be our starting point. = 58sc",
        "en",
      ),
    ).toBe(
      "1) 26sc (first leg), 3sc (along the chain), 26sc (second leg), 3sc (along the chain) = 58sc. This will be the beginning of the round; place a stitch marker here.",
    );
  });

  it("normalizes leg-alignment guidance", () => {
    expect(
      normalizeTranslationStyle(
        "✦ Bende her iki bacağın bitiş noktası bacağın iç kısmının ortasına denk geldi. Sizde denk gelmiyorsa 1-2 sık iğne eksik ya da fazla örerek orta noktaya gelin.",
        "✦ For me, the finishing point of both legs aligned with the center of the inside of the leg. If yours does not align 1-2 reach the center by working fewer or more single crochet stitches.",
        "en",
      ),
    ).toBe(
      "✦ For me, the finishing point of both legs aligned with the center of the inner side of each leg. If yours does not align, work 1-2 fewer or additional single crochet stitches to reach the center.",
    );
  });

  it("normalizes the second-leg repeated-round instruction", () => {
    expect(
      normalizeTranslationStyle(
        "✦ İkinci bacakta da ilk 51 sırayı aynı şekilde örüyoruz.",
        "✦ On the second leg, also work the first 51 round in the same way.",
        "en",
      ),
    ).toBe(
      "✦ On the second leg, work the first 51 rounds in the same way.",
    );
  });

  it("normalizes continuing into the body without cutting the yarn", () => {
    expect(
      normalizeTranslationStyle(
        "53) 12x örüyoruz, ipimizi kesmeden gövde ile devam ediyoruz.",
        "53) 12sc we crochet, we continue with the body without cutting the yarn.",
        "en",
      ),
    ).toBe(
      "53) Work 12sc, then continue with the body without cutting the yarn.",
    );
  });

  it("normalizes recurring leg-stuffing guidance", () => {
    expect(
      normalizeTranslationStyle(
        "✦ Bacakları örerken 6-7 sırada bir dolum yapalım. Doldururken görselde görüldüğü gibi örgünün dönmemesine dikkat edelim. (Dolum yaptıkça elimizle örgüyü sürekli düzeltirsek, örgümüz dönmez ve bacaklar çok muntazam olur.)",
        "✦ While crocheting the legs 6-7 Let’s add some stuffing as we go. While stuffing, make sure the work does not twist, as shown in the image. (If we continually adjust the work with our hands as we add stuffing, the work will not twist, and the legs will be very neat.)",
        "en",
      ),
    ).toBe(
      "✦ While crocheting the legs, add stuffing every 6-7 rounds. While stuffing, make sure the work does not twist, as shown in the image. (If you keep straightening the work with your hands as you stuff, it will not twist and the legs will look much neater.)",
    );
  });

  it("normalizes the hook intro with a starting yarn color", () => {
    expect(
      normalizeTranslationStyle(
        "✦ 2.00 numara tığ ile örüyoruz. Ekru renk ip (catania 105) ile başlıyoruz.",
        "✦ We crochet using a 2.00 hook. We begin with (catania 105) in ecru yarn.",
        "en",
      ),
    ).toBe(
      "✦ Using a 2.00 mm crochet hook, work as follows. Start with ecru yarn (catania 105).",
    );
  });

  it("normalizes a stitch-count chain-and-cut instruction", () => {
    expect(
      normalizeTranslationStyle(
        "52) 24x, 1 zincir çekip ipimizi kesiyoruz.",
        "52) 24sc, 1 We chain and cut our yarn.",
        "en",
      ),
    ).toBe("52) 24sc. Ch 1 and cut the yarn.");
  });

  it("normalizes a yarn heading with an explicit orange-yarn cut", () => {
    expect(
      normalizeTranslationStyle(
        "✦ Ekru renk ip ile; (Turuncu ipimizi kesiyoruz.)",
        "✦ With ecru yarn; (We cut the orange yarn.)",
        "en",
      ),
    ).toBe("✦ With ecru yarn: (Cut the orange yarn.)");
  });

  it("normalizes a carried-yarn color change instruction", () => {
    expect(
      normalizeTranslationStyle(
        "✦ Turuncu ipimize (catania 411) geçiyoruz. Renk geçişlerinde bir önceki ipi kesmeden, içeride beklemeye alıyoruz.",
        "✦ to our orange yarn (catania 411) we switch. When changing colors, without cutting the previous yarn, we leave it waiting inside.",
        "en",
      ),
    ).toBe(
      "✦ Switch to orange yarn (catania 411). When changing colors, do not cut the previous yarn; leave it inside until needed again.",
    );
  });

  it.each([
    [
      "✦ Ekru renk ip ile;",
      "✦ With ecru-colored yarn;",
      "✦ With ecru yarn:",
    ],
    [
      "✦ Turuncu ip ile;",
      "✦ With orange yarn;",
      "✦ With orange yarn:",
    ],
  ])("normalizes yarn-color headings: %s", (source, input, expected) => {
    expect(normalizeTranslationStyle(source, input, "en")).toBe(expected);
  });

  it("normalizes the reusable stitch-marker instruction", () => {
    expect(
      normalizeTranslationStyle(
        "Burası başlangıç noktamız olacak; işaretleyicimizi buraya takıyoruz.",
        "This will be our starting point; we attach the marker here.",
        "en",
      ),
    ).toBe(
      "This will be the beginning of the round; place a stitch marker here.",
    );
  });

  it("normalizes only the marker clause in a mixed magic-ring instruction", () => {
    expect(
      normalizeTranslationStyle(
        "Sihirli halka içine 6x — başlangıç noktamız burası olacak işaretleyiciyi buraya takıyoruz.",
        "Into the magic ring 6sc — This will be our starting point; we attach the marker here.",
        "en",
      ),
    ).toBe(
      "6sc into the magic ring — This will be the beginning of the round; place a stitch marker here.",
    );
  });

  it("keeps approved compact stitch notation unchanged", () => {
    expect(
      normalizeTranslationStyle(
        "6x, 1v, 1e, 66x",
        "6sc, 1inc, 1dec, 66sc",
        "en",
      ),
    ).toBe("6sc, 1inc, 1dec, 66sc");
  });

  it.each([
    ["12-23) 12 sıra 66x", "12-23) 12 rounds, 66 sc"],
    ["28-30) 3 sıra 78x", "28-30) 3 rounds, 78 sc"],
  ])("keeps the approved round-count style unchanged", (source, approved) => {
    expect(normalizeTranslationStyle(source, approved, "en")).toBe(approved);
  });

});
