/**
 * The browser never holds the pipeline credential. Server-side callers attach
 * AI_PIPELINE_TOKEN, and job reads keep using jobContentAccessDecision rather
 * than a second ownership check.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import * as aiPipeline from "../../../packages/frontend/lib/aiPipeline.ts";

const { fetchFromAiPipeline } = aiPipeline;

function readRepoFile(relativePath: string): string {
  return readFileSync(relativePath, "utf8");
}

describe("withPipelineAuth", () => {
  it("sets a bearer token and keeps the caller's other headers", () => {
    assert.equal(typeof aiPipeline.withPipelineAuth, "function");
    const withPipelineAuth = aiPipeline.withPipelineAuth;
    const previous = process.env.AI_PIPELINE_TOKEN;
    process.env.AI_PIPELINE_TOKEN = "  pipeline-secret  ";
    try {
      const init = withPipelineAuth({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer attacker" },
      });
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer pipeline-secret");
      assert.equal(headers.get("content-type"), "application/json");
      assert.equal(init.method, "POST");
    } finally {
      if (previous === undefined) delete process.env.AI_PIPELINE_TOKEN;
      else process.env.AI_PIPELINE_TOKEN = previous;
    }
  });

  it("omits the header when the token is unset or blank", () => {
    assert.equal(typeof aiPipeline.withPipelineAuth, "function");
    const withPipelineAuth = aiPipeline.withPipelineAuth;
    const previous = process.env.AI_PIPELINE_TOKEN;
    try {
      delete process.env.AI_PIPELINE_TOKEN;
      assert.equal(new Headers(withPipelineAuth().headers).get("authorization"), null);
      process.env.AI_PIPELINE_TOKEN = "   ";
      assert.equal(new Headers(withPipelineAuth().headers).get("authorization"), null);
    } finally {
      if (previous === undefined) delete process.env.AI_PIPELINE_TOKEN;
      else process.env.AI_PIPELINE_TOKEN = previous;
    }
  });
});

describe("fetchFromAiPipeline", () => {
  it("sends the service token and does not let the caller replace it", async () => {
    const previous = process.env.AI_PIPELINE_TOKEN;
    process.env.AI_PIPELINE_TOKEN = "pipeline-secret";
    const original = globalThis.fetch;
    const seen: Array<{ url: string; authorization: string | null; contentType: string | null }> = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(input),
        authorization: headers.get("authorization"),
        contentType: headers.get("content-type"),
      });
      return new Response("{}", { status: 200 });
    };
    try {
      const response = await fetchFromAiPipeline("/job/abc/status", {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: "Bearer attacker" },
      });
      assert.equal(response?.status, 200);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].url, "http://127.0.0.1:5000/job/abc/status");
      assert.equal(seen[0].authorization, "Bearer pipeline-secret");
      assert.equal(seen[0].contentType, "application/json");
    } finally {
      globalThis.fetch = original;
      if (previous === undefined) delete process.env.AI_PIPELINE_TOKEN;
      else process.env.AI_PIPELINE_TOKEN = previous;
    }
  });
});

describe("pipeline callers send the service token", () => {
  const callers = [
    "packages/frontend/app/api/upload/questionpaper/massupload/route.ts",
    "packages/frontend/app/api/upload/questionpaper/split/route.ts",
    "packages/frontend/app/api/subjects/from-job/route.ts",
    "packages/frontend/lib/aiPipeline.ts",
  ];

  it("attaches pipeline auth from the shared helper", () => {
    for (const path of callers) {
      const source = readRepoFile(path);
      assert.match(source, /withPipelineAuth|fetchFromAiPipeline/, path);
    }
  });

  it("does not keep a hardcoded pipeline LAN address", () => {
    for (const path of callers.filter((candidate) => candidate.endsWith("route.ts"))) {
      const source = readRepoFile(path);
      assert.doesNotMatch(source, /192\.168\.1\.105/, path);
    }
  });
});

describe("job pipeline proxies reuse the ownership helper", () => {
  it("checks jobContentAccessDecision before calling the pipeline", () => {
    for (const path of [
      "packages/frontend/app/api/jobs/[jobId]/status/route.ts",
      "packages/frontend/app/api/jobs/[jobId]/questions/route.ts",
    ]) {
      const source = readRepoFile(path);
      const gate = source.indexOf("jobContentAccessDecision(");
      const call = source.indexOf("fetchFromAiPipeline(");
      assert.ok(gate >= 0, path);
      assert.ok(call > gate, path);
    }
  });
});
