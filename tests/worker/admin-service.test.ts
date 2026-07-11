import assert from "node:assert/strict";
import { test } from "node:test";

import { constantTimeStringEqual, hashRunnerCredential, verifyRunnerCredential } from "../../src/worker/security.js";
import { InMemoryTaskStore } from "../../src/worker/in-memory-store.js";
import { TaskHubService } from "../../src/worker/task-service.js";

test("runner credentials are hashed and verified", async () => {
  const hash = await hashRunnerCredential("runner-secret");

  assert.notEqual(hash, "runner-secret");
  assert.equal(hash.length, 64);
  assert.equal(await verifyRunnerCredential("runner-secret", hash), true);
  assert.equal(await verifyRunnerCredential("wrong-secret", hash), false);
  assert.equal(constantTimeStringEqual("admin-secret", "admin-secret"), true);
  assert.equal(constantTimeStringEqual("admin-secret", "wrong"), false);
});

test("runner registration generates an id and display name when omitted", async () => {
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store, {
    now: () => new Date("2026-07-11T00:00:00.000Z"),
    randomUUID: () => "7db26f65-2ab1-4b60-9967-a9a1ca9e1844",
  });

  const runner = await service.registerRunner({
    credential: "runner-secret",
    platform: "windows",
    labels: ["windows-user"],
    taskTypes: ["selfcheck"],
    capabilities: ["runner.selfcheck"],
  });

  assert.equal(runner.runnerId, "runner_7db26f65-2ab1-4b60-9967-a9a1ca9e1844");
  assert.equal(runner.name, runner.runnerId);
  assert.notEqual(store.runners.get(runner.runnerId)?.credentialHash, "runner-secret");
});

test("runner re-registration preserves the existing display name when omitted", async () => {
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store);
  await service.registerRunner({
    runnerId: "runner-a",
    name: "Build workstation",
    credential: "secret-a",
    platform: "windows",
    labels: [],
    taskTypes: ["selfcheck"],
    capabilities: ["runner.selfcheck"],
  });

  const updated = await service.registerRunner({
    runnerId: "runner-a",
    credential: "secret-a",
    platform: "windows",
    labels: [],
    taskTypes: ["selfcheck", "shell"],
    capabilities: ["runner.selfcheck", "shell.registered_scripts"],
  });

  assert.equal(updated.name, "Build workstation");
});

test("authenticated claim refreshes heartbeat and derives online status boundaries", async () => {
  let now = new Date("2026-07-11T00:00:00.000Z");
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store, { now: () => now });

  await service.registerRunner({
    runnerId: "runner-online",
    name: "Online runner",
    credential: "online-secret",
    platform: "linux",
    labels: [],
    taskTypes: ["selfcheck"],
    capabilities: ["runner.selfcheck"],
  });
  await service.registerRunner({
    runnerId: "runner-offline",
    credential: "offline-secret",
    platform: "windows",
    labels: [],
    taskTypes: ["selfcheck"],
    capabilities: ["runner.selfcheck"],
  });

  await service.claimTask("runner-online", "online-secret");
  now = new Date("2026-07-11T00:00:15.000Z");
  let page = await service.listRunners({ limit: 10 });
  assert.equal(page.items.find((runner) => runner.runnerId === "runner-online")?.status, "online");
  assert.equal(page.items.find((runner) => runner.runnerId === "runner-offline")?.status, "offline");

  now = new Date("2026-07-11T00:01:00.000Z");
  page = await service.listRunners({ limit: 10 });
  assert.equal(page.items.find((runner) => runner.runnerId === "runner-online")?.status, "stale");

  now = new Date("2026-07-11T00:01:00.001Z");
  page = await service.listRunners({ limit: 10 });
  assert.equal(page.items.find((runner) => runner.runnerId === "runner-online")?.status, "offline");
});

test("runner list filters status and paginates deterministically", async () => {
  const now = new Date("2026-07-11T00:00:10.000Z");
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store, { now: () => now });

  for (const runnerId of ["runner-a", "runner-b", "runner-c"]) {
    await service.registerRunner({
      runnerId,
      credential: `${runnerId}-secret`,
      platform: "linux",
      labels: [],
      taskTypes: ["selfcheck"],
      capabilities: ["runner.selfcheck"],
    });
    await service.claimTask(runnerId, `${runnerId}-secret`);
  }

  const first = await service.listRunners({ status: "online", limit: 2 });
  await service.registerRunner({
    runnerId: "runner-0",
    credential: "runner-0-secret",
    platform: "linux",
    labels: [],
    taskTypes: ["selfcheck"],
    capabilities: ["runner.selfcheck"],
  });
  await service.claimTask("runner-0", "runner-0-secret");
  const second = await service.listRunners({ status: "online", limit: 2, cursor: first.nextCursor });

  assert.deepEqual(first.items.map((runner) => runner.runnerId), ["runner-a", "runner-b"]);
  assert.deepEqual(second.items.map((runner) => runner.runnerId), ["runner-c"]);
  assert.ok(first.nextCursor);
  assert.equal(second.nextCursor, undefined);
});

test("task pagination remains stable when newer tasks arrive", async () => {
  let now = new Date("2026-07-11T00:00:00.000Z");
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store, {
    now: () => now,
    randomUUID: (() => {
      const ids = ["1", "2", "3", "4"];
      return () => ids.shift() as string;
    })(),
  });

  for (const index of [1, 2, 3]) {
    now = new Date(`2026-07-11T00:00:0${index}.000Z`);
    await service.submitTask({ runnerId: "runner-a", type: "selfcheck", name: `Task ${index}`, payload: {}, timeoutSeconds: 30 });
  }
  const first = await service.listTasks({ limit: 2 });
  now = new Date("2026-07-11T00:00:04.000Z");
  await service.submitTask({ runnerId: "runner-a", type: "selfcheck", name: "Task 4", payload: {}, timeoutSeconds: 30 });
  const second = await service.listTasks({ limit: 2, cursor: first.nextCursor });

  assert.deepEqual(first.items.map((task) => task.name), ["Task 3", "Task 2"]);
  assert.deepEqual(second.items.map((task) => task.name), ["Task 1"]);
});

test("task list filters by runner and status and exposes uploaded logs", async () => {
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store, { now: () => new Date("2026-07-11T00:00:00.000Z") });
  await service.registerRunner({
    runnerId: "runner-a",
    credential: "secret-a",
    platform: "linux",
    labels: [],
    taskTypes: ["selfcheck"],
    capabilities: ["runner.selfcheck"],
  });
  const task = await service.submitTask({
    runnerId: "runner-a",
    type: "selfcheck",
    name: "Health check",
    payload: {},
    timeoutSeconds: 30,
  });
  await service.processQueuedTask(task.taskId);
  const claim = await service.claimTask("runner-a", "secret-a");
  assert.ok(claim);
  await service.appendLogs(task.taskId, claim.leaseId, "runner-a", "secret-a", [
    { stream: "system", message: "selfcheck started", timestamp: "2026-07-11T00:00:01.000Z" },
  ]);

  const tasks = await service.listTasks({ runnerId: "runner-a", status: "leased", limit: 10 });
  const logs = await service.getTaskLogs(task.taskId);

  assert.deepEqual(tasks.items.map((item) => item.taskId), [task.taskId]);
  assert.deepEqual(logs?.entries.map((entry) => entry.message), ["selfcheck started"]);
  assert.equal(logs?.invalidObjects, 0);
});
