/**
 * The landing footer used to advertise /terms, /privacy, and /contact.
 * Those routes do not exist, and the product has no contact destination
 * or owner-written legal copy to point at. The footer must not publish
 * those dead links.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const landing = readFileSync(join(root, "packages/frontend/app/page.tsx"), "utf8");

const DEAD_HREFS = ["/terms", "/privacy", "/contact"] as const;

describe("landing page footer", () => {
  it("does not link to missing terms, privacy, or contact routes", () => {
    for (const href of DEAD_HREFS) {
      assert.equal(
        landing.includes(`href="${href}"`) || landing.includes(`href='${href}'`),
        false,
        `landing page still links to missing route ${href}`,
      );
    }
  });
});
