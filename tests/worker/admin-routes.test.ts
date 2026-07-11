import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorker } from "../../src/worker/index.js";
import { InMemoryTaskStore } from "../../src/worker/in-memory-store.js";
import { TaskHubService } from "../../src/worker/task-service.js";

test("admin endpoints require the independent admin token", async () => {
  const store = new InMemoryTaskStore();
  const worker = createWorker(() => store);
  const env = createEnv();

  const missing = await worker.fetch(new Request("https://task-hub.example/api/admin/runners"), env as never);
  const wrong = await worker.fetch(
    new Request("https://task-hub.example/api/admin/runners", {
      headers: { authorization: "Bearer wrong-secret" },
    }),
    env as never,
  );

  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(await missing.json(), { error: "unauthorized" });
  assert.deepEqual(await wrong.json(), { error: "unauthorized" });
});

test("admin API lists runners and submits and filters tasks", async () => {
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store, { now: () => new Date("2026-07-11T00:00:00.000Z") });
  await service.registerRunner({
    runnerId: "runner-a",
    name: "Build host",
    credential: "runner-secret",
    platform: "linux",
    labels: ["build"],
    taskTypes: ["selfcheck"],
    capabilities: ["runner.selfcheck"],
  });
  const worker = createWorker(() => store);
  const env = createEnv();

  const runners = await worker.fetch(adminRequest("/api/admin/runners?status=offline"), env as never);
  assert.equal(runners.status, 200);
  const runnerPage = (await runners.json()) as { items: Array<{ runnerId: string; name: string }> };
  assert.deepEqual(runnerPage.items.map((runner) => runner.runnerId), ["runner-a"]);
  assert.equal(runnerPage.items[0]?.name, "Build host");

  const submitted = await worker.fetch(
    adminRequest("/api/admin/tasks", {
      method: "POST",
      body: JSON.stringify({
        runnerId: "runner-a",
        type: "selfcheck",
        name: "Console self-check",
        payload: {},
        timeoutSeconds: 60,
      }),
    }),
    env as never,
  );
  assert.equal(submitted.status, 202);

  const tasks = await worker.fetch(adminRequest("/api/admin/tasks?runnerId=runner-a&status=queued"), env as never);
  assert.equal(tasks.status, 200);
  const taskPage = (await tasks.json()) as { items: Array<{ runnerId: string; status: string }> };
  assert.deepEqual(taskPage.items.map((task) => [task.runnerId, task.status]), [["runner-a", "queued"]]);
});

test("admin API validates filters and returns not found for missing resources", async () => {
  const worker = createWorker(() => new InMemoryTaskStore());
  const env = createEnv();

  const invalid = await worker.fetch(adminRequest("/api/admin/tasks?status=unknown"), env as never);
  const runner = await worker.fetch(adminRequest("/api/admin/runners/missing"), env as never);
  const task = await worker.fetch(adminRequest("/api/admin/tasks/missing"), env as never);
  const logs = await worker.fetch(adminRequest("/api/admin/tasks/missing/logs"), env as never);

  assert.equal(invalid.status, 400);
  assert.equal(runner.status, 404);
  assert.equal(task.status, 404);
  assert.equal(logs.status, 404);
});

test("admin task submission validates the runtime body", async () => {
  const worker = createWorker(() => new InMemoryTaskStore());
  const response = await worker.fetch(
    adminRequest("/api/admin/tasks", {
      method: "POST",
      body: JSON.stringify({
        runnerId: "runner-a",
        type: "not-a-task-type",
        name: "Invalid task",
        payload: [],
        timeoutSeconds: "60",
      }),
    }),
    createEnv() as never,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid task type" });
});

test("admin API sanitizes unexpected infrastructure failures", async () => {
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store);
  const task = await service.submitTask({
    runnerId: "runner-a",
    type: "selfcheck",
    name: "Health check",
    payload: {},
    timeoutSeconds: 60,
  });
  store.getTaskLogs = async () => {
    throw new Error("R2 unavailable: internal bucket detail");
  };
  const worker = createWorker(() => store);

  const response = await worker.fetch(adminRequest(`/api/admin/tasks/${task.taskId}/logs`), createEnv() as never);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "internal server error" });
});

test("storage JSON corruption is an internal error, not an invalid request body", async () => {
  const store = new InMemoryTaskStore();
  store.listRunnerViews = async () => {
    throw new SyntaxError("Unexpected token in labels_json");
  };
  const worker = createWorker(() => store);

  const response = await worker.fetch(adminRequest("/api/admin/runners"), createEnv() as never);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "internal server error" });
});

test("task cursors reject non-canonical timestamps", async () => {
  const worker = createWorker(() => new InMemoryTaskStore());
  const cursor = btoa(JSON.stringify({ createdAt: "not-a-date", taskId: "task-a" }));

  const response = await worker.fetch(adminRequest(`/api/admin/tasks?cursor=${encodeURIComponent(cursor)}`), createEnv() as never);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid cursor" });
});

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer admin-secret");
  if (init.body) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://task-hub.example${path}`, { ...init, headers });
}

function createEnv() {
  return {
    TASK_HUB_ADMIN_TOKEN: "admin-secret",
    TASK_SUBMISSIONS: { send: async () => undefined },
    TASK_OBJECTS: { put: async () => undefined },
    TASK_DB: {},
  };
}
