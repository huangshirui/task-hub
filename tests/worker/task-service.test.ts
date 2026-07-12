import assert from "node:assert/strict";
import { test } from "node:test";

import { InMemoryTaskStore } from "../../src/worker/in-memory-store.js";
import { TaskHubService } from "../../src/worker/task-service.js";

test("submit requires a runnerId and queues the task", async () => {
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store);

  await assert.rejects(
    service.submitTask({
      type: "shell",
      name: "missing runner",
      payload: { scriptId: "backup" },
      timeoutSeconds: 30,
    }),
    /runnerId is required/,
  );

  await service.registerRunner({
    runnerId: "runner-linux",
    credential: "secret",
    platform: "linux",
    labels: ["prod"],
    taskTypes: ["shell"],
    capabilities: ["shell.registered_scripts"],
  });

  const submitted = await service.submitTask({
    runnerId: "runner-linux",
    type: "shell",
    name: "backup",
    payload: { scriptId: "backup" },
    timeoutSeconds: 30,
  });

  assert.equal(submitted.status, "queued");
  assert.equal(store.enqueuedTaskIds.length, 1);
});

test("queue consumer keeps offline runner work pending for the specified runner", async () => {
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store);

  await service.registerRunner({
    runnerId: "runner-linux",
    credential: "secret",
    platform: "linux",
    labels: ["prod"],
    taskTypes: ["shell"],
    capabilities: ["shell.registered_scripts"],
  });

  const submitted = await service.submitTask({
    runnerId: "runner-linux",
    type: "shell",
    name: "backup",
    payload: { scriptId: "backup" },
    timeoutSeconds: 30,
  });

  const processed = await service.processQueuedTask(submitted.taskId);

  assert.equal(processed.status, "pending_runner");
  assert.equal(processed.runnerId, "runner-linux");
});

test("runner registration supports selfcheck task type", async () => {
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store);

  await service.registerRunner({
    runnerId: "runner-selfcheck",
    credential: "secret",
    platform: "linux",
    labels: ["ubuntu-server"],
    taskTypes: ["selfcheck"],
    capabilities: ["runner.selfcheck"],
  });

  const submitted = await service.submitTask({
    runnerId: "runner-selfcheck",
    type: "selfcheck",
    name: "selfcheck",
    payload: {},
    timeoutSeconds: 30,
  });
  const processed = await service.processQueuedTask(submitted.taskId);

  assert.equal(processed.status, "pending_runner");
});

test("runner re-registration updates task types and capabilities", async () => {
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store);

  await service.registerRunner({
    runnerId: "runner-update",
    credential: "secret",
    platform: "linux",
    labels: ["ubuntu-server"],
    taskTypes: ["selfcheck"],
    capabilities: ["runner.selfcheck"],
  });
  await service.registerRunner({
    runnerId: "runner-update",
    credential: "secret",
    platform: "linux",
    labels: ["ubuntu-server"],
    taskTypes: ["selfcheck", "shell"],
    capabilities: ["runner.selfcheck", "shell.registered_scripts"],
  });

  assert.deepEqual(store.runners.get("runner-update")?.taskTypes, ["selfcheck", "shell"]);
  assert.deepEqual(store.runners.get("runner-update")?.capabilities, ["runner.selfcheck", "shell.registered_scripts"]);
});

test("runner can only claim tasks explicitly assigned to itself", async () => {
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store, { now: () => new Date("2026-06-11T00:00:00.000Z") });

  await service.registerRunner({
    runnerId: "runner-a",
    credential: "secret-a",
    platform: "linux",
    labels: [],
    taskTypes: ["shell"],
    capabilities: ["shell.registered_scripts"],
  });
  await service.registerRunner({
    runnerId: "runner-b",
    credential: "secret-b",
    platform: "linux",
    labels: [],
    taskTypes: ["shell"],
    capabilities: ["shell.registered_scripts"],
  });

  const submitted = await service.submitTask({
    runnerId: "runner-a",
    type: "shell",
    name: "assigned",
    payload: { scriptId: "backup" },
    timeoutSeconds: 30,
  });
  await service.processQueuedTask(submitted.taskId);

  const wrongRunnerClaim = await service.claimTask("runner-b", "secret-b");
  assert.equal(wrongRunnerClaim, null);

  const claim = await service.claimTask("runner-a", "secret-a");
  assert.ok(claim);
  assert.equal(claim.taskId, submitted.taskId);
  assert.equal(claim.type, "shell");
  assert.equal(claim.leaseExpiresAt, "2026-06-11T00:01:30.000Z");
});

test("complete uploads result metadata and records a signed webhook delivery", async () => {
  const store = new InMemoryTaskStore();
  const service = new TaskHubService(store, { now: () => new Date("2026-06-11T00:00:00.000Z") });

  await service.registerRunner({
    runnerId: "runner-a",
    credential: "secret-a",
    platform: "linux",
    labels: [],
    taskTypes: ["shell"],
    capabilities: ["shell.registered_scripts"],
  });

  const submitted = await service.submitTask({
    runnerId: "runner-a",
    type: "shell",
    name: "assigned",
    payload: { scriptId: "backup" },
    timeoutSeconds: 30,
    callbackUrl: "https://example.com/task-callback",
  });
  await service.processQueuedTask(submitted.taskId);
  const claim = await service.claimTask("runner-a", "secret-a");
  assert.ok(claim);

  await service.appendLogs(submitted.taskId, claim.leaseId, "runner-a", "secret-a", [
    { stream: "stdout", message: "started", timestamp: "2026-06-11T00:00:01.000Z" },
  ]);
  const completed = await service.completeTask(submitted.taskId, claim.leaseId, "runner-a", "secret-a", {
    status: "succeeded",
    exitCode: 0,
    result: { artifactKey: "artifacts/result.json" },
  });

  assert.equal(completed.status, "succeeded");
  assert.equal(store.logBatches.length, 1);
  assert.equal(store.webhookDeliveries.length, 1);
  assert.equal(store.webhookDeliveries[0]?.eventType, "task.succeeded");
  assert.equal(store.webhookDeliveries[0]?.payload.runnerId, "runner-a");
});
