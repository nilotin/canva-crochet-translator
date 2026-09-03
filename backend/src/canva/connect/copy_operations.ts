import { randomUUID } from "node:crypto";
import { CanvaConnectApiError } from "./client.js";
import type {
  CanvaDesignCopier,
  CopyOperationResult,
  CopyTargetLanguage,
} from "./types.js";
import {
  MemoryCopyOperationStore,
  type CopyOperationStore,
  type PersistedCopyOperation,
} from "./copy_operation_store.js";

// Feature: automatic target-copy naming.
//
// Recognizes a TRAILING language label ("Turkish" / "English" /
// "Spanish", as a whole final word, case-insensitive) on the SOURCE
// title and replaces it with the target language's label -- e.g.
// "Selene Doll Turkish" -> "Selene Doll English". Only a trailing
// label is touched; the same word appearing earlier in the title
// ("Turkish Delight - My Pattern") is left alone. If there is no
// recognized trailing label, the target label is safely appended
// instead ("My Pattern" -> "My Pattern English"). Repeated while there
// is still a trailing label to strip, so a title that already stacked
// multiple labels (from an earlier bug, or a manually-renamed source)
// converges on exactly one trailing label rather than accumulating
// duplicates.
//
// This NEVER touches the source design -- it only computes the string
// used to (best-effort) rename the newly-created COPY. See
// CanvaCopyOperations.run below for where that rename is applied.
const RECOGNIZED_LANGUAGE_LABELS = ["Turkish", "English", "Spanish"] as const;

const TARGET_LANGUAGE_LABEL: Record<CopyTargetLanguage, string> = {
  en: "English",
  es: "Spanish",
};

const trailingLanguageLabelPattern = new RegExp(
  `\\s+(?:${RECOGNIZED_LANGUAGE_LABELS.join("|")})$`,
  "iu",
);

export const deriveTargetDesignTitle = (
  sourceTitle: string,
  language: CopyTargetLanguage,
): string => {
  const trimmed = sourceTitle.trim();
  let base = trimmed.length > 0 ? trimmed : "Untitled design";

  while (trailingLanguageLabelPattern.test(base)) {
    base = base.replace(trailingLanguageLabelPattern, "").trimEnd();
  }

  return `${base} ${TARGET_LANGUAGE_LABEL[language]}`;
};

export class CanvaCopyOperations {
  private readonly pending = new Map<
    string,
    Promise<Omit<CopyOperationResult, "reused">>
  >();
  constructor(
    private readonly copier: CanvaDesignCopier,
    readonly store: CopyOperationStore = new MemoryCopyOperationStore(),
  ) {}

  async create(input: {
    designId: string;
    userId: string;
    language: CopyTargetLanguage;
    sourceTitle?: string;
  }): Promise<CopyOperationResult> {
    const key = `${input.userId}:${input.designId}:${input.language}`;
    const existing = await this.store.findBySourceLanguage({
      userId: input.userId,
      sourceDesignId: input.designId,
      targetLanguage: input.language,
    });
    if (existing) {
      if (!this.copier.getDesign) {
        return { ...this.toResult(existing), reused: true };
      }

      try {
        const current = await this.copier.getDesign(
          existing.copiedDesignId,
          input.userId,
        );

        return {
          ...this.toResult(existing),
          copiedDesignId: current.copiedDesignId,
          editUrl: current.editUrl,
          reused: true,
        };
      } catch (cause) {
        if (
          !(
            cause instanceof CanvaConnectApiError &&
            cause.code === "SOURCE_NOT_FOUND" &&
            cause.status === 404
          )
        ) {
          throw cause;
        }
      }
    }
    let operation = this.pending.get(key);
    if (!operation) {
      operation = this.run(input);
      this.pending.set(key, operation);
    }
    try {
      const result = await operation;
      if (input.designId === result.copiedDesignId) {
        throw new Error("Canva returned the source design as its own copy.");
      }
      const persisted: PersistedCopyOperation = {
        operationId: randomUUID(),
        userId: input.userId,
        sourceDesignId: input.designId,
        copiedDesignId: result.copiedDesignId,
        targetLanguage: input.language,
        sourceTitle: input.sourceTitle?.trim() || "Untitled design",
        editUrl: result.editUrl,
        status: "copy_created",
        createdAt: new Date().toISOString(),
      };
      await this.store.save(persisted);
      return { ...result, reused: false };
    } finally {
      this.pending.delete(key);
    }
  }

  async findTarget(userId: string, currentDesignId: string) {
    const target = await this.store.findByTargetDesign({
      userId,
      targetDesignId: currentDesignId,
    });
    if (!target || target.sourceDesignId === target.copiedDesignId) return;
    return {
      sourceDesignId: target.sourceDesignId,
      targetDesignId: target.copiedDesignId,
      language: target.targetLanguage,
      sourceTitle: target.sourceTitle,
      contextId: target.operationId,
    };
  }

  private async run(input: {
    designId: string;
    userId: string;
    language: CopyTargetLanguage;
    sourceTitle?: string;
  }) {
    const copy = await this.copier.copyEntireDesign(
      input.designId,
      input.userId,
    );
    const desiredTitle = deriveTargetDesignTitle(
      input.sourceTitle ?? "",
      input.language,
    );

    return {
      ...copy,
      language: input.language,
      desiredTitle,
    };
  }

  private toResult(operation: PersistedCopyOperation) {
    return {
      copiedDesignId: operation.copiedDesignId,
      editUrl: operation.editUrl,
      language: operation.targetLanguage,
      desiredTitle: deriveTargetDesignTitle(
        operation.sourceTitle,
        operation.targetLanguage,
      ),
    };
  }
}
