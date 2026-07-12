import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorker } from "../../src/worker/index.js";
import { InMemoryTaskStore } from "../../src/worker/in-memory-store.js";
import { TaskHubService } from "../../src/worker/task-service.js";
import type { AdminHubEvent, RunnerHubPresence } from "../../src/worker/types.js";

class FakeHub {
  readonly forwarded: Request[] = [];
  readonly wakes: Array<{ runnerId: string; taskId: string }> = [];
  readonly adminEvents: AdminHubEvent[] = [];
  presence: RunnerHubPresence = { onlineRunnerIds: ["runner-a"], runnerConnections: 1, adminConnections: 0 };

  async fetch(request: Request): Promise<Response> {
    this.forwarded.push(request);
    return new Response("upgraded");
  }

  notifyTaskAvailable(runnerId: string, taskId: string): number {
    this.wakes.push({ runnerId, taskId });
    return 1;
  }

  broadcastAdminEvent(event: AdminHubEvent): number {
    this.adminEvents.push(event);
    return 1;
  }

  getPresence(): RunnerHubPresence {
    return this.presence;
  }
}

test("authenticates Runner WebSocket upgrades and overwrites internal metadata", async () => {
  const store = new InMemoryTaskStore();
  await registerRunner(store);
  const hub = new FakeHub();
  const worker = createWorker(() => store, () => hub);

  const accepted = await worker.fetch(new Request("https://task-hub.example/runners/runner-a/events", {
    headers: {
      authorization: "Bearer runner-secret",
      upgrade: "websocket",
      "x-task-hub-role": "admin",
      "x-task-hub-runner-id": "runner-b",
    },
  }), createEnv() as never);
  const rejected = await worker.fetch(new Request("https://task-hub.example/runners/runner-a/events", {
    headers: { authorization: "Bearer wrong", upgrade: "websocket" },
  }), createEnv() as never);

  assert.equal(accepted.status, 200);
  assert.equal(rejected.status, 401);
  assert.equal(hub.forwarded.length, 1);
  assert.equal(hub.forwarded[0]?.headers.get("x-task-hub-role"), "runner");
  assert.equal(hub.forwarded[0]?.headers.get("x-task-hub-runner-id"), "runner-a");
  assert.equal(hub.forwarded[0]?.headers.get("authorization"), null);
});

test("exchanges the admin bearer token for a short-lived WebSocket ticket", async () => {
  const hub = new FakeHub();
  const worker = createWorker(() => new InMemoryTaskStore(), () => hub);
  const env = createEnv();

  const ticketResponse = await worker.fetch(adminRequest("/api/admin/events-ticket", { method: "POST" }), env as never);
  assert.equal(ticketResponse.status, 200);
  const { ticket, expiresAt } = await ticketResponse.json() as { ticket: string; expiresAt: string };
  assert.ok(ticket.length > 40);
  assert.ok(Date.parse(expiresAt) > Date.now());

  const accepted = await worker.fetch(new Request("https://task-hub.example/api/admin/events", {
    headers: { upgrade: "websocket", "sec-websocket-protocol": `taskhub-admin, ${ticket}` },
  }), env as never);
  const rejected = await worker.fetch(new Request("https://task-hub.example/api/admin/events", {
    headers: { upgrade: "websocket", "sec-websocket-protocol": "taskhub-admin, invalid-ticket" },
  }), env as never);

  assert.equal(accepted.status, 200);
  assert.equal(rejected.status, 401);
  assert.equal(hub.forwarded.length, 1);
  assert.equal(hub.forwarded[0]?.headers.get("x-task-hub-role"), "admin");
  assert.equal(hub.forwarded[0]?.headers.get("x-task-hub-runner-id"), null);
  assert.equal(hub.forwarded[0]?.headers.get("sec-websocket-protocol"), "taskhub-admin");
});

test("returns Durable Object presence only to authenticated admins", async () => {
  const hub = new FakeHub();
  const worker = createWorker(() => new InMemoryTaskStore(), () => hub);

  const accepted = await worker.fetch(adminRequest("/api/admin/presence"), createEnv() as never);
  const rejected = await worker.fetch(new Request("https://task-hub.example/api/admin/presence"), createEnv() as never);

  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), hub.presence);
  assert.equal(rejected.status, 401);
});

test("wakes the target Runner only after the Queue consumer persists pending_runner", async () => {
  const store = new InMemoryTaskStore();
  const service = await registerRunner(store);
  const task = await service.submitTask({
    runnerId: "runner-a", type: "selfcheck", name: "Wake", payload: {}, timeoutSeconds: 60,
  });
  const hub = new FakeHub();
  const worker = createWorker(() => store, () => hub);
  let acked = false;

  await worker.queue({ messages: [{ body: { taskId: task.taskId }, ack: () => { acked = true; } }] } as never, createEnv() as never);

  assert.equal((await store.getTask(task.taskId))?.status, "pending_runner");
  assert.deepEqual(hub.wakes, [{ runnerId: "runner-a", taskId: task.taskId }]);
  assert.deepEqual(hub.adminEvents, [{ type: "task_changed", taskId: task.taskId, runnerId: "runner-a", status: "pending_runner" }]);
  assert.equal(acked, true);
});

test("default Durable Object adapter sends notifications through stub fetch", async () => {
  const store = new InMemoryTaskStore();
  const service = await registerRunner(store);
  const task = await service.submitTask({
    runnerId: "runner-a", type: "selfcheck", name: "Wake", payload: {}, timeoutSeconds: 60,
  });
  const requests: Request[] = [];
  const rawStub = {
    async fetch(request: Request): Promise<Response> {
      requests.push(request);
      return new Response(JSON.stringify({ delivered: 1 }), {
        headers: { "content-type": "application/json" },
      });
    },
  };
  const env = {
    ...createEnv(),
    RUNNER_HUB: {
      idFromName: (name: string) => name,
      get: () => rawStub,
    },
  };
  const worker = createWorker(() => store);

  await worker.queue({ messages: [{ body: { taskId: task.taskId }, ack: () => {} }] } as never, env as never);

  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), ["/task-available", "/admin-event"]);
  assert.deepEqual(await requests[0]?.json(), { runnerId: "runner-a", taskId: task.taskId });
});

test("broadcasts leased, running, and terminal task transitions", async () => {
  const store = new InMemoryTaskStore();
  const service = await registerRunner(store);
  const task = await service.submitTask({
    runnerId: "runner-a", type: "selfcheck", name: "Lifecycle", payload: {}, timeoutSeconds: 60,
  });
  await service.processQueuedTask(task.taskId);
  const hub = new FakeHub();
  const worker = createWorker(() => store, () => hub);
  const env = createEnv();

  const claim = await worker.fetch(runnerRequest("/runners/runner-a/claim", {}), env as never);
  const lease = await claim.json() as { leaseId: string };
  await worker.fetch(runnerRequest(`/tasks/${task.taskId}/heartbeat`, { leaseId: lease.leaseId, runnerId: "runner-a" }), env as never);
  await worker.fetch(runnerRequest(`/tasks/${task.taskId}/complete`, {
    leaseId: lease.leaseId, runnerId: "runner-a", status: "succeeded", result: { ok: true },
  }), env as never);

  assert.deepEqual(hub.adminEvents.map((event) => [event.type, "status" in event ? event.status : undefined]), [
    ["task_changed", "leased"],
    ["task_changed", "running"],
    ["task_changed", "succeeded"],
  ]);
});

async function registerRunner(store: InMemoryTaskStore): Promise<TaskHubService> {
  const service = new TaskHubService(store);
  await service.registerRunner({
    runnerId: "runner-a", credential: "runner-secret", platform: "linux", labels: [],
    taskTypes: ["selfcheck"], capabilities: [],
  });
  return service;
}

function runnerRequest(path: string, body: object): Request {
  return new Request(`https://task-hub.example${path}`, {
    method: "POST",
    headers: { authorization: "Bearer runner-secret", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer admin-secret");
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
