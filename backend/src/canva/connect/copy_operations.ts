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
    const suffix = input.language === "en" ? "EN" : "ES";
    return {
      ...copy,
      language: input.language,
      desiredTitle: `${input.sourceTitle?.trim() || "Untitled design"} - ${suffix}`,
    };
  }

  private toResult(operation: PersistedCopyOperation) {
    const suffix = operation.targetLanguage === "en" ? "EN" : "ES";
    return {
      copiedDesignId: operation.copiedDesignId,
      editUrl: operation.editUrl,
      language: operation.targetLanguage,
      desiredTitle: `${operation.sourceTitle} - ${suffix}`,
    };
  }
}
