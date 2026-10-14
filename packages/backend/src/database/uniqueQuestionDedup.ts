/**
 * Identity and merge rules for the unique-question bank.
 *
 * A question is unique on `normalizedText` + `subject`. Publication upserts
 * that pair. Databases that already contain duplicates cannot build the
 * unique index until those rows are folded into one.
 */

export const UNIQUE_QUESTION_IDENTITY_INDEX = "normalizedText_1_subject_1";

export const uniqueQuestionIdentityIndex = {
  fields: { normalizedText: 1 as const, subject: 1 as const },
  options: { unique: true, name: UNIQUE_QUESTION_IDENTITY_INDEX },
};

const IDENTITY_ATTEMPTS = 3;

export interface UniqueQuestionSnapshot {
  _id: unknown;
  questionText?: unknown;
  normalizedText?: unknown;
  subject?: unknown;
  subjectCode?: unknown;
  branch?: unknown;
  questionType?: unknown;
  options?: unknown;
  marks?: unknown;
  bloomLevel?: unknown;
  bloomJustification?: unknown;
  confidence?: unknown;
  difficulty?: unknown;
  keywords?: unknown;
  topicsCovered?: unknown;
  topics?: unknown;
  bloomsLevel?: unknown;
  sourceReports?: unknown;
  occurrenceCount?: unknown;
  firstSeenAt?: unknown;
  lastSeenAt?: unknown;
  createdAt?: unknown;
  appearances?: unknown;
  promptIds?: unknown;
  tags?: unknown;
  estimatedMarks?: unknown;
  embedding?: unknown;
  clusterId?: unknown;
  isVerified?: unknown;
  isActive?: unknown;
}

export interface UniqueQuestionMergePlan {
  normalizedText: string;
  subject: string;
  keeperId: unknown;
  removeIds: unknown[];
  $set: Record<string, unknown>;
}

export interface IdentityIndexInfo {
  name?: string;
  key?: Record<string, number>;
  unique?: boolean;
}

export type IdentityIndexPlan =
  | { action: "ready"; name: string }
  | { action: "create" }
  | { action: "replace"; drop: string[] };

export type DedupArgs = { apply: boolean } | { error: string };

const SCALAR_FIELDS = [
  "questionText",
  "subjectCode",
  "branch",
  "questionType",
  "marks",
  "bloomLevel",
  "bloomJustification",
  "confidence",
  "difficulty",
  "bloomsLevel",
  "estimatedMarks",
  "clusterId",
] as const;

const STRING_LIST_FIELDS = ["topics", "tags", "keywords", "topicsCovered", "options"] as const;

/**
 * Mongo duplicate-key failures, including drivers that only put E11000 in the message.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errorResponse?: { code?: unknown };
    };
    if (record.code === 11000 || record.code === 11001) return true;
    if (record.errorResponse?.code === 11000 || record.errorResponse?.code === 11001) return true;
    if (typeof record.message === "string" && record.message.includes("E11000")) return true;
    current = record.cause;
  }
  return false;
}

export function identityWriteAttempts(): number {
  return IDENTITY_ATTEMPTS;
}

export function parseDedupArgs(argv: string[]): DedupArgs {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    return { error: "help" };
  }
  const unknown = args.filter((arg) => arg !== "--apply" && arg !== "--dry-run");
  if (unknown.length > 0) {
    return { error: `Unknown argument: ${unknown.join(", ")}` };
  }
  if (args.includes("--apply") && args.includes("--dry-run")) {
    return { error: "Pass either --apply or --dry-run." };
  }
  return { apply: args.includes("--apply") };
}

function identityKey(doc: UniqueQuestionSnapshot): string | null {
  if (typeof doc.normalizedText !== "string" || doc.normalizedText.length === 0) return null;
  if (typeof doc.subject !== "string" || doc.subject.length === 0) return null;
  return JSON.stringify([doc.normalizedText, doc.subject]);
}

function timeValue(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function compareSnapshots(left: UniqueQuestionSnapshot, right: UniqueQuestionSnapshot): number {
  const firstSeen = (timeValue(left.firstSeenAt) ?? Number.POSITIVE_INFINITY)
    - (timeValue(right.firstSeenAt) ?? Number.POSITIVE_INFINITY);
  if (firstSeen !== 0) return firstSeen;
  const created = (timeValue(left.createdAt) ?? Number.POSITIVE_INFINITY)
    - (timeValue(right.createdAt) ?? Number.POSITIVE_INFINITY);
  if (created !== 0) return created;
  return String(left._id).localeCompare(String(right._id));
}

function stringList(values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item !== "string" || item.length === 0) continue;
      if (!out.includes(item)) out.push(item);
    }
  }
  return out;
}

function numericCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function appearanceKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const year = typeof record.year === "string" ? record.year : "";
  const semester = typeof record.semester === "string" ? record.semester : "";
  const examType = record.examType === "main" || record.examType === "kt" ? record.examType : "";
  const analysisReportId = typeof record.analysisReportId === "string" ? record.analysisReportId : "";
  if (!year && !semester && !examType && !analysisReportId) return null;
  return JSON.stringify([analysisReportId, year, semester, examType]);
}

function appearanceList(docs: UniqueQuestionSnapshot[]): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    if (!Array.isArray(doc.appearances)) continue;
    for (const appearance of doc.appearances) {
      const key = appearanceKey(appearance);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(appearance);
    }
  }
  return out;
}

function firstFilled(docs: UniqueQuestionSnapshot[], field: keyof UniqueQuestionSnapshot): unknown {
  for (const doc of docs) {
    const value = doc[field];
    if (value == null) continue;
    if (typeof value === "string" && value.length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    return value;
  }
  return undefined;
}

function embeddingOf(docs: UniqueQuestionSnapshot[]): number[] | undefined {
  for (const doc of docs) {
    if (!Array.isArray(doc.embedding) || doc.embedding.length === 0) continue;
    if (doc.embedding.every((item) => typeof item === "number" && Number.isFinite(item))) {
      return doc.embedding as number[];
    }
  }
  return undefined;
}

function occurrenceCountOf(docs: UniqueQuestionSnapshot[], sourceReports: string[]): number {
  let unexplained = 0;
  for (const doc of docs) {
    const recorded = stringList([doc.sourceReports]).length;
    const count = numericCount(doc.occurrenceCount);
    if (count > recorded) unexplained += count - recorded;
  }
  return sourceReports.length + unexplained;
}

export function assertSafeMergePlan(plan: UniqueQuestionMergePlan): void {
  if (plan.removeIds.length === 0) {
    throw new Error("Merge plan has nothing to remove");
  }
  if (plan.removeIds.some((id) => String(id) === String(plan.keeperId))) {
    throw new Error("Merge plan would delete the kept unique question");
  }
}

/**
 * Fold documents that share `normalizedText` and `subject` into the oldest row.
 * Same analysis report is counted once. Occurrence counts that have no source
 * report are kept on top of the union of source reports.
 */
export function planDuplicateMerges(
  docs: UniqueQuestionSnapshot[],
  now: Date = new Date()
): UniqueQuestionMergePlan[] {
  const groups = new Map<string, UniqueQuestionSnapshot[]>();
  for (const doc of docs) {
    const key = identityKey(doc);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(doc);
    else groups.set(key, [doc]);
  }

  const plans: UniqueQuestionMergePlan[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(compareSnapshots);
    const keeper = ordered[0];
    const sourceReports = stringList(ordered.map((doc) => doc.sourceReports));
    const promptIds = stringList(ordered.map((doc) => doc.promptIds));
    const $set: Record<string, unknown> = {
      sourceReports,
      promptIds,
      appearances: appearanceList(ordered),
      occurrenceCount: occurrenceCountOf(ordered, sourceReports),
      isVerified: ordered.some((doc) => doc.isVerified === true),
      isActive: ordered.some((doc) => doc.isActive !== false),
      updatedAt: now,
    };

    const firstSeen = ordered
      .map((doc) => timeValue(doc.firstSeenAt))
      .filter((time): time is number => time != null);
    const lastSeen = ordered
      .map((doc) => timeValue(doc.lastSeenAt))
      .filter((time): time is number => time != null);
    if (firstSeen.length > 0) $set.firstSeenAt = new Date(Math.min(...firstSeen));
    if (lastSeen.length > 0) $set.lastSeenAt = new Date(Math.max(...lastSeen));

    for (const field of SCALAR_FIELDS) {
      const value = firstFilled(ordered, field);
      if (value !== undefined) $set[field] = value;
    }
    for (const field of STRING_LIST_FIELDS) {
      $set[field] = stringList(ordered.map((doc) => doc[field]));
    }
    const embedding = embeddingOf(ordered);
    if (embedding) $set.embedding = embedding;

    const plan: UniqueQuestionMergePlan = {
      normalizedText: keeper.normalizedText as string,
      subject: keeper.subject as string,
      keeperId: keeper._id,
      removeIds: ordered.slice(1).map((doc) => doc._id).filter((id) => String(id) !== String(keeper._id)),
      $set,
    };
    assertSafeMergePlan(plan);
    plans.push(plan);
  }
  return plans;
}

export function isIdentityIndexKey(key: Record<string, number> | undefined): boolean {
  if (!key) return false;
  const names = Object.keys(key);
  return names.length === 2 && key.normalizedText === 1 && key.subject === 1;
}

export function planIdentityIndex(indexes: IdentityIndexInfo[]): IdentityIndexPlan {
  const matches = indexes.filter((index) => isIdentityIndexKey(index.key));
  const unique = matches.find((index) => index.unique === true);
  if (unique) {
    return { action: "ready", name: unique.name || UNIQUE_QUESTION_IDENTITY_INDEX };
  }
  if (matches.length === 0) return { action: "create" };
  return {
    action: "replace",
    drop: matches.map((index) => index.name || UNIQUE_QUESTION_IDENTITY_INDEX),
  };
}

export function describeMergePlan(plan: UniqueQuestionMergePlan): string {
  const reports = Array.isArray(plan.$set.sourceReports) ? plan.$set.sourceReports.length : 0;
  return [
    `subject=${JSON.stringify(plan.subject)} normalizedText=${JSON.stringify(plan.normalizedText)}`,
    `  keep ${String(plan.keeperId)}`,
    `  remove ${plan.removeIds.map((id) => String(id)).join(", ")}`,
    `  merged occurrenceCount=${String(plan.$set.occurrenceCount)} sourceReports=${reports}`,
  ].join("\n");
}

export function describeDedupRun(input: {
  apply: boolean;
  plans: UniqueQuestionMergePlan[];
  indexPlan: IdentityIndexPlan | null;
}): string {
  const lines: string[] = [];
  if (input.apply) {
    lines.push("Applying unique-question duplicate merge.");
  } else {
    lines.push("Dry run: no unique-question documents will be written.");
  }

  if (input.plans.length === 0) {
    lines.push("No duplicate normalizedText + subject groups.");
  } else {
    lines.push(`Duplicate groups: ${input.plans.length}`);
    for (const plan of input.plans) lines.push(describeMergePlan(plan));
  }

  if (input.plans.length > 0 && !input.apply) {
    lines.push("The unique index cannot be created until these duplicates are merged.");
    lines.push("Re-run with --apply to merge duplicates and create the unique index.");
    return lines.join("\n");
  }

  if (input.indexPlan?.action === "ready") {
    lines.push(`Unique index ${input.indexPlan.name} is already in place.`);
  } else if (input.indexPlan?.action === "create") {
    lines.push(
      input.apply
        ? "Creating the unique normalizedText + subject index."
        : "Re-run with --apply to create the unique normalizedText + subject index."
    );
  } else if (input.indexPlan?.action === "replace") {
    lines.push(
      input.apply
        ? `Replacing non-unique index ${input.indexPlan.drop.join(", ")} with a unique index.`
        : `Re-run with --apply to replace non-unique index ${input.indexPlan.drop.join(", ")} with a unique index.`
    );
  }
  return lines.join("\n");
}

export async function runUniqueQuestionDedup(options: {
  apply: boolean;
  loadDuplicateGroups: () => Promise<UniqueQuestionSnapshot[][]>;
  writePlan?: (plan: UniqueQuestionMergePlan) => Promise<void>;
  readIndexes?: () => Promise<IdentityIndexInfo[]>;
  ensureIndex?: () => Promise<string>;
  now?: Date;
  log?: (line: string) => void;
}): Promise<{ duplicateGroups: number; applied: boolean }> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? new Date();
  const groups = await options.loadDuplicateGroups();
  const plans = groups.flatMap((group) => planDuplicateMerges(group, now));

  if (!options.apply) {
    const indexPlan = options.readIndexes ? planIdentityIndex(await options.readIndexes()) : null;
    log(describeDedupRun({ apply: false, plans, indexPlan }));
    return { duplicateGroups: plans.length, applied: false };
  }

  if (!options.writePlan || !options.ensureIndex) {
    throw new Error("Apply mode requires write and index steps");
  }

  log(describeDedupRun({ apply: true, plans, indexPlan: null }));
  for (const plan of plans) {
    assertSafeMergePlan(plan);
    await options.writePlan(plan);
  }

  const remaining = (await options.loadDuplicateGroups()).flatMap((group) => planDuplicateMerges(group, now));
  if (remaining.length > 0) {
    throw new Error(
      `${remaining.length} duplicate unique-question groups remain; unique index was not created`
    );
  }

  log(await options.ensureIndex());
  return { duplicateGroups: plans.length, applied: true };
}
