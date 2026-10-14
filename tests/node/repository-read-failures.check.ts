/**
 * Repository reads must not disguise a database failure as an empty list or a
 * missing record. GET /api/results (and the other read routes) already answer
 * 5xx from their catch blocks, but only if the repository lets the error out.
 * A query that matches nothing stays [] / null, which those routes turn into
 * 200 or 404.
 */
import "./repository-read-failures.boot.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { restoreMongooseConnect } from "./repository-read-failures.boot.ts";
import { ExamSubmissionRepository } from "../../packages/backend/src/database/repositories/ExamSubmissionRepository.ts";
import { UserRepository } from "../../packages/backend/src/database/repositories/UserRepository.ts";
import { ExamRepository } from "../../packages/backend/src/database/repositories/ExamRepository.ts";
import { PromptRepository } from "../../packages/backend/src/database/repositories/PromptRepository.ts";
import { ExamQuestionRepository } from "../../packages/backend/src/database/repositories/ExamQuestionRepository.ts";
import { ExamAnalysisRepository } from "../../packages/backend/src/database/repositories/ExamAnalysisRepository.ts";
import { SubjectRepository } from "../../packages/backend/src/database/repositories/SubjectRepository.ts";
import { JobMetadataRepository } from "../../packages/backend/src/database/repositories/JobMetadataRepository.ts";
import { UploadSessionRepository } from "../../packages/backend/src/database/repositories/UploadSessionRepository.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const DB_DOWN = "database read failed";
const USER_ID = "user_2fLq9";
const EXAM_ID = "507f1f77bcf86cd799439011";

after(() => {
  restoreMongooseConnect();
});

interface Chain {
  sort: () => Chain;
  limit: () => Chain;
  skip: () => Chain;
  select: () => Chain;
  lean: () => Promise<unknown>;
  then: Promise<unknown>["then"];
}

function chain(rows: unknown): Chain {
  const query = {
    sort() {
      return query;
    },
    limit() {
      return query;
    },
    skip() {
      return query;
    },
    select() {
      return query;
    },
    lean() {
      return Promise.resolve(rows);
    },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
  return query;
}

function failingChain(message = DB_DOWN): Chain {
  const query = {
    sort() {
      return query;
    },
    limit() {
      return query;
    },
    skip() {
      return query;
    },
    select() {
      return query;
    },
    lean() {
      return Promise.reject(new Error(message));
    },
    then(_onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.reject(new Error(message)).then(_onFulfilled, onRejected);
    },
  };
  return query;
}

function useModel(repo: object, model: Record<string, unknown>) {
  (repo as { model: unknown }).model = model;
}

describe("exam submission reads", () => {
  it("returns an empty history when the user has no graded submissions", async () => {
    const repo = new ExamSubmissionRepository();
    let filter: unknown;
    useModel(repo, {
      find(query: unknown) {
        filter = query;
        return chain([]);
      },
    });

    const rows = await repo.getByUser(USER_ID);

    assert.deepEqual(rows, []);
    assert.deepEqual(filter, { userId: USER_ID, gradingStatus: { $ne: "pending" } });
  });

  it("propagates a failure while loading a user's submissions", async () => {
    const repo = new ExamSubmissionRepository();
    useModel(repo, {
      find() {
        return failingChain();
      },
    });

    await assert.rejects(() => repo.getByUser(USER_ID), /database read failed/);
  });

  it("returns null for a missing submission and for an id that is not an ObjectId", async () => {
    const repo = new ExamSubmissionRepository();
    useModel(repo, {
      findById() {
        return chain(null);
      },
    });

    assert.equal(await repo.getById(EXAM_ID), null);
    assert.equal(await repo.getById("not-a-submission"), null);
  });

  it("keeps an in-progress claim hidden from getById", async () => {
    const repo = new ExamSubmissionRepository();
    useModel(repo, {
      findById() {
        return chain({ _id: EXAM_ID, gradingStatus: "pending", userId: USER_ID });
      },
    });

    assert.equal(await repo.getById(EXAM_ID), null);
  });

  it("propagates a failure while loading one submission", async () => {
    const repo = new ExamSubmissionRepository();
    useModel(repo, {
      findById() {
        return failingChain();
      },
    });

    await assert.rejects(() => repo.getById(EXAM_ID), /database read failed/);
  });

  it("still reports a claim failure instead of throwing", async () => {
    const repo = new ExamSubmissionRepository();
    useModel(repo, {
      async insertMany() {
        throw new Error("database write failed");
      },
      findOne() {
        return chain(null);
      },
    });

    const outcome = await repo.claimPending({
      examId: EXAM_ID,
      userId: USER_ID,
      timeSpent: 10,
    });

    assert.equal(outcome.status, "failed");
  });
});

describe("user and exam reads", () => {
  it("returns null when the user document is absent and throws when the lookup fails", async () => {
    const missing = new UserRepository();
    useModel(missing, {
      findById() {
        return chain(null);
      },
    });
    assert.equal(await missing.getById(USER_ID), null);

    const broken = new UserRepository();
    useModel(broken, {
      findById() {
        return failingChain();
      },
    });
    await assert.rejects(() => broken.getById(USER_ID), /database read failed/);
  });

  it("returns an empty allocation when the user has none, and throws when that read fails", async () => {
    const empty = new UserRepository();
    useModel(empty, {
      findById() {
        return chain({ currentAllocatedExams: [] });
      },
    });
    assert.deepEqual(await empty.getAllocatedExams(USER_ID), []);

    const broken = new UserRepository();
    useModel(broken, {
      findById() {
        return failingChain();
      },
    });
    await assert.rejects(() => broken.getAllocatedExams(USER_ID), /database read failed/);
  });

  it("returns real zero counts and throws when the count query fails", async () => {
    const empty = new UserRepository();
    useModel(empty, {
      async countDocuments() {
        return 0;
      },
    });
    assert.deepEqual(await empty.getCounts(), {
      total: 0,
      active: 0,
      inactive: 0,
      suspended: 0,
      admins: 0,
    });

    const broken = new UserRepository();
    useModel(broken, {
      async countDocuments() {
        throw new Error(DB_DOWN);
      },
    });
    await assert.rejects(() => broken.getCounts(), /database read failed/);
  });

  it("omits unknown exam ids and still excludes soft-deleted exams", async () => {
    const repo = new ExamRepository();
    let filter: unknown;
    useModel(repo, {
      find(query: unknown) {
        filter = query;
        return chain([]);
      },
    });

    assert.deepEqual(await repo.getByIds([EXAM_ID, ""]), []);
    assert.deepEqual(filter, {
      _id: { $in: [EXAM_ID] },
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    });
  });

  it("returns null for a missing exam and throws when the exam read fails", async () => {
    const missing = new ExamRepository();
    useModel(missing, {
      async aggregate() {
        return [];
      },
    });
    assert.equal(await missing.getWithFullDetails(EXAM_ID), null);

    const broken = new ExamRepository();
    useModel(broken, {
      async aggregate() {
        throw new Error(DB_DOWN);
      },
    });
    await assert.rejects(() => broken.getWithFullDetails(EXAM_ID), /database read failed/);
  });

  it("propagates a failure from the exam list used by the admin route", async () => {
    const repo = new ExamRepository();
    useModel(repo, {
      find() {
        return failingChain();
      },
    });

    await assert.rejects(() => repo.getAll(), /database read failed/);
  });
});

describe("other repository reads that used to swallow errors", () => {
  it("propagates prompt, question, analysis, subject, job, and session read failures", async () => {
    const prompts = new PromptRepository();
    useModel(prompts, {
      find() {
        return failingChain();
      },
    });
    await assert.rejects(() => prompts.findBySubject("Operating Systems"), /database read failed/);

    const questions = new ExamQuestionRepository();
    useModel(questions, {
      findById() {
        return failingChain();
      },
    });
    await assert.rejects(
      () => questions.getById(EXAM_ID),
      /database read failed/,
    );

    const analyses = new ExamAnalysisRepository();
    useModel(analyses, {
      find() {
        return failingChain();
      },
    });
    await assert.rejects(() => analyses.getByUser(USER_ID), /database read failed/);

    const subjects = new SubjectRepository();
    useModel(subjects, {
      find() {
        return failingChain();
      },
    });
    await assert.rejects(() => subjects.getAll(), /database read failed/);

    const jobs = new JobMetadataRepository();
    useModel(jobs, {
      findOne() {
        return failingChain();
      },
    });
    await assert.rejects(() => jobs.findById("job-1"), /database read failed/);

    const sessions = new UploadSessionRepository();
    useModel(sessions, {
      find() {
        return failingChain();
      },
    });
    await assert.rejects(() => sessions.findByClerkUserId(USER_ID), /database read failed/);
  });

  it("keeps an empty prompt lookup and a missing analysis as empty data", async () => {
    const prompts = new PromptRepository();
    useModel(prompts, {
      find() {
        return chain([]);
      },
    });
    assert.deepEqual(await prompts.findBySubject("Operating Systems"), []);
    assert.deepEqual(await prompts.findByIds(["not-an-object-id"]), []);

    const analyses = new ExamAnalysisRepository();
    useModel(analyses, {
      findById() {
        return chain(null);
      },
    });
    assert.equal(await analyses.getById("missing-analysis"), null);
  });

  it("returns null for a session that is not stored and throws when that read fails", async () => {
    const missing = new UploadSessionRepository();
    useModel(missing, {
      findOne() {
        return chain(null);
      },
    });
    assert.equal(await missing.findById("session-1"), null);

    const broken = new UploadSessionRepository();
    useModel(broken, {
      findOne() {
        return failingChain();
      },
    });
    await assert.rejects(() => broken.findById("session-1"), /database read failed/);
  });

  it("returns an empty job list for an empty id set without querying", async () => {
    const jobs = new JobMetadataRepository();
    let queried = false;
    useModel(jobs, {
      find() {
        queried = true;
        return failingChain();
      },
    });

    assert.deepEqual(await jobs.findByJobIds([]), []);
    assert.equal(queried, false);
  });
});

describe("read routes answer 5xx when a repository read throws", () => {
  it("GET /api/results maps a thrown submission read to 500 and still 404s a missing user", () => {
    const source = read("packages/frontend/app/api/results/route.ts");
    assert.match(source, /submissionRepo\.getByUser\(\s*userId/);
    assert.match(source, /if\s*\(\s*!user\s*\)/);
    assert.match(source, /status:\s*404/);
    assert.match(source, /status:\s*500/);
    assert.match(source, /status:\s*400/);
    assert.doesNotMatch(source, /getByUser\([^)]*\)\s*\|\|\s*\[\]/);
    assert.doesNotMatch(source, /examRepo\.getById/);
    assert.doesNotMatch(source, /\.map\(\s*async/);
  });

  it("keeps 5xx on the other handlers that render repository reads", () => {
    const routes: Array<[string, RegExp]> = [
      ["packages/frontend/app/api/exams/list/route.ts", /status:\s*500/],
      ["packages/frontend/app/api/submissions/[id]/route.ts", /status:\s*500/],
      ["packages/frontend/app/api/users/submissions/[id]/examDetails/route.ts", /status:\s*500/],
      ["packages/frontend/app/api/admin/users/route.ts", /status:\s*500/],
      ["packages/frontend/app/api/admin/exams/route.ts", /status:\s*500/],
      ["packages/frontend/app/api/users/submissions/route.ts", /status:\s*502/],
      ["packages/frontend/app/api/users/userInfo/route.ts", /status:\s*502/],
      ["packages/frontend/app/api/exam-analysis/[id]/route.ts", /status:\s*500/],
      ["packages/frontend/app/api/upload-sessions/route.ts", /status:\s*500/],
      ["packages/frontend/app/api/jobs/cleanup/route.ts", /status:\s*500/],
      ["packages/frontend/app/api/resources/route.ts", /status:\s*500/],
    ];

    for (const [path, status] of routes) {
      assert.match(read(path), status, path);
    }
  });
});
