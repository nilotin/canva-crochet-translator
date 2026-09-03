import { describe, expect, it, vi } from "vitest";
import {
  CanvaCopyOperations,
  deriveTargetDesignTitle,
} from "../copy_operations.js";
import { MemoryCopyOperationStore } from "../copy_operation_store.js";

describe("deriveTargetDesignTitle", () => {
  it("replaces a recognized trailing Turkish label with the target language label", () => {
    expect(deriveTargetDesignTitle("Selene Doll Turkish", "en")).toBe(
      "Selene Doll English",
    );
    expect(deriveTargetDesignTitle("Selene Doll Turkish", "es")).toBe(
      "Selene Doll Spanish",
    );
  });

  it("appends the target label when there is no recognized trailing label", () => {
    expect(deriveTargetDesignTitle("My Pattern", "en")).toBe(
      "My Pattern English",
    );
    expect(deriveTargetDesignTitle("My Pattern", "es")).toBe(
      "My Pattern Spanish",
    );
  });

  it("replaces an existing trailing English/Spanish label rather than stacking it", () => {
    expect(deriveTargetDesignTitle("Selene Doll English", "es")).toBe(
      "Selene Doll Spanish",
    );
    expect(deriveTargetDesignTitle("Selene Doll Spanish", "en")).toBe(
      "Selene Doll English",
    );
  });

  it("avoids producing a duplicate suffix when the source already ends with the target label", () => {
    expect(deriveTargetDesignTitle("Selene Doll English", "en")).toBe(
      "Selene Doll English",
    );
  });

  it("only replaces a TRAILING label, never an arbitrary occurrence elsewhere in the title", () => {
    expect(deriveTargetDesignTitle("Turkish Delight - My Pattern", "en")).toBe(
      "Turkish Delight - My Pattern English",
    );
  });

  it("is case-insensitive when recognizing the trailing label, but normalizes the appended label's casing", () => {
    expect(deriveTargetDesignTitle("Selene Doll turkish", "en")).toBe(
      "Selene Doll English",
    );
    expect(deriveTargetDesignTitle("Selene Doll TURKISH", "es")).toBe(
      "Selene Doll Spanish",
    );
  });

  it("strips multiple stacked trailing labels rather than leaving duplicates", () => {
    expect(deriveTargetDesignTitle("Selene Doll Turkish English", "es")).toBe(
      "Selene Doll Spanish",
    );
  });

  it("falls back to a safe default title for an empty or whitespace-only source title", () => {
    expect(deriveTargetDesignTitle("", "en")).toBe("Untitled design English");
    expect(deriveTargetDesignTitle("   ", "es")).toBe(
      "Untitled design Spanish",
    );
  });

  it("preserves the rest of the design name exactly", () => {
    expect(deriveTargetDesignTitle("Buzu the Baby Seal - v2 Turkish", "en")).toBe(
      "Buzu the Baby Seal - v2 English",
    );
  });
});

describe("CanvaCopyOperations: desired target title", () => {
  it("returns the derived target title for a fresh copy without mutating the source", async () => {
    const copyEntireDesign = vi.fn().mockResolvedValue({
      copiedDesignId: "copy-en",
      editUrl: "https://www.canva.com/design/copy-en/edit",
    });

    const operations = new CanvaCopyOperations(
      { copyEntireDesign },
      new MemoryCopyOperationStore(),
    );

    const result = await operations.create({
      designId: "source-design",
      userId: "user-1",
      language: "en",
      sourceTitle: "Selene Doll Turkish",
    });

    expect(copyEntireDesign).toHaveBeenCalledTimes(1);
    expect(copyEntireDesign).toHaveBeenCalledWith(
      "source-design",
      "user-1",
    );
    expect(result.copiedDesignId).toBe("copy-en");
    expect(result.reused).toBe(false);
    expect(result.desiredTitle).toBe("Selene Doll English");
  });

  it("preserves the same desired title when an existing copy is reused", async () => {
    const store = new MemoryCopyOperationStore();

    const input = {
      designId: "source-design",
      userId: "user-1",
      language: "en" as const,
      sourceTitle: "Selene Doll Turkish",
    };

    await new CanvaCopyOperations(
      {
        copyEntireDesign: vi.fn().mockResolvedValue({
          copiedDesignId: "copy-en",
          editUrl: "https://www.canva.com/design/copy-en/edit",
        }),
      },
      store,
    ).create(input);

    const secondCopier = {
      copyEntireDesign: vi.fn(),
    };

    const result = await new CanvaCopyOperations(
      secondCopier,
      store,
    ).create(input);

    expect(result.reused).toBe(true);
    expect(secondCopier.copyEntireDesign).not.toHaveBeenCalled();
    expect(result.desiredTitle).toBe("Selene Doll English");
  });
});

