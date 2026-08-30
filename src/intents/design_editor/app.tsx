import {
  Alert,
  Button,
  CheckboxGroup,
  FormField,
  MultilineInput,
  Rows,
  Text,
  Title,
} from "@canva/app-ui-kit";
import { useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import * as styles from "styles/components.css";
import {
  loadSourceDesignContext,
  type SourceDesignContext,
} from "./source_design_context";
import {
  CopyDesignError,
  createDesignCopy,
  openCopiedDesign,
  startCanvaConnectAuthorization,
  type CopiedDesign,
  type TargetLanguage,
} from "./copy_designs";
import {
  loadTargetContext,
  type DesignRole,
  type TranslationTargetContext,
} from "./target_context";
import {
  ApplyReviewError,
  applyPageReview,
  translateCurrentPage,
  type PageReview,
} from "./translation_review";
import { getCurrentPageIdentity, type PageIdentity } from "./page_identity";
import { hasBlockingReviewIntegrity } from "./review_severity";
import {
  loadPersistedPageState,
  readCurrentSnapshotDigest,
  savePersistedApplied,
  savePersistedReview,
  type DocumentProgressSummary,
  type LoadedPageWorkflowState,
} from "./persisted_page_state";
import {
  prepareRemainingPages,
  translateRemainingPages,
  type PreparedRemainingPages,
  type TranslateRemainingPagesResult,
} from "./translate_remaining_workflow";
import {
  loadBulkPreferences as loadPersistedBulkPreferences,
  saveBulkPreferences as savePersistedBulkPreferences,
} from "./bulk_preferences_persistence";

const ENGLISH = "en";
const SPANISH = "es";

type AppProps = {
  loadSourceContext?: () => Promise<SourceDesignContext>;
  copyDesign?: (
    language: TargetLanguage,
    sourceTitle?: string,
  ) => Promise<CopiedDesign>;
  openDesign?: (url: string) => Promise<unknown>;
  authorizeConnect?: () => Promise<unknown>;
  loadDesignRole?: () => Promise<DesignRole>;
  reviewPage?: (
    language: TargetLanguage,
    contextId: string,
  ) => Promise<PageReview>;
  applyReview?: typeof applyPageReview;
  getPageIdentity?: () => Promise<PageIdentity>;
  loadPageState?: (
    pageIdentity: PageIdentity,
    contextId: string,
  ) => Promise<LoadedPageWorkflowState>;
  savePageReview?: (
    pageIdentity: PageIdentity,
    review: PageReview,
  ) => Promise<void>;
  savePageApplied?: (
    pageIdentity: PageIdentity,
    review: PageReview,
    appliedSnapshotDigest: string,
  ) => Promise<void>;
  readSnapshotDigest?: (contextId: string) => Promise<string>;
  prepareRemaining?: (
    excludedPageIds?: ReadonlySet<string>,
  ) => Promise<PreparedRemainingPages>;
  translateRemaining?: (
    language: TargetLanguage,
    excludedPageIds?: ReadonlySet<string>,
  ) => Promise<TranslateRemainingPagesResult>;
  loadBulkPreferences?: typeof loadPersistedBulkPreferences;
  saveBulkPreferences?: typeof savePersistedBulkPreferences;
  pagePollIntervalMs?: number;
  initialDesignRole?: DesignRoleState;
};

type CopyState =
  | { status: "idle" | "copying" }
  | { status: "failed"; authorizationRequired: boolean }
  | { status: "copy_created"; result: CopiedDesign };

type SourceContextState =
  | { status: "loading" }
  | { status: "verified"; context: SourceDesignContext }
  | { status: "error" };

type DesignRoleState =
  | { status: "loading" }
  | { status: "source" }
  | { status: "target"; context: TranslationTargetContext }
  | { status: "error" };

/* eslint-disable formatjs/no-literal-string-in-jsx -- Stage 5 review UI is intentionally not localized yet. */
export const TargetReview = ({
  context,
  reviewPage,
  applyReview,
  verifyTarget,
  getPageIdentity,
  loadPageState,
  savePageReview,
  savePageApplied,
  readSnapshotDigest,
  prepareRemaining,
  translateRemaining = async () => {
    throw new Error("Bulk translation is unavailable.");
  },
  loadBulkPreferences = loadPersistedBulkPreferences,
  saveBulkPreferences = savePersistedBulkPreferences,
  pagePollIntervalMs,
}: {
  context: TranslationTargetContext;
  reviewPage: (
    language: TargetLanguage,
    contextId: string,
  ) => Promise<PageReview>;
  applyReview: typeof applyPageReview;
  verifyTarget: () => Promise<DesignRole>;
  getPageIdentity: () => Promise<PageIdentity>;
  loadPageState: (
    pageIdentity: PageIdentity,
    contextId: string,
  ) => Promise<LoadedPageWorkflowState>;
  savePageReview: (
    pageIdentity: PageIdentity,
    review: PageReview,
  ) => Promise<void>;
  savePageApplied: (
    pageIdentity: PageIdentity,
    review: PageReview,
    appliedSnapshotDigest: string,
  ) => Promise<void>;
  readSnapshotDigest: (contextId: string) => Promise<string>;
  prepareRemaining?: (
    excludedPageIds?: ReadonlySet<string>,
  ) => Promise<PreparedRemainingPages>;
  translateRemaining?: (
    language: TargetLanguage,
    excludedPageIds?: ReadonlySet<string>,
  ) => Promise<TranslateRemainingPagesResult>;
  loadBulkPreferences?: typeof loadPersistedBulkPreferences;
  saveBulkPreferences?: typeof savePersistedBulkPreferences;
  pagePollIntervalMs: number;
}) => {
  const [review, setReview] = useState<PageReview>();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [applyStatus, setApplyStatus] = useState<
    | "idle"
    | "applying"
    | "applied"
    | "applied_unsaved"
    | "applied_changed"
    | "error"
    | "stale"
    | "permission"
  >("idle");
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [bulkPlanStatus, setBulkPlanStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [bulkPlan, setBulkPlan] = useState<PreparedRemainingPages>();
  const [excludedPageNumbers, setExcludedPageNumbers] = useState("");

  const [persistedExcludedPageIds, setPersistedExcludedPageIds] = useState<
    ReadonlySet<string>
  >(new Set());

  const [bulkStatus, setBulkStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [bulkResult, setBulkResult] = useState<TranslateRemainingPagesResult>();
  const [pageIdentity, setPageIdentity] = useState<PageIdentity>();
  const [pageNotice, setPageNotice] = useState<"new" | "changed">();
  const [restoreNotice, setRestoreNotice] = useState<"restored" | "stale">();
  const [progressSummary, setProgressSummary] =
    useState<DocumentProgressSummary>({
      applied: 0,
      reviewed: 0,
      needsReview: 0,
      blocked: 0,
    });

  const persistedPageCount =
    progressSummary.applied +
    progressSummary.reviewed +
    progressSummary.needsReview +
    progressSummary.blocked;

  const unreviewedCount =
    context.pageCount === undefined
      ? undefined
      : Math.max(0, context.pageCount - persistedPageCount);

  const remainingActionCount =
    context.pageCount === undefined
      ? undefined
      : Math.max(0, context.pageCount - progressSummary.applied);

  const isDocumentComplete =
    context.pageCount !== undefined &&
    context.pageCount > 0 &&
    progressSummary.applied >= context.pageCount;
  const pageIdentityRef = useRef<PageIdentity | undefined>(undefined);
  const editSaveTimer = useRef<number | undefined>(undefined);
  const reviewRef = useRef<PageReview | undefined>(undefined);
  const applyStatusRef = useRef(applyStatus);
  reviewRef.current = review;
  applyStatusRef.current = applyStatus;

  const refreshProgressSummary = async (identity: PageIdentity) => {
    try {
      const loaded = await loadPageState(identity, context.contextId);
      if (pageIdentityRef.current?.key !== identity.key) return;
      setProgressSummary(loaded.progressSummary);
    } catch {
      // Persistence may already have succeeded. A progress refresh failure
      // must not be reported as a failed review/apply save.
    }
  };

  const showPage = async (next: PageIdentity, changed: boolean) => {
    const previous = pageIdentityRef.current;
    if (previous?.key === next.key) return;
    pageIdentityRef.current = next;
    setPageIdentity(next);
    setWarningsAcknowledged(false);
    setStatus("idle");
    setRestoreNotice(undefined);
    if (changed)
      setPageNotice(
        reviewRef.current && applyStatusRef.current !== "applied"
          ? "changed"
          : "new",
      );

    const loaded = await loadPageState(next, context.contextId);
    if (pageIdentityRef.current?.key !== next.key) return;
    setProgressSummary(loaded.progressSummary);
    if (loaded.disposition === "applied") {
      setReview(undefined);
      setApplyStatus("applied");
      return;
    }
    if (loaded.disposition === "applied_changed") {
      setReview(undefined);
      setApplyStatus("applied_changed");
      return;
    }
    if (loaded.disposition === "reconcile_applied" && loaded.review) {
      try {
        await savePageApplied(
          next,
          loaded.review,
          loaded.currentSnapshotDigest,
        );
        await refreshProgressSummary(next);
        setReview(undefined);
        setApplyStatus("applied");
      } catch {
        setReview(undefined);
        setApplyStatus("applied_unsaved");
      }
      return;
    }
    if (loaded.disposition === "review_restored" && loaded.review) {
      setReview(loaded.review);
      setRestoreNotice("restored");
      setApplyStatus("idle");
      return;
    }
    if (loaded.disposition === "stale_review") {
      setRestoreNotice("stale");
    }
    setReview(undefined);
    setApplyStatus("idle");
  };

  useEffect(() => {
    let active = true;

    loadBulkPreferences()
      .then((preferences) => {
        if (!active) return;
        setPersistedExcludedPageIds(new Set(preferences.excludedPageIds));
      })
      .catch(() => {
        // Bulk preferences are optional convenience state.
      });

    return () => {
      active = false;
    };
  }, [context.contextId, loadBulkPreferences]);

  useEffect(() => {
    let active = true;
    const detect = async () => {
      try {
        const next = await getPageIdentity();
        if (active) await showPage(next, pageIdentityRef.current !== undefined);
      } catch {
        // Detection is passive. Apply still performs a fresh identity check.
      }
    };
    void detect();
    const timer = window.setInterval(() => void detect(), pagePollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(timer);
      if (editSaveTimer.current !== undefined)
        window.clearTimeout(editSaveTimer.current);
    };
  }, [context.contextId, getPageIdentity, loadPageState, pagePollIntervalMs]);

  const runReview = async () => {
    if (!pageIdentity) return;
    const requestedPageKey = pageIdentity.key;
    setPageNotice(undefined);
    setStatus("loading");
    try {
      const nextReview = await reviewPage(context.language, context.contextId);
      if (pageIdentityRef.current?.key !== requestedPageKey) return;
      setReview(nextReview);
      await savePageReview(pageIdentity, nextReview);
      await refreshProgressSummary(pageIdentity);
      setStatus("idle");
      setApplyStatus("idle");
      setWarningsAcknowledged(false);
    } catch {
      setStatus("error");
    }
  };

  const resolveExcludedPageIds = (): ReadonlySet<string> => {
    if (!bulkPlan) return persistedExcludedPageIds;
    if (!excludedPageNumbers.trim()) return new Set();

    const requestedPageNumbers = new Set(
      excludedPageNumbers
        .split(",")
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value > 0),
    );

    return new Set(
      bulkPlan.workflow.plan.entries
        .filter((entry) => requestedPageNumbers.has(entry.discoveryIndex + 1))
        .map((entry) => entry.pageId),
    );
  };

  const checkRemainingPages = async () => {
    if (!prepareRemaining) return;

    setBulkPlanStatus("loading");

    try {
      const excludedPageIds = resolveExcludedPageIds();

      setPersistedExcludedPageIds(new Set(excludedPageIds));
      await saveBulkPreferences(excludedPageIds).catch(() => undefined);

      const result = await prepareRemaining(excludedPageIds);

      if (!bulkPlan && excludedPageIds.size > 0) {
        const restoredPageNumbers = result.workflow.plan.entries
          .filter((entry) => excludedPageIds.has(entry.pageId))
          .map((entry) => entry.discoveryIndex + 1)
          .sort((left, right) => left - right);

        setExcludedPageNumbers(restoredPageNumbers.join(", "));
      }

      setBulkPlan(result);
      setBulkPlanStatus("ready");
    } catch (cause) {
      console.error("Remaining pages inspection failed.", {
        name: cause instanceof Error ? cause.name : typeof cause,
        message: cause instanceof Error ? cause.message : String(cause),
      });

      setBulkPlanStatus("error");
    }
  };

  const runBulkTranslation = async () => {
    setBulkStatus("loading");

    try {
      const excludedPageIds = resolveExcludedPageIds();

      setPersistedExcludedPageIds(new Set(excludedPageIds));
      await saveBulkPreferences(excludedPageIds).catch(() => undefined);

      const result = await translateRemaining(
        context.language,
        excludedPageIds,
      );
      setBulkResult(result);
      setBulkStatus("success");
    } catch {
      setBulkStatus("error");
    }
  };

  const apply = async () => {
    if (!review || hasBlockingReviewIntegrity(review) || !pageIdentity) return;
    setApplyStatus("applying");
    let canvaApplied = false;
    try {
      const currentIdentity = await getPageIdentity();
      if (currentIdentity.key !== pageIdentity.key) {
        await showPage(currentIdentity, true);
        setPageNotice("changed");
        return;
      }
      if (editSaveTimer.current !== undefined) {
        window.clearTimeout(editSaveTimer.current);
        editSaveTimer.current = undefined;
      }
      await savePageReview(pageIdentity, review);
      await applyReview(
        review,
        { contextId: context.contextId, language: context.language },
        { verifyTarget },
      );
      canvaApplied = true;
      const appliedSnapshotDigest = await readSnapshotDigest(context.contextId);
      let persistedIdentity = pageIdentity;
      if (pageIdentity.source === "content_fingerprint") {
        const refreshedIdentity = await getPageIdentity().catch(
          () => pageIdentity,
        );
        persistedIdentity = refreshedIdentity;
        pageIdentityRef.current = refreshedIdentity;
        setPageIdentity(refreshedIdentity);
      }
      try {
        await savePageApplied(persistedIdentity, review, appliedSnapshotDigest);
        await refreshProgressSummary(persistedIdentity);
      } catch {
        setApplyStatus("applied_unsaved");
        return;
      }
      setApplyStatus("applied");
    } catch (cause) {
      if (canvaApplied) {
        setApplyStatus("applied_unsaved");
        return;
      }
      if (cause instanceof ApplyReviewError && cause.code === "STALE_REVIEW") {
        setApplyStatus("stale");
      } else if (
        (cause instanceof ApplyReviewError &&
          cause.code === "PERMISSION_REQUIRED") ||
        (cause instanceof Error &&
          /permission|scope|forbidden/iu.test(cause.message))
      ) {
        setApplyStatus("permission");
      } else {
        setApplyStatus("error");
      }
    }
  };

  const editTranslation = (id: string, value: string) => {
    setReview((current) => {
      if (!current) return current;
      const edited = {
        ...current,
        blocks: current.blocks.map((block) =>
          block.id === id ? { ...block, editedTranslation: value } : block,
        ),
      };
      if (pageIdentity) {
        if (editSaveTimer.current !== undefined)
          window.clearTimeout(editSaveTimer.current);
        editSaveTimer.current = window.setTimeout(() => {
          void savePageReview(pageIdentity, edited).catch(() => undefined);
          editSaveTimer.current = undefined;
        }, 500);
      }
      return edited;
    });
  };

  const languageName = context.language === "en" ? "English" : "Spanish";
  const integrityBlocked = review ? hasBlockingReviewIntegrity(review) : false;
  const pageStatus =
    applyStatus === "applied" || applyStatus === "applied_unsaved"
      ? "Applied"
      : applyStatus === "applied_changed"
        ? "Needs review"
        : review?.reviewStatus === "blocked" || integrityBlocked
          ? "Blocked"
          : review?.reviewStatus === "needs_review"
            ? "Needs review"
            : review
              ? "Ready"
              : "Unreviewed";

  const pageGuidance =
    pageStatus === "Applied"
      ? "This page is complete. Move to another Canva page."
      : pageStatus === "Blocked"
        ? "Resolve the blocking issues before applying."
        : pageStatus === "Needs review"
          ? "Check the warnings before applying."
          : pageStatus === "Ready"
            ? "Review is ready. Apply when you are satisfied."
            : "Review this page to continue.";

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        <Title>Crochet Translator</Title>
        <Rows spacing="0.5u">
          <Title size="small" tagName="h2">
            Target
          </Title>
          <Text>{languageName}</Text>
          <Title size="small" tagName="h2">
            Source
          </Title>
          <Text>{context.sourceTitle}</Text>
        </Rows>
        <Button
          variant="primary"
          stretch
          disabled={status === "loading" || !pageIdentity}
          onClick={() => void runReview()}
        >
          {applyStatus === "applied" ||
          applyStatus === "applied_changed" ||
          applyStatus === "applied_unsaved"
            ? "Review current page again"
            : review
              ? "Translate again"
              : "Review current page"}
        </Button>
        <Rows spacing="0.5u">
          <Title size="small" tagName="h2">
            Remaining pages
          </Title>

          <Button
            variant="secondary"
            stretch
            disabled={!prepareRemaining || bulkPlanStatus === "loading"}
            onClick={() => void checkRemainingPages()}
          >
            Check remaining pages
          </Button>

          <FormField
            label="Exclude page numbers"
            value={excludedPageNumbers}
            control={(props) => (
              <MultilineInput
                {...props}
                minRows={1}
                maxRows={2}
                placeholder="e.g. 3, 7, 12"
                onChange={setExcludedPageNumbers}
              />
            )}
          />

          <Text tone="secondary">
            Enter Canva page numbers separated by commas, then check remaining
            pages again before translating.
          </Text>

          {bulkPlanStatus === "loading" && (
            <Text tone="secondary">Checking remaining pages...</Text>
          )}

          {bulkPlanStatus === "error" && (
            <Alert tone="critical">
              Could not inspect the remaining pages.
            </Alert>
          )}

          {bulkPlanStatus === "ready" && bulkPlan && (
            <Rows spacing="0.5u">
              <Text>{`Eligible: ${bulkPlan.workflow.plan.counts.eligible}`}</Text>
              <Text>{`Already applied: ${bulkPlan.workflow.plan.counts.applied}`}</Text>
              <Text>{`Excluded: ${bulkPlan.workflow.plan.counts.excluded}`}</Text>
              <Text>{`Locked: ${bulkPlan.workflow.plan.counts.locked}`}</Text>
              <Text>{`Empty: ${bulkPlan.workflow.plan.counts.empty}`}</Text>
              <Text>{`Template candidates: ${bulkPlan.workflow.plan.counts.template_candidate}`}</Text>
              <Text>{`Ready from saved bulk review: ${bulkPlan.queue.counts.ready}`}</Text>
              <Text>{`Needs review from saved bulk review: ${bulkPlan.queue.counts.needs_review}`}</Text>
              <Text>{`Blocked from saved bulk review: ${bulkPlan.queue.counts.blocked}`}</Text>
              <Text>{`Pending translation: ${bulkPlan.queue.counts.pending}`}</Text>
            </Rows>
          )}

          <Button
            variant="secondary"
            stretch
            disabled={bulkStatus === "loading"}
            onClick={() => void runBulkTranslation()}
          >
            Translate remaining pages
          </Button>
        </Rows>
        {bulkStatus === "loading" && (
          <Text tone="secondary">Translating remaining pages...</Text>
        )}
        {bulkStatus === "error" && (
          <Alert tone="critical">
            Could not translate the remaining pages.
          </Alert>
        )}
        {bulkStatus === "success" && bulkResult && (
          <Rows spacing="0.5u">
            <Alert tone="positive">
              Remaining-page translation review completed.
            </Alert>
            <Text>{`Translated this run: ${bulkResult.translation.translatedPages}`}</Text>
            <Text>{`Failed this run: ${bulkResult.translation.failedPages}`}</Text>
            <Text>{`Ready: ${bulkResult.translation.queue.counts.ready}`}</Text>
            <Text>{`Needs review: ${bulkResult.translation.queue.counts.needs_review}`}</Text>
            <Text>{`Blocked: ${bulkResult.translation.queue.counts.blocked}`}</Text>
            <Text tone="secondary">
              No Canva pages were changed. Review before applying.
            </Text>
          </Rows>
        )}
        {pageNotice === "new" && <Alert tone="info">New page detected</Alert>}
        {pageNotice === "changed" && (
          <Alert tone="critical">
            The Canva page changed. Review the current page before applying.
          </Alert>
        )}
        <Rows spacing="0.5u">
          <Title size="small" tagName="h2">
            Document progress
          </Title>
          <Text>
            {context.pageCount === undefined
              ? `Applied: ${progressSummary.applied}`
              : `Applied: ${progressSummary.applied} / ${context.pageCount}`}
          </Text>
          <Text>{`Ready: ${progressSummary.reviewed}`}</Text>
          <Text>{`Needs review: ${progressSummary.needsReview}`}</Text>
          <Text>{`Blocked: ${progressSummary.blocked}`}</Text>
          <Text>{`Current page status: ${pageStatus}`}</Text>
          <Text tone="secondary">{pageGuidance}</Text>
          {unreviewedCount !== undefined && (
            <Text>{`Unreviewed: ${unreviewedCount}`}</Text>
          )}

          {isDocumentComplete ? (
            <Alert tone="positive">Document translation complete</Alert>
          ) : remainingActionCount !== undefined ? (
            <Text>{`${remainingActionCount} pages still need to be applied.`}</Text>
          ) : (
            <Text>Continue reviewing and applying pages manually.</Text>
          )}
        </Rows>
        {restoreNotice === "restored" && <Text>Saved review restored</Text>}
        {restoreNotice === "stale" && (
          <Alert tone="critical">
            This page changed since it was reviewed. Review the current page
            again.
          </Alert>
        )}
        {applyStatus === "applied" && !review && (
          <Alert tone="positive">Applied</Alert>
        )}
        {applyStatus === "applied_changed" && (
          <Alert tone="info">
            Applied page changed. Review the current page again if you want to
            translate it again.
          </Alert>
        )}
        {applyStatus === "applied_unsaved" && (
          <Alert tone="critical">
            Translation was applied, but progress could not be saved.
          </Alert>
        )}
        {status === "loading" && (
          <Text tone="secondary">Translating current page...</Text>
        )}
        {status === "error" && (
          <Alert tone="critical">
            Could not prepare the translation review.
          </Alert>
        )}
        {review && (
          <Rows spacing="1u">
            <Title size="small" tagName="h2">{`${languageName} Review`}</Title>
            <Text>{`Current page · ${review.blocks.length} text blocks`}</Text>
            <Text>{`Page status: ${pageStatus}`}</Text>
            {review.blocks.map((block, index) => (
              <Rows key={block.id} spacing="0.5u">
                <Title size="small" tagName="h3">{`Block ${index + 1}`}</Title>
                <Text tone="secondary">Original</Text>
                <Text>{block.source}</Text>
                <FormField
                  label="Translation"
                  value={block.editedTranslation}
                  control={(props) => (
                    <MultilineInput
                      {...props}
                      minRows={2}
                      maxRows={8}
                      autoGrow
                      onChange={(value) => editTranslation(block.id, value)}
                    />
                  )}
                />
                {block.editedTranslation !== block.translated && (
                  <Text>Edited</Text>
                )}
                <Text
                  tone={block.validation === "BLOCK" ? "critical" : "secondary"}
                >
                  {block.validation}
                </Text>
                {block.validation === "WARNING" && (
                  <Text>Manual review recommended</Text>
                )}
                {[...block.errors, ...block.warnings].map(
                  (diagnostic, diagnosticIndex) => (
                    <Text
                      key={`${block.id}-${diagnostic.code}-${diagnosticIndex}`}
                      tone="secondary"
                    >
                      {diagnostic.message}
                    </Text>
                  ),
                )}
              </Rows>
            ))}
            {review.reviewStatus === "needs_review" && !integrityBlocked && (
              <>
                <Alert tone="info">This page contains review warnings.</Alert>
                <CheckboxGroup
                  options={[
                    {
                      // eslint-disable-next-line formatjs/no-literal-string-in-object -- Stage 6 UI is intentionally not localized yet.
                      label: "I reviewed the warnings",
                      value: "acknowledged",
                    },
                  ]}
                  value={warningsAcknowledged ? ["acknowledged"] : []}
                  onChange={(value) =>
                    setWarningsAcknowledged(value.includes("acknowledged"))
                  }
                />
              </>
            )}
            <Button
              variant="primary"
              stretch
              disabled={
                review.reviewStatus === "blocked" ||
                integrityBlocked ||
                applyStatus === "applying" ||
                applyStatus === "applied" ||
                applyStatus === "applied_unsaved" ||
                applyStatus === "applied_changed" ||
                (review.reviewStatus === "needs_review" &&
                  !warningsAcknowledged)
              }
              onClick={() => void apply()}
            >
              {review.reviewStatus === "needs_review"
                ? "Apply reviewed translation"
                : "Apply translation to this page"}
            </Button>
            {applyStatus === "applying" && <Text>Applying translation...</Text>}
            {applyStatus === "applied" && (
              <Rows spacing="0.5u">
                <Alert tone="positive">
                  {`Translation applied to current page. ${review.blocks.length} blocks applied. Layout review recommended.`}
                </Alert>
                <Text>Go to the next Canva page, then return here.</Text>
              </Rows>
            )}
            {applyStatus === "stale" && (
              <Alert tone="critical">
                This page changed after translation. Review it again before
                applying.
              </Alert>
            )}
            {applyStatus === "permission" && (
              <Alert tone="critical">
                Canva write permission is required to apply reviewed
                translations.
              </Alert>
            )}
            {applyStatus === "error" && (
              <Alert tone="critical">
                The reviewed translation could not be applied.
              </Alert>
            )}
          </Rows>
        )}
        <Alert tone="neutral">
          Changes are written only after you explicitly apply this review.
        </Alert>
      </Rows>
    </div>
  );
};
/* eslint-enable formatjs/no-literal-string-in-jsx */

export const App = ({
  loadSourceContext = loadSourceDesignContext,
  copyDesign = createDesignCopy,
  openDesign = openCopiedDesign,
  authorizeConnect = startCanvaConnectAuthorization,
  loadDesignRole = loadTargetContext,
  reviewPage = translateCurrentPage,
  applyReview = applyPageReview,
  getPageIdentity = getCurrentPageIdentity,
  loadPageState = loadPersistedPageState,
  savePageReview = savePersistedReview,
  savePageApplied = savePersistedApplied,
  readSnapshotDigest = readCurrentSnapshotDigest,
  prepareRemaining = (excludedPageIds) =>
    prepareRemainingPages(excludedPageIds),
  translateRemaining = (language, excludedPageIds) =>
    translateRemainingPages(language, excludedPageIds),
  loadBulkPreferences: loadBulkPreferencesProp = loadPersistedBulkPreferences,
  saveBulkPreferences: saveBulkPreferencesProp = savePersistedBulkPreferences,
  pagePollIntervalMs = 1000,
  initialDesignRole = { status: "loading" },
}: AppProps) => {
  const intl = useIntl();
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [copies, setCopies] = useState<Record<TargetLanguage, CopyState>>({
    en: { status: "idle" },
    es: { status: "idle" },
  });
  const [sourceContext, setSourceContext] = useState<SourceContextState>({
    status: "loading",
  });
  const [designRole, setDesignRole] =
    useState<DesignRoleState>(initialDesignRole);

  useEffect(() => {
    if (initialDesignRole.status !== "loading") return;
    let active = true;
    loadDesignRole()
      .then((role) => {
        if (!active) return;
        setDesignRole(
          role.isTranslationTarget
            ? { status: "target", context: role }
            : { status: "source" },
        );
      })
      .catch(() => {
        if (active) setDesignRole({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [initialDesignRole.status, loadDesignRole]);

  useEffect(() => {
    let active = true;
    loadSourceContext()
      .then((context) => {
        if (!active) return;
        setSourceContext(
          context.verified
            ? { status: "verified", context }
            : { status: "error" },
        );
      })
      .catch(() => {
        if (active) setSourceContext({ status: "error" });
      });

    return () => {
      active = false;
    };
  }, [loadSourceContext]);

  const handleTargetLanguagesChange = (languages: string[]) => {
    setTargetLanguages(languages);
  };

  const createOne = async (language: TargetLanguage) => {
    if (
      copies[language].status === "copy_created" ||
      sourceContext.status !== "verified"
    )
      return;
    setCopies((current) => ({ ...current, [language]: { status: "copying" } }));
    try {
      const result = await copyDesign(language, sourceContext.context.title);
      setCopies((current) => ({
        ...current,
        [language]: { status: "copy_created", result },
      }));
    } catch (cause) {
      setCopies((current) => ({
        ...current,
        [language]: {
          status: "failed",
          authorizationRequired:
            cause instanceof CopyDesignError && cause.code === "AUTH_REQUIRED",
        },
      }));
    }
  };

  const handleCreateCopies = () => {
    for (const language of targetLanguages)
      void createOne(language as TargetLanguage);
  };

  const languageName = (language: TargetLanguage) =>
    language === "en" ? "English" : "Spanish";

  if (designRole.status === "target") {
    return (
      <TargetReview
        context={designRole.context}
        reviewPage={reviewPage}
        applyReview={applyReview}
        verifyTarget={loadDesignRole}
        getPageIdentity={getPageIdentity}
        loadPageState={loadPageState}
        savePageReview={savePageReview}
        savePageApplied={savePageApplied}
        readSnapshotDigest={readSnapshotDigest}
        prepareRemaining={prepareRemaining}
        translateRemaining={translateRemaining}
        loadBulkPreferences={loadBulkPreferencesProp}
        saveBulkPreferences={saveBulkPreferencesProp}
        pagePollIntervalMs={pagePollIntervalMs}
      />
    );
  }

  /* eslint-disable formatjs/no-literal-string-in-jsx -- Temporary role-detection states. */
  if (designRole.status === "loading") {
    return (
      <div className={styles.scrollContainer}>
        <Text>Detecting design role...</Text>
      </div>
    );
  }

  if (designRole.status === "error") {
    return (
      <div className={styles.scrollContainer}>
        <Alert tone="critical">
          Could not verify whether this design is a translation target.
        </Alert>
      </div>
    );
  }
  /* eslint-enable formatjs/no-literal-string-in-jsx */

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        <Rows spacing="0.5u">
          <Title>
            <FormattedMessage
              defaultMessage="Crochet Translator"
              description="App title"
            />
          </Title>
          <Text tone="secondary">
            <FormattedMessage
              defaultMessage="Create English and Spanish copies of your Turkish crochet patterns."
              description="Short explanation of what the app will do"
            />
          </Text>
        </Rows>

        <Rows spacing="0.5u">
          <Title size="small" tagName="h2">
            <FormattedMessage
              defaultMessage="Source"
              description="Heading for the source design section"
            />
          </Title>
          <Text>
            <FormattedMessage
              defaultMessage="Turkish"
              description="Selected source language"
            />
          </Text>
          <Title size="small" tagName="h3">
            <FormattedMessage
              defaultMessage="Design"
              description="Label for the current source design"
            />
          </Title>
          {sourceContext.status === "loading" && (
            <Text tone="secondary">
              <FormattedMessage
                defaultMessage="Detecting source design…"
                description="Status while the source design is verified"
              />
            </Text>
          )}
          {sourceContext.status === "verified" && (
            <>
              <Text>
                {sourceContext.context.title || (
                  <FormattedMessage
                    defaultMessage="Untitled design"
                    description="Fallback when a Canva design has no title"
                  />
                )}
              </Text>
              {sourceContext.context.pageCount !== undefined && (
                <Text tone="secondary">
                  {intl.formatMessage(
                    {
                      defaultMessage:
                        "{pageCount, plural, one {# page} other {# pages}}",
                      description: "Number of pages in the source design",
                    },
                    { pageCount: sourceContext.context.pageCount },
                  )}
                </Text>
              )}
              <Text>
                <FormattedMessage
                  defaultMessage="Source design detected"
                  description="Status after backend verification succeeds"
                />
              </Text>
            </>
          )}
          {sourceContext.status === "error" && (
            <Alert tone="critical">
              <FormattedMessage
                defaultMessage="Could not verify the current Canva design."
                description="Error shown when source verification fails"
              />
            </Alert>
          )}
        </Rows>

        <Rows spacing="1u">
          <Title size="small" tagName="h2">
            <FormattedMessage
              defaultMessage="Translate to"
              description="Heading for the target language section"
            />
          </Title>
          <CheckboxGroup
            options={[
              {
                label: intl.formatMessage({
                  defaultMessage: "English",
                  description: "English target language option",
                }),
                value: ENGLISH,
              },
              {
                label: intl.formatMessage({
                  defaultMessage: "Español",
                  description: "Spanish target language option",
                }),
                value: SPANISH,
              },
            ]}
            value={targetLanguages}
            onChange={handleTargetLanguagesChange}
          />
        </Rows>

        <Button
          variant="primary"
          stretch
          disabled={
            targetLanguages.length === 0 || sourceContext.status !== "verified"
          }
          onClick={handleCreateCopies}
        >
          {intl.formatMessage({
            defaultMessage: "Create translated copies",
            description: "Button to begin creating translated design copies",
          })}
        </Button>

        {(["en", "es"] as const).map((language) => {
          const copy = copies[language];
          if (copy.status === "idle") return null;
          return (
            <Rows key={language} spacing="0.5u">
              <Text>{languageName(language)}</Text>
              {copy.status === "copying" && (
                <Text tone="secondary">
                  {intl.formatMessage(
                    {
                      defaultMessage: "Creating {language} copy...",
                      description:
                        "Progress while a target-language design copy is created",
                    },
                    { language: languageName(language) },
                  )}
                </Text>
              )}
              {copy.status === "copy_created" && (
                <>
                  <Text>
                    {intl.formatMessage(
                      {
                        defaultMessage: "{language} copy created.",
                        description:
                          "Success status for a target-language design copy",
                      },
                      { language: languageName(language) },
                    )}
                  </Text>
                  <Button
                    variant="secondary"
                    onClick={() => void openDesign(copy.result.editUrl)}
                  >
                    {intl.formatMessage({
                      defaultMessage: "Open design",
                      description: "Open a newly copied Canva design",
                    })}
                  </Button>
                </>
              )}
              {copy.status === "failed" && (
                <>
                  <Text tone="critical">
                    <FormattedMessage
                      defaultMessage="Copy failed"
                      description="Design copy failure status"
                    />
                  </Text>
                  {copy.authorizationRequired && (
                    <Button
                      variant="secondary"
                      onClick={() => void authorizeConnect()}
                    >
                      {intl.formatMessage({
                        defaultMessage: "Connect Canva",
                        description: "Authorize Canva Connect access",
                      })}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => void createOne(language)}
                  >
                    {intl.formatMessage({
                      defaultMessage: "Retry",
                      description: "Retry a failed design copy",
                    })}
                  </Button>
                </>
              )}
            </Rows>
          );
        })}

        <Alert tone="neutral">
          <FormattedMessage
            defaultMessage="Your Turkish source design will never be modified."
            description="Safety notice that the source design remains unchanged"
          />
        </Alert>
      </Rows>
    </div>
  );
};
