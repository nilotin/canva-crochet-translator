import type { TargetLanguage } from "./copy_designs";
import type {
  CanvaTranslationBlock,
  TranslationResponse,
} from "./translation_review";
import type { WholeDocumentInventory } from "./whole_document_inventory";

type Page = WholeDocumentInventory["pages"][number];

export const FRONT_NOTICE_TR =
  "Tarifimi satın aldığınız için çok teşekkür ederim. \nTarif kişisel kullanım içindir. Ördüğünüz oyuncağı satabilirsiniz fakat bu tarif kesinlikle paylaşılamaz, satılamaz ve izin alınmadan başka dillere tercüme edilemez. Ücretli tarif olup ücretsiz bir şekilde başka platformlarda dağıtılıp örülmesine kesinlikle rızam yoktur.\n@suen.baby.amigurumi";

export const FRONT_NOTICE = {
  en: "Thank you very much for purchasing my pattern. This pattern is for personal use only. You may sell the toy you make, but this pattern may not be shared, sold, or translated into other languages without permission under any circumstances. This is a paid pattern, and I absolutely do not consent to it being distributed free of charge or used on other platforms without permission. @suen.baby.amigurumi",
  es: "Muchas gracias por comprar mi patrón. Este patrón es únicamente para uso personal. Puedes vender el muñeco que realices, pero este patrón no puede compartirse, venderse ni traducirse a otros idiomas sin permiso bajo ninguna circunstancia. Este es un patrón de pago y no doy mi consentimiento para que se distribuya gratuitamente ni se utilice en otras plataformas sin autorización. @suen.baby.amigurumi",
} as const;

export const INSTRUCTIONS_TR =
  "✦ Ben çapraz sık iğne tekniğiyle ördüm, siz istediğiniz tekniği (düz ya da çapraz sık iğne) kullanabilirsiniz.   \n✦ Örgünüzde potluk oluşmaması için 7-8 sırada bir sıkı şekilde dolduralım.\n✦ Bedende ve kıyafetlerde farklı bir ip tercihiniz olursa ipin kalınlığının aynı olmasına özen gösterin, aksi takdirde kıyafetler büyük ya da küçük gelebilir.\n✦ Bebeğin vücut ve kafasını örerken 2mm tığ kullandım. Farklı kalınlıkta ip kullandığınızda tığ numaranızı ipinize göre seçebilirsiniz. \n✦ Takıldığınız bir yer olursa instagram üzerinden iletişime geçebilirsiniz.";

export const INSTRUCTIONS = {
  en: "✦ I crocheted using the X-shaped single crochet technique, but you may use whichever technique you prefer (regular or X-shaped single crochet).\n✦ To prevent your work from becoming uneven, stuff it firmly every 7-8 rounds.\n✦ If you choose a different yarn for the body or clothing, make sure it has the same thickness; otherwise, the clothes may turn out too large or too small.\n✦ I used a 2mm crochet hook while making the doll's body and head. If you use yarn of a different thickness, choose your hook size accordingly.\n✦ If you have any questions, you can contact me via Instagram.",
  es: "✦ Yo tejí utilizando la técnica de punto bajo en X, pero puedes utilizar la técnica que prefieras (punto bajo normal o punto bajo en X).\n✦ Para evitar que el tejido quede irregular, rellénalo firmemente cada 7-8 vueltas.\n✦ Si eliges un hilo diferente para el cuerpo o la ropa, procura que tenga el mismo grosor; de lo contrario, la ropa podría quedar demasiado grande o demasiado pequeña.\n✦ Utilicé un ganchillo de 2mm para tejer el cuerpo y la cabeza de la muñeca. Si utilizas un hilo de diferente grosor, puedes elegir el tamaño del ganchillo de acuerdo con tu hilo.\n✦ Si tienes alguna duda, puedes ponerte en contacto conmigo a través de Instagram.",
} as const;

export const GLOSSARY_TR =
  "✦ zn: zincir\n✦ sh: sihirli halka\n✦ x: sık iğne\n✦ *: tekrar sayısı\n✦ v: arttırma\n✦ e: eksiltme\n✦ w: tek ilmek içerisine 3 sık iğne\n✦ hdc: yarım trabzan\n✦ hdcv: yarım trabzan arttırma\n✦ dc: ikili trabzan\n✦ dcv: ikili trabzan arttırma\n✦ dce: ikili trabzan eksiltme\n✦ CC: ilmek kaydırma\n✦ FLO: ön ilmekten örme\n✦ BLO: arka ilmekten örme\n✦ M: 3 ilmek birden eksiltme\n✦ tr: 3'lü trabzan\n✦ trv: aynı sık iğne içine 2 tane      3'lü trabzan\n✦ esc: ipi tığa dolamadan 2\ndefada çıkarma (yalancı\ntrabzan)\n✦ escw: aynı ilmeğe 3 kere esc\n✦ escv: esc arttırma";

export const GLOSSARY = {
  en: "✦ ch: chain\n✦ mr: magic ring\n✦ sc: single crochet\n✦ *: number of repetitions\n✦ inc: increase\n✦ dec: decrease\n✦ w: 3 single crochet in the same stitch\n✦ hdc: half double crochet\n✦ hdc-inc: half double crochet increase\n✦ dc: double crochet\n✦ dc-inc: double crochet increase\n✦ dc-dec: double crochet decrease\n✦ SL.ST: slip stitch\n✦ FLO: front loop only\n✦ BLO: back loop only\n✦ M: decrease 3 stitches together\n✦ tr: treble crochet\n✦ tr-inc: 2 treble crochet in the same stitch\n✦ esc: extended double crochet\n✦ escw: 3 esc in the same stitch\n✦ esc-inc: esc increase",
  es: "✦ cad: cadena\n✦ am: anillo mágico\n✦ pb: punto bajo\n✦ *: número de repeticiones\n✦ aum: aumento\n✦ dism: disminución\n✦ W: 3 puntos bajos en el mismo punto\n✦ mpa: medio punto alto\n✦ aum-mpa: aumento de medio punto alto\n✦ pa: punto alto\n✦ aum-pa: aumento de punto alto\n✦ dism-pa: disminución de punto alto\n✦ pd: punto deslizado\n✦ Flo: tejer por la hebra delantera\n✦ Blo: tejer por la hebra trasera\n✦ M: disminuir 3 puntos juntos\n✦ pa-tri: punto alto triple\n✦ aum-pa-tri: 2 puntos altos triples en el mismo punto\n✦ pa-ex: punto alto extendido\n✦ W-pa-ex: 3 pa-ex en el mismo punto\n✦ aum-pa-ex: aumento de punto alto extendido",
} as const;

// Page 2's three heading labels. Unlike INSTRUCTIONS_TR/GLOSSARY_TR
// (long, specific bullet-list bodies), these are short single/double
// words -- still matched with the SAME conservative normalizeForStaticMatch
// used everywhere else in this module (never a loose/partial/regex
// match), so a real Page 2 heading is recognized reliably while an
// unrelated short block is not accidentally swept in.
export const MATERIALS_HEADING_TR = "Malzemeler";
export const MATERIALS_HEADING = { en: "Materials", es: "Materiales" } as const;

export const EXPLANATIONS_HEADING_TR = "Açıklamalar";
export const EXPLANATIONS_HEADING = {
  en: "Explanations",
  es: "Explicaciones",
} as const;

export const ABBREVIATIONS_HEADING_TR = "Terimler";
export const ABBREVIATIONS_HEADING = {
  en: "Abbreviations",
  es: "Abreviaturas",
} as const;

export const CLOSING_TR = [
  "TEBRIKLER!!",
  "Ördüklerinizi görmek için sabırsızlanıyorum.\nİnstagramda Buzu paylaşımlarınızı bekliyor olacağım.\nPaylaşımlarınızda beni de etiketlerseniz ördüğünüz güzel Buzu’ları görmekten mutluluk duyarım. \nBir sonraki tasarımda görüşmek üzere.\nSevgiyle ve Hoşça kalın!!",
  "Buzu’yu Tamamladınız!",
  ".",
] as const;

export const CLOSING = {
  en: [
    "CONGRATULATIONS!!",
    "I can't wait to see what you've made. I'll be looking forward to seeing your Buzu posts on Instagram. If you tag me in your posts, I'll be very happy to see the beautiful Buzus you've made. See you in the next design. With love, and goodbye!!",
    "You've Completed Buzu!",
    ".",
  ],
  es: [
    "¡¡FELICIDADES!!",
    "Estoy deseando ver lo que has tejido. Estaré esperando ver tus publicaciones de Buzu en Instagram. Si me etiquetas en tus publicaciones, me hará mucha ilusión ver los preciosos Buzu que has tejido. Nos vemos en el próximo diseño. ¡Con cariño y hasta pronto!",
    "¡Has Completado a Buzu!",
    ".",
  ],
} as const;

// Selene Doll's closing template family. Unlike front-cover/notice,
// Page-2-instructions, and Page-2-glossary (which are byte-identical
// universal text across every pattern from this creator), the closing
// page's copy is NOT purely universal: the pattern name is woven into
// the Turkish text using genuinely different grammatical constructions
// per pattern -- Buzu takes a direct object suffix ("Buzu'yu
// Tamamladınız!"), while Selene Doll takes an appended common noun
// ("Selene Bebeği Tamamladınız!", literally "Selene Doll" rather than a
// suffixed "Selene'yi"). This is real Turkish morphological variation
// (further compounded by vowel-harmony-driven plural/possessive suffixes
// -- "Buzu'ları" vs "Selene'leri") that cannot be safely derived from the
// canonical pattern name by any simple, general rule -- and this module
// is deliberately NOT attempting to build one (see CLOSING_TEMPLATES
// below). Instead, each known pattern's exact closing text (source AND
// pinned target output) is recorded explicitly, exactly like CLOSING_TR /
// CLOSING above.
export const SELENE_CLOSING_TR = [
  "TEBRIKLER!!",
  "Ördüklerinizi görmek için sabırsızlanıyorum. İnstagramda\nSelene Doll paylaşımlarınızı bekliyor olacağım.\nPaylaşımlarınızda beni de etiketlerseniz ördüğünüz güzel\nSelene’leri görmekten mutluluk duyarım. Bir sonraki\ntasarımda görüşmek üzere. Sevgiyle ve Hoşça kalın!!",
  "Selene Bebeği Tamamladınız!",
  ".",
] as const;

export const SELENE_CLOSING = {
  en: [
    "CONGRATULATIONS!!",
    "I can't wait to see what you've made. I'll be looking forward to seeing your Selene Doll posts on Instagram. If you tag me in your posts, I'll be very happy to see the beautiful Selenes you've made. See you in the next design. With love, and goodbye!!",
    "You've Completed Selene!",
    ".",
  ],
  es: [
    "¡¡FELICIDADES!!",
    "Estoy deseando ver lo que has tejido. Estaré esperando ver tus publicaciones de Selene Doll en Instagram. Si me etiquetas en tus publicaciones, me hará mucha ilusión ver los preciosos Selene que has tejido. Nos vemos en el próximo diseño. ¡Con cariño y hasta pronto!",
    "¡Has Completado a Selene!",
    ".",
  ],
} as const;

// The closing-template registry: maps a pattern's canonical front-cover
// title to that pattern's exact closing source/target text. See
// buildStaticTemplateTranslationResponse's closing-page branch for how
// this is used -- a page matches ONLY when the front-cover title
// extracted from the SAME document also matches a template's
// canonicalTitle (compared with the same normalizeForStaticMatch used
// everywhere else in this module), in addition to the closing page's own
// content matching that same template's tr[] exactly. Adding support for
// a new pattern means adding one entry here with that pattern's exact
// recorded text -- never inventing a general name-substitution rule.
type PatternClosingTemplate = {
  canonicalTitle: string;
  tr: readonly [string, string, string, string];
  en: readonly [string, string, string, string];
  es: readonly [string, string, string, string];
};

const CLOSING_TEMPLATES: readonly PatternClosingTemplate[] = [
  { canonicalTitle: "BUZU", tr: CLOSING_TR, en: CLOSING.en, es: CLOSING.es },
  {
    canonicalTitle: "SELENE DOLL",
    tr: SELENE_CLOSING_TR,
    en: SELENE_CLOSING.en,
    es: SELENE_CLOSING.es,
  },
];

// Used ONLY to decide whether a block's text *is* one of the known
// fixed/universal template blocks -- never to produce the block's
// output text (the output is always the pinned canonical constant
// below, regardless of what matched). Because of that, this comparison
// can and should be aggressive: real Canva source text can differ from
// how this reference text was transcribed in ways that are purely
// cosmetic --
//   - internal line-wrap/paragraph-break placement (Canva's richtext
//     editor may store a soft-wrapped paragraph without the same
//     embedded newlines this reference text was typed with, or vice
//     versa) -- collapsing ALL whitespace (including newlines) to a
//     single space makes the match robust to that;
//   - smart quotes / en-dashes Canva's editor commonly substitutes for
//     plain ASCII punctuation;
//   - NFKC-normalizable Unicode variants, and case.
// A real content difference (a different sentence, a materials list
// specific to a different pattern) still fails to match after this
// normalization -- these reference strings are long and specific enough
// that the risk of a false *positive* match is not meaningfully raised
// by loosening whitespace/punctuation/case, while a false *negative*
// (silently falling through to the LLM for a block that is genuinely
// one of our fixed blocks) is exactly the bug this normalization fixes.
const normalizeForStaticMatch = (text: string): string =>
  text
    .normalize("NFKC")
    .replace(/[‘’‛]/gu, "'")
    .replace(/[“”‟]/gu, '"')
    .replace(/[–—]/gu, "-")
    // Canva source text is not consistent about Turkish dotted/dotless I.
    // For deterministic TEMPLATE RECOGNITION ONLY, fold all four variants
    // to the same form. This never changes source or translated output.
    // Examples that must match:
    //   TERIMLER <-> Terimler
    //   TEBRIKLER <-> TEBRİKLER
    .replace(/[Iİı]/gu, "i")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("tr");

const sameTemplateText = (left: string, right: string): boolean =>
  normalizeForStaticMatch(left) === normalizeForStaticMatch(right);

const bulletStarts = (text: string): number[] => {
  const starts: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "✦") starts.push(index);
  }
  return starts;
};

const structuralFormattingProjection = (
  pageBlock: Page["blocks"][number],
  target: string,
) => {
  const sourceRegions = pageBlock.formattingRegions;

  if (sourceRegions.length === 0) return undefined;

  if (sourceRegions.length === 1) {
    return [{ id: "fmt-0", start: 0, end: target.length }];
  }

  const source = pageBlock.sourceText;
  const sourceStarts = bulletStarts(source);
  const targetStarts = bulletStarts(target);

  if (
    sourceStarts.length === 0 ||
    sourceStarts.length !== targetStarts.length
  ) {
    return undefined;
  }

  const sourceItems = sourceStarts.map((start, index) => ({
    start,
    end: sourceStarts[index + 1] ?? source.length,
  }));

  const targetItems = targetStarts.map((start, index) => ({
    start,
    end: targetStarts[index + 1] ?? target.length,
  }));

  const cursors = new Map<number, number>();

  const mapped = sourceRegions.map((region, regionIndex) => {
    const sourceStart = region.index;
    const sourceEnd = region.index + region.length;

    const itemIndex = sourceItems.findIndex(
      ({ start, end }) => sourceStart >= start && sourceEnd <= end,
    );

    if (itemIndex < 0) return undefined;

    const targetItem = targetItems[itemIndex];
    if (!targetItem) return undefined;

    const cursor = cursors.get(itemIndex) ?? 0;
    const remaining = target.slice(targetItem.start + cursor, targetItem.end);

    let consumed: number;

    if (/^[✦ ]+$/u.test(region.text)) {
      consumed = Math.min(region.text.length, remaining.length);
    } else if (region.text.includes(":") && !region.text.includes("\n")) {
      const colon = remaining.indexOf(":");
      if (colon < 0) return undefined;

      consumed = colon + 1;
      if (region.text.endsWith(" ") && remaining[consumed] === " ") {
        consumed += 1;
      }
    } else {
      consumed = remaining.length;
    }

    const start = targetItem.start + cursor;
    const end = start + consumed;

    cursors.set(itemIndex, cursor + consumed);

    return {
      id: `fmt-${regionIndex}`,
      start,
      end,
    };
  });

  if (mapped.some((region) => region === undefined)) return undefined;

  return mapped as { id: string; start: number; end: number }[];
};

const identityFormattingProjection = (
  pageBlock: Page["blocks"][number],
) =>
  pageBlock.formattingRegions.map((region, index) => ({
    id: `fmt-${index}`,
    start: region.index,
    end: region.index + region.length,
  }));

const translationResult = (
  block: CanvaTranslationBlock,
  pageBlock: Page["blocks"][number],
  translated: string,
  mode: "keep" | "replace",
) => ({
  id: block.localId,
  source: block.sourceText,
  translated,
  valid: true,
  errors: [],
  warnings: [],
  ...(mode === "keep"
    ? { targetFormattingRegions: identityFormattingProjection(pageBlock) }
    : (() => {
        const projected = structuralFormattingProjection(pageBlock, translated);
        return projected ? { targetFormattingRegions: projected } : {};
      })()),
});

// Position context for the whole document, needed because the front-cover
// and closing templates are identified by BOTH document position (first /
// final page) AND recognized content -- content matching alone is not
// enough (an arbitrary first or last page must not be captured), and
// position alone is not enough either (matching closing-looking text on a
// non-final page must not activate the closing route). totalPages must
// count every page discovered in the document (translatable pages AND
// skipped/locked ones) -- see bulk_translation.ts's call site, which
// derives it from inventory.pages.length + inventory.skippedPages.length
// rather than just the pages eligible for translation, so a locked or
// unreadable final page does not make an earlier page look "final".
export type StaticTemplateDocumentContext = {
  totalPages: number;
  // The document's actual first page (discoveryIndex 0), from the SAME
  // whole-document inventory as the page currently being processed --
  // never a different document/run. Used ONLY to derive pattern identity
  // for closing-page recognition (see extractFrontCoverTitle below); it
  // has no effect on front-cover or Page 2 recognition. Optional because
  // a caller may not have it (e.g. the document's first page was
  // unreadable/locked and landed in skippedPages instead of pages) -- in
  // that case closing-page pattern-identity matching simply cannot
  // succeed, which is the safe default (falls through to normal review).
  firstPage?: Page;
};

// Mirrors the front-cover branch's own recognition condition below
// (kept as a small, deliberate duplication rather than a shared
// early-return helper, so the working front-cover branch itself stays
// untouched). Extracts the pattern title ONLY when the supplied page
// safely matches the known front-cover shape -- title + universal
// notice -- never from an arbitrary 2-block page.
const extractFrontCoverTitle = (
  firstPage: Page | undefined,
): string | undefined => {
  if (!firstPage || firstPage.discoveryIndex !== 0) return undefined;

  const ordered = [...firstPage.blocks].sort((a, b) => a.order - b.order);

  if (
    ordered.length !== 2 ||
    !sameTemplateText(ordered[1]?.sourceText ?? "", FRONT_NOTICE_TR)
  ) {
    return undefined;
  }

  return ordered[0]?.sourceText;
};

export const buildStaticTemplateTranslationResponse = (
  page: Page,
  blocks: readonly CanvaTranslationBlock[],
  language: TargetLanguage,
  documentContext: StaticTemplateDocumentContext,
): TranslationResponse | undefined => {
  const orderedPageBlocks = [...page.blocks].sort((a, b) => a.order - b.order);
  const orderedBlocks = [...blocks].sort((a, b) => a.order - b.order);

  if (orderedPageBlocks.length !== orderedBlocks.length) return undefined;

  // Document-position safety conditions. Page position is a SAFETY
  // CONDITION, not a template identity -- these booleans gate recognition
  // alongside content matching below; neither position nor content is
  // sufficient on its own. discoveryIndex is the document's own 0-based
  // page ordering (see whole_document_inventory.ts), already used
  // elsewhere in this codebase for first-page detection
  // (whole_document_classification.ts's guessTemplateCandidateKind), so
  // this reuses that existing signal rather than inventing a new one.
  // Never hard-code a specific page number or page count here -- a
  // pattern's front cover is always discoveryIndex 0, and its closing
  // page is always the last discoveryIndex, regardless of how many pages
  // the pattern has.
  const isFirstPage = page.discoveryIndex === 0;
  const isFinalPage = page.discoveryIndex === documentContext.totalPages - 1;

  // Page 1:
  // pattern title stays untouched; only the universal notice changes.
  if (
    isFirstPage &&
    orderedPageBlocks.length === 2 &&
    sameTemplateText(orderedPageBlocks[1]?.sourceText ?? "", FRONT_NOTICE_TR)
  ) {
    return {
      translations: [
        translationResult(
          orderedBlocks[0]!,
          orderedPageBlocks[0]!,
          orderedPageBlocks[0]!.sourceText,
          "keep",
        ),
        translationResult(
          orderedBlocks[1]!,
          orderedPageBlocks[1]!,
          FRONT_NOTICE[language],
          "replace",
        ),
      ],
    };
  }

  // Page 2 recognition/translation now lives in recognizePage2Hybrid
  // below (materials BODY is no longer static -- see Feature 3: it must
  // go through the LLM, which this pure/synchronous function cannot do).
  // bulk_translation.ts tries recognizePage2Hybrid separately, before
  // falling back to this function.

  // Closing page (the FINAL page of the document -- for the current Buzu
  // test pattern that happens to be Page 9, but this must not depend on
  // that: see isFinalPage above, computed from actual document position,
  // never a hard-coded page number/discoveryIndex/pageId).
  //
  // Recognition requires ALL of:
  //   1. isFinalPage (position, computed above);
  //   2. the page's 4 blocks match a KNOWN pattern's closing template
  //      EXACTLY (never a loose/partial regex over a subset of words --
  //      see CLOSING_TEMPLATES);
  //   3. the SAME document's actual front cover (documentContext.firstPage)
  //      is itself safely recognized as a front-cover page, and its
  //      extracted title matches that SAME template's canonicalTitle.
  // Content match alone is not enough (an unrelated final page whose
  // closing text happens to line up with one pattern's exact TR words,
  // but whose front cover says something else, must not match), position
  // alone is not enough, and a template match without a corresponding,
  // consistent front-cover identity is not enough either. Any of these
  // failing falls through to the "do not guess" fallback below.
  if (isFinalPage && orderedPageBlocks.length === 4) {
    const firstPageTitle = extractFrontCoverTitle(documentContext.firstPage);

    const matchedTemplate =
      firstPageTitle === undefined
        ? undefined
        : CLOSING_TEMPLATES.find(
            (template) =>
              sameTemplateText(firstPageTitle, template.canonicalTitle) &&
              orderedPageBlocks.every((block, index) =>
                sameTemplateText(block.sourceText, template.tr[index] ?? ""),
              ),
          );

    if (matchedTemplate) {
      return {
        translations: orderedBlocks.map((block, index) =>
          translationResult(
            block,
            orderedPageBlocks[index]!,
            matchedTemplate[language][index]!,
            index === 3 ? "keep" : "replace",
          ),
        ),
      };
    }
  }

  // Unknown/changed template: do not guess.
  return undefined;
};

// ---------------------------------------------------------------------
// Page 2: HYBRID translation (Feature 3).
//
// Page 2's materials body is pattern-specific ordinary natural-language
// content (yarn brands/codes, colors, hook sizes, measurements, crochet
// notation) -- it is NOT one of the fixed/universal template blocks, so
// unlike the rest of this module it genuinely needs real translation,
// not a pinned constant. That means it cannot be resolved by this pure,
// synchronous module alone (there is no LLM call here) -- instead this
// module only RECOGNIZES the page and returns:
//   - which block is the materials body (to be sent to the existing
//     /api/translate pipeline, and ONLY that one block -- see
//     bulk_translation.ts, the sole caller);
//   - the fully-resolved deterministic translations for every OTHER
//     block on the page (headings, explanations/instructions body,
//     abbreviations/glossary body, decorative "." if present).
// The caller merges the LLM's single-block result for the materials
// body into this deterministic skeleton to form the complete
// TranslationResponse for the page.
//
// Two known Page 2 shapes are recognized, exactly as before:
//   (a) the plain shape (no separate heading blocks) -- Canva may
//       expose this as 3 blocks (materials, instructions, glossary) or
//       4 blocks (materials, instructions, ".", glossary). This is the
//       ALREADY-LIVE-TESTED shape for Buzu and Selene Doll.
//   (b) a shape with three additional heading blocks (Malzemeler /
//       Açıklamalar / Terimler) -- 6 blocks without the decorative dot,
//       7 with it. This shape has not yet been confirmed against a live
//       Canva document, so it is recognized purely by CONTENT (every
//       block except the materials body and the optional "." must
//       exact-match one specific known heading/body text), never by a
//       fixed block order/position -- see classifyPage2HeadingsShape
//       below. If a live document turns out to order these blocks
//       differently than expected, content-based recognition still
//       works; only a genuinely different or missing heading fails to
//       recognize (falls through to normal review, never guesses).
// ---------------------------------------------------------------------

type Page2PlainShape = {
  materialsIndex: number;
  instructionsIndex: number;
  glossaryIndex: number;
  dotIndex?: number;
};

const classifyPage2PlainShape = (
  orderedPageBlocks: Page["blocks"],
): Page2PlainShape | undefined => {
  if (
    orderedPageBlocks.length === 3 &&
    sameTemplateText(orderedPageBlocks[1]?.sourceText ?? "", INSTRUCTIONS_TR) &&
    sameTemplateText(orderedPageBlocks[2]?.sourceText ?? "", GLOSSARY_TR)
  ) {
    return { materialsIndex: 0, instructionsIndex: 1, glossaryIndex: 2 };
  }

  if (
    orderedPageBlocks.length === 4 &&
    sameTemplateText(orderedPageBlocks[1]?.sourceText ?? "", INSTRUCTIONS_TR) &&
    sameTemplateText(orderedPageBlocks[2]?.sourceText ?? "", ".") &&
    sameTemplateText(orderedPageBlocks[3]?.sourceText ?? "", GLOSSARY_TR)
  ) {
    return {
      materialsIndex: 0,
      instructionsIndex: 1,
      dotIndex: 2,
      glossaryIndex: 3,
    };
  }

  return undefined;
};

type Page2HeadingsShape = {
  materialsHeadingIndex: number;
  materialsBodyIndex: number;
  explanationsHeadingIndex: number;
  explanationsBodyIndex: number;
  abbreviationsHeadingIndex: number;
  abbreviationsBodyIndex: number;
  dotIndex?: number;
};

// Content-driven, NOT position-driven: every block except the one
// pattern-specific materials body (and the optional decorative ".")
// must exact-match one specific known atom. Never a loose/partial
// match, and never more than one block claiming the same role -- either
// of those makes recognition fail closed (return undefined), which
// falls through to normal review rather than guessing.
const classifyPage2HeadingsShape = (
  orderedPageBlocks: Page["blocks"],
): Page2HeadingsShape | undefined => {
  if (orderedPageBlocks.length !== 6 && orderedPageBlocks.length !== 7) {
    return undefined;
  }

  let materialsHeadingIndex: number | undefined;
  let explanationsHeadingIndex: number | undefined;
  let abbreviationsHeadingIndex: number | undefined;
  let explanationsBodyIndex: number | undefined;
  let abbreviationsBodyIndex: number | undefined;
  let dotIndex: number | undefined;
  const unmatched: number[] = [];

  orderedPageBlocks.forEach((block, index) => {
    const text = block.sourceText;

    if (sameTemplateText(text, MATERIALS_HEADING_TR)) {
      if (materialsHeadingIndex !== undefined) unmatched.push(index);
      else materialsHeadingIndex = index;
    } else if (sameTemplateText(text, EXPLANATIONS_HEADING_TR)) {
      if (explanationsHeadingIndex !== undefined) unmatched.push(index);
      else explanationsHeadingIndex = index;
    } else if (sameTemplateText(text, ABBREVIATIONS_HEADING_TR)) {
      if (abbreviationsHeadingIndex !== undefined) unmatched.push(index);
      else abbreviationsHeadingIndex = index;
    } else if (sameTemplateText(text, INSTRUCTIONS_TR)) {
      if (explanationsBodyIndex !== undefined) unmatched.push(index);
      else explanationsBodyIndex = index;
    } else if (sameTemplateText(text, GLOSSARY_TR)) {
      if (abbreviationsBodyIndex !== undefined) unmatched.push(index);
      else abbreviationsBodyIndex = index;
    } else if (sameTemplateText(text, ".")) {
      if (dotIndex !== undefined) unmatched.push(index);
      else dotIndex = index;
    } else {
      unmatched.push(index);
    }
  });

  if (
    materialsHeadingIndex === undefined ||
    explanationsHeadingIndex === undefined ||
    abbreviationsHeadingIndex === undefined ||
    explanationsBodyIndex === undefined ||
    abbreviationsBodyIndex === undefined ||
    unmatched.length !== 1
  ) {
    return undefined;
  }

  // 7 blocks requires the "." to have been found (otherwise the 7th
  // block would itself be a second "unmatched" entry, already rejected
  // above); 6 blocks requires it to be absent. Both are already implied
  // by the checks above given the length gate at the top, but this
  // keeps the invariant explicit rather than relying on arithmetic.
  if (orderedPageBlocks.length === 7 !== (dotIndex !== undefined)) {
    return undefined;
  }

  return {
    materialsHeadingIndex,
    materialsBodyIndex: unmatched[0]!,
    explanationsHeadingIndex,
    explanationsBodyIndex,
    abbreviationsHeadingIndex,
    abbreviationsBodyIndex,
    dotIndex,
  };
};

export type Page2HybridSkeleton = {
  // The block whose SOURCE text must be sent through the existing
  // /api/translate pipeline (and ONLY this block -- see
  // bulk_translation.ts). Every other Page 2 block is already fully
  // resolved below.
  materialsBlockId: string;
  // Complete TranslationResponse entries for every Page 2 block EXCEPT
  // the materials body -- headings, explanations/instructions,
  // abbreviations/glossary, and the decorative "." if present. The
  // caller appends the materials body's LLM-translated entry to this
  // array to form the complete page response.
  deterministicTranslations: TranslationResponse["translations"];
};

export const recognizePage2Hybrid = (
  page: Page,
  blocks: readonly CanvaTranslationBlock[],
  language: TargetLanguage,
): Page2HybridSkeleton | undefined => {
  const orderedPageBlocks = [...page.blocks].sort((a, b) => a.order - b.order);
  const orderedBlocks = [...blocks].sort((a, b) => a.order - b.order);

  if (orderedPageBlocks.length !== orderedBlocks.length) return undefined;

  const plain = classifyPage2PlainShape(orderedPageBlocks);

  if (plain) {
    const deterministicTranslations: TranslationResponse["translations"] = [
      translationResult(
        orderedBlocks[plain.instructionsIndex]!,
        orderedPageBlocks[plain.instructionsIndex]!,
        INSTRUCTIONS[language],
        "replace",
      ),
      translationResult(
        orderedBlocks[plain.glossaryIndex]!,
        orderedPageBlocks[plain.glossaryIndex]!,
        GLOSSARY[language],
        "replace",
      ),
    ];

    if (plain.dotIndex !== undefined) {
      deterministicTranslations.push(
        translationResult(
          orderedBlocks[plain.dotIndex]!,
          orderedPageBlocks[plain.dotIndex]!,
          ".",
          "keep",
        ),
      );
    }

    return {
      materialsBlockId: orderedBlocks[plain.materialsIndex]!.localId,
      deterministicTranslations,
    };
  }

  const headings = classifyPage2HeadingsShape(orderedPageBlocks);

  if (headings) {
    const deterministicTranslations: TranslationResponse["translations"] = [
      translationResult(
        orderedBlocks[headings.materialsHeadingIndex]!,
        orderedPageBlocks[headings.materialsHeadingIndex]!,
        MATERIALS_HEADING[language],
        "replace",
      ),
      translationResult(
        orderedBlocks[headings.explanationsHeadingIndex]!,
        orderedPageBlocks[headings.explanationsHeadingIndex]!,
        EXPLANATIONS_HEADING[language],
        "replace",
      ),
      translationResult(
        orderedBlocks[headings.abbreviationsHeadingIndex]!,
        orderedPageBlocks[headings.abbreviationsHeadingIndex]!,
        ABBREVIATIONS_HEADING[language],
        "replace",
      ),
      translationResult(
        orderedBlocks[headings.explanationsBodyIndex]!,
        orderedPageBlocks[headings.explanationsBodyIndex]!,
        INSTRUCTIONS[language],
        "replace",
      ),
      translationResult(
        orderedBlocks[headings.abbreviationsBodyIndex]!,
        orderedPageBlocks[headings.abbreviationsBodyIndex]!,
        GLOSSARY[language],
        "replace",
      ),
    ];

    if (headings.dotIndex !== undefined) {
      deterministicTranslations.push(
        translationResult(
          orderedBlocks[headings.dotIndex]!,
          orderedPageBlocks[headings.dotIndex]!,
          ".",
          "keep",
        ),
      );
    }

    return {
      materialsBlockId: orderedBlocks[headings.materialsBodyIndex]!.localId,
      deterministicTranslations,
    };
  }

  return undefined;
};
