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
  en: "Thank you very much for purchasing my pattern.\nThis pattern is for personal use only. You may sell the toy you make, but this pattern may not be shared, sold, or translated into other languages without permission under any circumstances. This is a paid pattern, and I absolutely do not consent to it being distributed free of charge or used on other platforms without permission.\n@suen.baby.amigurumi",
  es: "Muchas gracias por comprar mi patrón.\nEste patrón es únicamente para uso personal. Puedes vender el muñeco que realices, pero este patrón no puede compartirse, venderse ni traducirse a otros idiomas sin permiso bajo ninguna circunstancia. Este es un patrón de pago y no doy mi consentimiento para que se distribuya gratuitamente ni se utilice en otras plataformas sin autorización.\n@suen.baby.amigurumi",
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

export const CLOSING_TR = [
  "TEBRIKLER!!",
  "Ördüklerinizi görmek için sabırsızlanıyorum.\nİnstagramda Buzu paylaşımlarınızı bekliyor olacağım.\nPaylaşımlarınızda beni de etiketlerseniz ördüğünüz güzel Buzu’ları görmekten mutluluk duyarım. \nBir sonraki tasarımda görüşmek üzere.\nSevgiyle ve Hoşça kalın!!",
  "Buzu’yu Tamamladınız!",
  ".",
] as const;

export const CLOSING = {
  en: [
    "CONGRATULATIONS!!",
    "I can't wait to see what you've made.\nI'll be looking forward to seeing your Buzu posts on Instagram.\nIf you tag me in your posts, I'll be very happy to see the beautiful Buzus you've made.\nSee you in the next design.\nWith love, and goodbye!!",
    "You've Completed Buzu!",
    ".",
  ],
  es: [
    "¡¡FELICIDADES!!",
    "Estoy deseando ver lo que has tejido.\nEstaré esperando ver tus publicaciones de Buzu en Instagram.\nSi me etiquetas en tus publicaciones, me hará mucha ilusión ver los preciosos Buzu que has tejido.\nNos vemos en el próximo diseño.\n¡Con cariño y hasta pronto!",
    "¡Has Completado a Buzu!",
    ".",
  ],
} as const;

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

export const buildStaticTemplateTranslationResponse = (
  page: Page,
  blocks: readonly CanvaTranslationBlock[],
  language: TargetLanguage,
): TranslationResponse | undefined => {
  const orderedPageBlocks = [...page.blocks].sort((a, b) => a.order - b.order);
  const orderedBlocks = [...blocks].sort((a, b) => a.order - b.order);

  if (orderedPageBlocks.length !== orderedBlocks.length) return undefined;

  // Page 1:
  // pattern title stays untouched; only the universal notice changes.
  if (
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

  // Page 2:
  // materials are pattern-specific and intentionally untouched.
  // instructions + glossary are universal and deterministic.
  //
  // Canva may expose this page as either:
  //   3 blocks: materials, instructions, glossary
  //   4 blocks: materials, instructions, decorative ".", glossary
  //
  // The decorative dot is not semantically relevant and is not always
  // present in the text inventory, so support both representations.
  const page2HasThreeBlocks =
    orderedPageBlocks.length === 3 &&
    sameTemplateText(orderedPageBlocks[1]?.sourceText ?? "", INSTRUCTIONS_TR) &&
    sameTemplateText(orderedPageBlocks[2]?.sourceText ?? "", GLOSSARY_TR);

  const page2HasFourBlocks =
    orderedPageBlocks.length === 4 &&
    sameTemplateText(orderedPageBlocks[1]?.sourceText ?? "", INSTRUCTIONS_TR) &&
    sameTemplateText(orderedPageBlocks[2]?.sourceText ?? "", ".") &&
    sameTemplateText(orderedPageBlocks[3]?.sourceText ?? "", GLOSSARY_TR);

  if (page2HasThreeBlocks || page2HasFourBlocks) {
    const materialsResult = translationResult(
      orderedBlocks[0]!,
      orderedPageBlocks[0]!,
      orderedPageBlocks[0]!.sourceText,
      "keep",
    );

    const instructionsResult = translationResult(
      orderedBlocks[1]!,
      orderedPageBlocks[1]!,
      INSTRUCTIONS[language],
      "replace",
    );

    if (page2HasThreeBlocks) {
      return {
        translations: [
          materialsResult,
          instructionsResult,
          translationResult(
            orderedBlocks[2]!,
            orderedPageBlocks[2]!,
            GLOSSARY[language],
            "replace",
          ),
        ],
      };
    }

    return {
      translations: [
        materialsResult,
        instructionsResult,
        translationResult(
          orderedBlocks[2]!,
          orderedPageBlocks[2]!,
          ".",
          "keep",
        ),
        translationResult(
          orderedBlocks[3]!,
          orderedPageBlocks[3]!,
          GLOSSARY[language],
          "replace",
        ),
      ],
    };
  }

  // Page 9:
  // all visible copy is universal for this template family.
  if (
    orderedPageBlocks.length === 4 &&
    orderedPageBlocks.every(
      (block, index) => sameTemplateText(block.sourceText, CLOSING_TR[index] ?? ""),
    )
  ) {
    return {
      translations: orderedBlocks.map((block, index) =>
        translationResult(
          block,
          orderedPageBlocks[index]!,
          CLOSING[language][index]!,
          index === 3 ? "keep" : "replace",
        ),
      ),
    };
  }

  // Unknown/changed template: do not guess.
  return undefined;
};
