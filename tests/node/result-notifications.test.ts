import assert from "node:assert/strict"
import { test } from "node:test"
import { resultNotifications, notificationStorageKey, parseReadNotifications } from "../../packages/frontend/lib/resultNotifications.ts"

test("notifications derive from actual result rows with usable links and newest-first ordering", () => {
  const items = resultNotifications([{ id: "old", examName: "Old exam", date: "2025-01-01", score: 0, totalMarks: 20 }, { id: "new/id", examName: "My new exam", date: "2026-01-01", score: 10, totalMarks: 20 }, {}, null])
  assert.equal(items.length, 2)
  assert.equal(items[0].href, "/results/new%2Fid")
  assert.equal(items[1].key, "old:0:20")
  assert.equal(resultNotifications(null).length, 0)
  const updated = resultNotifications([{ id: "old", examName: "Old exam", score: 5, totalMarks: 20 }])
  assert.notEqual(updated[0].key, items[1].key, "a changed grade becomes unread again")
})
test("read status tolerates corrupt storage and is isolated per signed-in account", () => {
  assert.deepEqual(parseReadNotifications("not json"), [])
  assert.deepEqual(parseReadNotifications('{"fake":true}'), [])
  assert.deepEqual(parseReadNotifications('["result:0:20",null,4]'), ["result:0:20"])
  assert.notEqual(notificationStorageKey("user-a"), notificationStorageKey("user-b"))
})
