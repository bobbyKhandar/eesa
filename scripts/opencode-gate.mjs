import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];
export const WRITE_PERMISSIONS = ["admin", "maintain", "write"];

const COMMENT_EVENTS = new Set(["issue_comment", "pull_request_review_comment"]);

export function commentInvokesOpencode(body) {
  if (typeof body !== "string" || body.length === 0) return false;
  return body.includes("/oc") || body.includes("/opencode");
}

export function opencodeRunAllowed({ eventName, commentBody, authorAssociation, permission }) {
  if (eventName === "workflow_dispatch") return true;
  if (!COMMENT_EVENTS.has(eventName)) return false;
  if (!commentInvokesOpencode(commentBody)) return false;
  if (!TRUSTED_ASSOCIATIONS.includes(authorAssociation)) return false;
  if (!WRITE_PERMISSIONS.includes(permission)) return false;
  return true;
}

export async function resolveCollaboratorPermission({
  token,
  repository,
  username,
  fetchImpl = fetch,
}) {
  if (!token || !repository || !username) {
    throw new Error("Collaborator permission lookup is not configured");
  }
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error("Collaborator permission lookup repository is invalid");
  }
  const [owner, repo] = parts;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}/permission`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "eesa-opencode-gate",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
  });
  if (response.status === 404) return "none";
  if (!response.ok) {
    throw new Error(`GitHub permission lookup failed (${response.status})`);
  }
  const data = await response.json();
  return typeof data.permission === "string" ? data.permission : "none";
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}

function writeAllowed(value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `allowed=${value}\n`);
}

async function main() {
  const event = readEvent();
  const comment = event?.comment ?? {};
  const eventName = process.env.EVENT_NAME || process.env.GITHUB_EVENT_NAME || "";
  const commentBody = process.env.COMMENT_BODY ?? comment.body ?? "";
  const authorAssociation = process.env.AUTHOR_ASSOCIATION ?? comment.author_association ?? "";
  const commenter = process.env.COMMENTER ?? comment.user?.login ?? "";
  const repository = process.env.REPOSITORY || process.env.GITHUB_REPOSITORY || "";
  let permission = process.env.PERMISSION ?? "";

  try {
    if (COMMENT_EVENTS.has(eventName) && permission.length === 0) {
      permission = await resolveCollaboratorPermission({
        token: process.env.GITHUB_TOKEN,
        repository,
        username: commenter,
      });
    }
  } catch (error) {
    writeAllowed("false");
    const message = error instanceof Error ? error.message : "Collaborator permission lookup failed";
    console.error(message);
    process.exit(1);
  }

  const allowed = opencodeRunAllowed({
    eventName,
    commentBody,
    authorAssociation,
    permission,
  });
  writeAllowed(allowed ? "true" : "false");
  if (!allowed) {
    console.log(`OpenCode invocation denied for event ${eventName || "unknown"}.`);
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isDirectRun()) {
  main().catch((error) => {
    writeAllowed("false");
    const message = error instanceof Error ? error.message : "OpenCode authorization failed";
    console.error(message);
    process.exit(1);
  });
}
