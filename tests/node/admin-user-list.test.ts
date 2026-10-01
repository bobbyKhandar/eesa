import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterAdminUsers,
  isAccountStatus,
  toAdminUserRow,
} from "../../packages/frontend/lib/adminUserList.ts";

describe("toAdminUserRow", () => {
  it("keeps the fields the admin table renders", () => {
    assert.deepEqual(
      toAdminUserRow({
        _id: "u1",
        email: "ada@school.edu",
        name: "Ada",
        role: "student",
        status: "suspended",
        branch: "CS",
      }),
      {
        id: "u1",
        name: "Ada",
        email: "ada@school.edu",
        role: "student",
        status: "suspended",
        branch: "CS",
      },
    );
  });

  it("treats a missing status as active and falls back to the email for the name", () => {
    const row = toAdminUserRow({ _id: "u2", email: "no-name@school.edu" });
    assert.equal(row?.name, "no-name@school.edu");
    assert.equal(row?.status, "active");
    assert.equal(row?.role, "student");
  });

  it("drops a record with no email", () => {
    assert.equal(toAdminUserRow({ _id: "u3", name: "No email" }), null);
  });
});

describe("filterAdminUsers", () => {
  const users = [
    toAdminUserRow({ _id: "1", email: "a@school.edu", name: "Ada", role: "student", status: "active" })!,
    toAdminUserRow({ _id: "2", email: "b@school.edu", name: "Bea", role: "admin", status: "suspended" })!,
  ];

  it("filters by role, status and search together", () => {
    assert.deepEqual(
      filterAdminUsers(users, { search: "bea", role: "admin", status: "suspended" }).map((user) => user.id),
      ["2"],
    );
  });
});

describe("isAccountStatus", () => {
  it("accepts only the three stored statuses", () => {
    assert.equal(isAccountStatus("active"), true);
    assert.equal(isAccountStatus("inactive"), true);
    assert.equal(isAccountStatus("suspended"), true);
    assert.equal(isAccountStatus("faculty"), false);
    assert.equal(isAccountStatus("admin"), false);
  });
});
