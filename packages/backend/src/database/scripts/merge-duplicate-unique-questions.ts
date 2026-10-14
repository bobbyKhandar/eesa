/**
 * Merge duplicate unique-question rows so the unique identity index can be built.
 *
 * A question is identified by normalizedText + subject. Older publishers could
 * insert two rows for that pair. Creating the unique index fails while those
 * duplicates exist.
 *
 * The default is a dry run. It prints the groups that would be merged and the
 * index change, and it does not write. Pass --apply to update the oldest row
 * in each group, delete the extras, and then create the unique index.
 *
 * Usage (from the repository root):
 *   npx tsx packages/backend/src/database/scripts/merge-duplicate-unique-questions.ts
 *   npx tsx packages/backend/src/database/scripts/merge-duplicate-unique-questions.ts --apply
 */

import { connect, disconnect } from "../connect.js";
import { getUniqueQuestionModel } from "../newFeatureModels.js";
import {
  UNIQUE_QUESTION_IDENTITY_INDEX,
  parseDedupArgs,
  planIdentityIndex,
  runUniqueQuestionDedup,
  type IdentityIndexInfo,
  type UniqueQuestionMergePlan,
  type UniqueQuestionSnapshot,
} from "../uniqueQuestionDedup.js";

const USAGE = `Merge duplicate unique-question records so the unique (normalizedText, subject) index can be built.

Usage:
  npx tsx packages/backend/src/database/scripts/merge-duplicate-unique-questions.ts
  npx tsx packages/backend/src/database/scripts/merge-duplicate-unique-questions.ts --apply

The default is a dry run: duplicate groups are printed and nothing is written.
--apply merges each group into the oldest row, unions source reports, appearances,
and prompt ids, keeps occurrence counts, deletes the extra rows, and then creates
the unique index.

Run --apply before starting a server that expects the unique index. Publishing
while the non-unique index is being replaced can still insert a duplicate.
`;

async function loadGroups(model: any): Promise<UniqueQuestionSnapshot[][]> {
  const grouped = await model.aggregate([
    {
      $match: {
        normalizedText: { $type: "string", $gt: "" },
        subject: { $type: "string", $gt: "" },
      },
    },
    {
      $group: {
        _id: { normalizedText: "$normalizedText", subject: "$subject" },
        count: { $sum: 1 },
        ids: { $push: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  const groups: UniqueQuestionSnapshot[][] = [];
  for (const group of grouped) {
    const ids = Array.isArray(group.ids) ? group.ids : [];
    if (ids.length < 2) continue;
    const docs = await model.find({ _id: { $in: ids } }).lean();
    groups.push(docs as UniqueQuestionSnapshot[]);
  }
  return groups;
}

async function writePlan(model: any, plan: UniqueQuestionMergePlan): Promise<void> {
  const updated = await model.updateOne({ _id: plan.keeperId }, { $set: plan.$set });
  if (!updated?.acknowledged || updated.matchedCount !== 1) {
    throw new Error(`Kept unique question ${String(plan.keeperId)} was not updated`);
  }
  const removed = await model.deleteMany({ _id: { $in: plan.removeIds } });
  if (removed?.deletedCount !== plan.removeIds.length) {
    throw new Error(
      `Expected to remove ${plan.removeIds.length} duplicate unique questions, removed ${removed?.deletedCount ?? 0}`
    );
  }
}

async function ensureIdentityIndex(collection: {
  indexes: () => Promise<IdentityIndexInfo[]>;
  dropIndex: (name: string) => Promise<unknown>;
  createIndex: (fields: Record<string, number>, options: Record<string, unknown>) => Promise<unknown>;
}): Promise<string> {
  const plan = planIdentityIndex(await collection.indexes());
  if (plan.action === "ready") {
    return `Unique index ${plan.name} already present.`;
  }
  if (plan.action === "replace") {
    for (const name of plan.drop) {
      await collection.dropIndex(name);
    }
  }
  await collection.createIndex(
    { normalizedText: 1, subject: 1 },
    { unique: true, name: UNIQUE_QUESTION_IDENTITY_INDEX }
  );
  if (plan.action === "replace") {
    return `Replaced non-unique index ${plan.drop.join(", ")} with unique index ${UNIQUE_QUESTION_IDENTITY_INDEX}.`;
  }
  return `Created unique index ${UNIQUE_QUESTION_IDENTITY_INDEX}.`;
}

async function main(apply: boolean): Promise<void> {
  await connect();
  try {
    const model = getUniqueQuestionModel();
    await runUniqueQuestionDedup({
      apply,
      log: (line) => console.log(line),
      loadDuplicateGroups: () => loadGroups(model),
      writePlan: (plan) => writePlan(model, plan),
      readIndexes: () => model.collection.indexes(),
      ensureIndex: () => ensureIdentityIndex(model.collection),
    });
  } finally {
    await disconnect();
  }
}

const parsed = parseDedupArgs(process.argv);
if ("error" in parsed) {
  if (parsed.error === "help") console.log(USAGE);
  else console.error(parsed.error);
  if (parsed.error !== "help") process.exitCode = 1;
} else {
  main(parsed.apply).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
