/**
 * Claim one submission per exam and user before any Gemini grading call.
 *
 * The unique (examId, userId) index is the lock. The request that inserts the
 * pending row is the only one allowed to grade. A duplicate key means another
 * request already owns the row: return that submission when it is finished, or
 * a conflict when it is still pending. Grading failure deletes the pending row
 * so a later attempt can insert again.
 *
 * The grade write never touches `answers`. Legacy submissions keep that map so
 * a migration can rebuild `responses` from it.
 */

export interface GradedExamSubmission {
  responses: Array<{
    questionId: string;
    userResponse: string;
    maxMarks: number;
    allottedMarks: number;
    feedback?: string;
    suggestions?: string[];
  }>;
  marksAchieved: number;
  maxMarks: number;
}

export interface ClaimedSubmissionRef {
  _id?: unknown;
  gradingStatus?: string | null;
}

export type ClaimOutcome =
  | { status: "claimed"; submissionId: string }
  | { status: "duplicate"; submission: ClaimedSubmissionRef }
  | { status: "in_progress" }
  | { status: "failed"; error: string };

export interface SubmissionClaimStore {
  insertPending(): Promise<string>;
  findByExamAndUser(): Promise<ClaimedSubmissionRef | null>;
}

export type SubmitClaimResult =
  | { status: "submitted"; submissionId: string; totalMarks: number; maxTotalMarks: number }
  | { status: "duplicate"; submission: ClaimedSubmissionRef }
  | { status: "in_progress" }
  | { status: "invalid"; error: string }
  | { status: "failed"; error: string };

/** Mongo duplicate-key failures, including bulk writes from `insertMany`. */
export function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    code?: unknown;
    message?: unknown;
    writeErrors?: Array<{ code?: unknown } | undefined>;
  };
  if (record.code === 11000 || record.code === 11001) return true;
  if (record.writeErrors?.some((entry) => entry?.code === 11000 || entry?.code === 11001)) return true;
  return typeof record.message === "string" && record.message.includes("E11000");
}

/** A missing status is a legacy completed submission, not an in-flight claim. */
export function isVisibleSubmission(
  submission: { gradingStatus?: string | null } | null | undefined,
): boolean {
  if (!submission) return false;
  return submission.gradingStatus !== "pending";
}

export function gradedSubmissionFilter<T extends Record<string, unknown>>(
  filter: T,
): T & { gradingStatus: { $ne: "pending" } } {
  return { ...filter, gradingStatus: { $ne: "pending" } };
}

export function pendingClaimFilter(id: unknown): { _id: unknown; gradingStatus: "pending" } {
  return { _id: id, gradingStatus: "pending" };
}

export function gradedSubmissionUpdate(evaluation: GradedExamSubmission): {
  $set: {
    gradingStatus: "complete";
    responses: GradedExamSubmission["responses"];
    marksAchieved: number;
    maxMarks: number;
  };
} {
  return {
    $set: {
      gradingStatus: "complete",
      responses: evaluation.responses,
      marksAchieved: evaluation.marksAchieved,
      maxMarks: evaluation.maxMarks,
    },
  };
}

/**
 * Insert the pending row, or report the row the unique index already holds.
 * A conflict whose row disappears (the other request failed and released it)
 * is inserted on a second attempt. Two misses become an in-progress conflict
 * rather than a 500, so the caller can retry.
 */
export async function claimSubmissionSlot(store: SubmissionClaimStore): Promise<ClaimOutcome> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const submissionId = await store.insertPending();
      return { status: "claimed", submissionId };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        console.error("Error claiming exam submission:", error);
        return { status: "failed", error: "Failed to claim exam submission" };
      }
      let existing: ClaimedSubmissionRef | null = null;
      try {
        existing = await store.findByExamAndUser();
      } catch (lookupError) {
        console.error("Error reading submission after duplicate key:", lookupError);
        return { status: "in_progress" };
      }
      if (!existing) continue;
      if (existing.gradingStatus === "pending") return { status: "in_progress" };
      return { status: "duplicate", submission: existing };
    }
  }
  return { status: "in_progress" };
}

async function releaseClaim(release: (submissionId: string) => Promise<void>, submissionId: string): Promise<void> {
  try {
    await release(submissionId);
  } catch (error) {
    console.error("Failed to release exam submission claim:", error);
  }
}

/**
 * Grade only after this request owns the pending row. A duplicate or an
 * in-flight claim returns before `grade`. A grading error or a thrown failure
 * releases that row so the unique index does not block the retry.
 */
export async function submitExamAfterWindow(deps: {
  claim: () => Promise<ClaimOutcome>;
  grade: () => Promise<GradedExamSubmission | { error: string }>;
  complete: (
    submissionId: string,
    evaluation: GradedExamSubmission,
  ) => Promise<{ success: boolean; error?: string }>;
  release: (submissionId: string) => Promise<void>;
}): Promise<SubmitClaimResult> {
  const claim = await deps.claim();
  if (claim.status === "duplicate") return { status: "duplicate", submission: claim.submission };
  if (claim.status === "in_progress") return { status: "in_progress" };
  if (claim.status === "failed") return { status: "failed", error: claim.error };

  const submissionId = claim.submissionId;
  try {
    const evaluation = await deps.grade();
    if ("error" in evaluation) {
      await releaseClaim(deps.release, submissionId);
      return { status: "invalid", error: evaluation.error };
    }
    const saved = await deps.complete(submissionId, evaluation);
    if (!saved.success) {
      await releaseClaim(deps.release, submissionId);
      return { status: "failed", error: saved.error ?? "Failed to create submission" };
    }
    return {
      status: "submitted",
      submissionId,
      totalMarks: evaluation.marksAchieved,
      maxTotalMarks: evaluation.maxMarks,
    };
  } catch (error) {
    await releaseClaim(deps.release, submissionId);
    throw error;
  }
}
