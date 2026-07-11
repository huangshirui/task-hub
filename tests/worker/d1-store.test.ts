import assert from "node:assert/strict";
import { test } from "node:test";

import { D1TaskStore } from "../../src/worker/d1-store.js";

test("D1 task listing binds every management filter", async () => {
  let sql = "";
  let bindings: unknown[] = [];
  const db = {
    prepare(statement: string) {
      sql = statement;
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return {
            async all() {
              return { results: [taskRow()] };
            },
          };
        },
      };
    },
  };
  const store = new D1TaskStore(db as never);

  const tasks = await store.listTasks({ runnerId: "runner-a", status: "running", type: "selfcheck", limit: 20 });

  assert.match(sql, /runner_id = \?/);
  assert.match(sql, /status = \?/);
  assert.match(sql, /type = \?/);
  assert.deepEqual(bindings, ["runner-a", "running", "selfcheck", 21]);
  assert.equal(tasks.items[0]?.taskId, "task-a");
  assert.match(sql, /LIMIT \?/);
});

test("D1 runner listing uses a bounded safe projection", async () => {
  let sql = "";
  let bindings: unknown[] = [];
  const db = {
    prepare(statement: string) {
      sql = statement;
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return { async all() { return { results: [] }; } };
        },
      };
    },
  };
  const store = new D1TaskStore(db as never);

  await store.listRunnerViews({ status: "online", limit: 10, now: new Date("2026-07-11T00:00:30.000Z") });

  assert.doesNotMatch(sql, /credential_hash/);
  assert.match(sql, /LIMIT \?/);
  assert.match(sql, /current_task_id/);
  assert.equal(bindings.at(-1), 11);
});

test("D1 admin runner detail never selects the credential hash", async () => {
  let sql = "";
  const db = {
    prepare(statement: string) {
      sql = statement;
      return {
        bind() {
          return { async first() { return undefined; } };
        },
      };
    },
  };
  const store = new D1TaskStore(db as never);

  await store.getRunnerView("runner-a", new Date("2026-07-11T00:00:30.000Z"));

  assert.doesNotMatch(sql, /credential_hash/);
  assert.match(sql, /current_task_id/);
  assert.match(sql, /r\.runner_id = \?/);
});

test("R2 task logs are flattened chronologically and malformed objects are counted", async () => {
  const bodies = new Map([
    ["tasks/task-a/logs/002.json", JSON.stringify([{ stream: "stdout", message: "second", timestamp: "2026-07-11T00:00:02.000Z" }])],
    ["tasks/task-a/logs/001.json", JSON.stringify([{ stream: "system", message: "first", timestamp: "2026-07-11T00:00:01.000Z" }])],
    ["tasks/task-a/logs/003.json", "not-json"],
  ]);
  const objects = {
    async put() {},
    async list() {
      return { objects: [...bodies.keys()].map((key) => ({ key })), truncated: false };
    },
    async get(key: string) {
      const body = bodies.get(key);
      return body === undefined ? null : { async text() { return body; } };
    },
  };
  const store = new D1TaskStore({} as never, undefined, objects);

  const logs = await store.getTaskLogs("task-a");

  assert.deepEqual(logs.entries.map((entry) => entry.message), ["first", "second"]);
  assert.equal(logs.invalidObjects, 1);
});

function taskRow(): Record<string, unknown> {
  return {
    task_id: "task-a",
    runner_id: "runner-a",
    type: "selfcheck",
    name: "Health check",
    payload_json: "{}",
    status: "running",
    timeout_seconds: 60,
    priority: 0,
    callback_url: null,
    idempotency_key: null,
    lease_id: "lease-a",
    lease_expires_at: "2026-07-11T00:01:00.000Z",
    result_json: null,
    exit_code: null,
    error: null,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:01.000Z",
  };
}
