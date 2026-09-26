export type SleeveInstructionFamily = "setup" | "shaping" | "other_arm_alignment";

export type SleeveInstructionRender = {
  family: SleeveInstructionFamily;
  target: string;
};

const SETUP_PATTERN =
  /^(\s*(?:\d+\)\s*)?)(?:görselde\s+görüldüğü\s+gibi\s+)?kol\s+boşluğunun\s+arka\s+tarafından\s+ipimizi\s+sabitliyoruz\s*[.]\s*(\d+)\s*x\s+örüyoruz\s*[.]\s*başlangıç\s+noktamız\s+burası\s+olacak\s*[,，]\s*(?:işaretleyiciyi|işaretleyicimizi|markerı|markeri)\s+buraya\s+(?:takıyoruz|yerleştiriyoruz|koyuyoruz)\s*[.]?\s*$/iu;

const SHAPING_PATTERN =
  /^(\s*(?:\d+\)\s*)?)(\d+)\s*x\s+örüyoruz\s*\(\s*kolun\s+üzerindeki\s+dışa\s+doğru\s+kıvırdığımız\s+kısmı\s+öreceğiz\s*\)\s*[.]\s*görselde\s+görüldüğü\s+gibi\s+ben\s+(\d+)\s*x\s+ördüğümde\s+tam\s+kolun\s+üzerine\s+denk\s+geldi\s*[.]\s*sizde\s+kolun\s+üst\s+kısmına\s+denk\s+gelecek\s+şekilde\s+(\d+)-(\d+)\s+sık\s+iğne\s+eksik\s+ya\s+da\s+fazla\s+örebilirsiniz\s*[.]\s*(\d+)\s+zincir\s+çekip\s+dönüyoruz\s*[.]?\s*$/iu;

const OTHER_ARM_ALIGNMENT_PATTERN =
  /^(\s*)([♦✦])\s*diğer\s+kolu\s+da\s+aynı\s+şekilde\s+örüyoruz\s*[.]\s*\(\s*(\d+)\.\s*sırada\s+ilk\s+kolda\s+(\d+)\s*x\s+örüp\s+kolun\s+üzerine\s+denk\s+getirmiştim\s*[.]\s*diğer\s+kolu\s+örerken\s+(\d+)\s*x\s+ördüğümde\s+kolun\s+üzerine\s+denk\s+geldi\s*[.]\s*sizde\s+kolun\s+üzerine\s+denk\s+gelecek\s+şekilde\s+(\d+)-(\d+)\s+sık\s+iğne\s+eksik\s+ya\s+da\s+fazla\s+örerek\s+üst\s+kısma\s+gelin\s*[.]?\s*\)\s*$/iu;


export const renderEnglishSleeveInstruction = (
  source: string,
): SleeveInstructionRender | undefined => {
  const setup = SETUP_PATTERN.exec(source);

  if (setup) {
    const prefix = setup[1] ?? "";
    const stitches = setup[2] ?? "";

    return {
      family: "setup",
      target:
        `${prefix}As shown in the image, attach the yarn from the back of the armhole. ` +
        `Work ${stitches}sc. ` +
        "This will be the beginning of the round; place a stitch marker here.",
    };
  }

  const otherArmAlignment = OTHER_ARM_ALIGNMENT_PATTERN.exec(source);

  if (otherArmAlignment) {
    const leadingWhitespace = otherArmAlignment[1] ?? "";
    const marker = otherArmAlignment[2] ?? "";
    const round = otherArmAlignment[3] ?? "";
    const firstArmStitches = otherArmAlignment[4] ?? "";
    const otherArmStitches = otherArmAlignment[5] ?? "";
    const minAdjustment = otherArmAlignment[6] ?? "";
    const maxAdjustment = otherArmAlignment[7] ?? "";

    return {
      family: "other_arm_alignment",
      target:
        `${leadingWhitespace}${marker} Work the other arm in the same way. ` +
        `(In Round ${round}, on the first arm I worked ${firstArmStitches}sc to align with the top of the arm. ` +
        `On the other arm, it aligned after ${otherArmStitches}sc. ` +
        `Work ${minAdjustment}-${maxAdjustment} fewer or additional single crochet stitches as needed so that it aligns with the top of the arm.)`,
    };
  }

  const shaping = SHAPING_PATTERN.exec(source);

  if (shaping) {
    const prefix = shaping[1] ?? "";
    const firstStitches = shaping[2] ?? "";
    const alignedStitches = shaping[3] ?? "";
    const minAdjustment = shaping[4] ?? "";
    const maxAdjustment = shaping[5] ?? "";
    const chains = shaping[6] ?? "";

    return {
      family: "shaping",
      target:
        `${prefix}Work ${firstStitches}sc (we will crochet the section folded outward over the arm). ` +
        `As shown in the image, when I worked ${alignedStitches}sc, it aligned exactly over the arm. ` +
        `You can work ${minAdjustment}-${maxAdjustment} fewer or additional single crochet stitches so that it aligns with the top of the arm. ` +
        `Ch ${chains} and turn.`,
    };
  }

  return undefined;
};
