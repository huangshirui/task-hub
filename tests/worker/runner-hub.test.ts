import assert from "node:assert/strict";
import { test } from "node:test";

import { RunnerHub } from "../../src/worker/runner-hub.js";
import type { AdminHubEvent } from "../../src/worker/types.js";

class FakeWebSocket {
  attachment: unknown;
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];

  serializeAttachment(attachment: unknown): void {
    this.attachment = structuredClone(attachment);
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }
}

class FakeDurableObjectState {
  readonly accepted: Array<{ socket: FakeWebSocket; tags: string[] }> = [];

  acceptWebSocket(socket: WebSocket, tags: string[] = []): void {
    this.accepted.push({ socket: socket as unknown as FakeWebSocket, tags: [...tags] });
  }

  getWebSockets(tag?: string): WebSocket[] {
    return this.accepted
      .filter((entry) => !tag || entry.tags.includes(tag))
      .map((entry) => entry.socket as unknown as WebSocket);
  }
}

type WebSocketPairFactory = () => { 0: WebSocket; 1: WebSocket };

function createHub(webSocketPairFactory?: WebSocketPairFactory): { state: FakeDurableObjectState; hub: RunnerHub } {
  const state = new FakeDurableObjectState();
  return {
    state,
    hub: new RunnerHub(state as unknown as DurableObjectState, undefined, webSocketPairFactory),
  };
}

function createWebSocketPairFactory(): {
  factory: WebSocketPairFactory;
  pairs: Array<{ 0: FakeWebSocket; 1: FakeWebSocket }>;
} {
  const pairs: Array<{ 0: FakeWebSocket; 1: FakeWebSocket }> = [];
  return {
    pairs,
    factory: () => {
      const pair = { 0: new FakeWebSocket(), 1: new FakeWebSocket() };
      pairs.push(pair);
      return pair as unknown as { 0: WebSocket; 1: WebSocket };
    },
  };
}

function withUpgradeResponse<T>(run: () => T): T {
  const responseDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Response");
  class FakeUpgradeResponse {
    readonly status: number;
    readonly headers: Headers;
    readonly webSocket?: WebSocket;

    constructor(_body: BodyInit | null, init: ResponseInit & { webSocket?: WebSocket } = {}) {
      this.status = init.status ?? 200;
      this.headers = new Headers(init.headers);
      this.webSocket = init.webSocket;
    }
  }
  Object.defineProperty(globalThis, "Response", {
    configurable: true,
    writable: true,
    value: FakeUpgradeResponse,
  });
  try {
    return run();
  } finally {
    if (responseDescriptor) {
      Object.defineProperty(globalThis, "Response", responseDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "Response");
    }
  }
}

test("serializes minimal Runner and admin attachment metadata", () => {
  const { state, hub } = createHub();
  const runner = new FakeWebSocket();
  const admin = new FakeWebSocket();

  hub.acceptRunner(runner as unknown as WebSocket, "runner-a");
  hub.acceptAdmin(admin as unknown as WebSocket);

  assert.deepEqual(runner.attachment, { role: "runner", runnerId: "runner-a" });
  assert.deepEqual(admin.attachment, { role: "admin" });
  assert.deepEqual(state.accepted[0]?.tags, ["runner", "runner:runner-a"]);
  assert.deepEqual(state.accepted[1]?.tags, ["admin"]);
  assert.doesNotMatch(JSON.stringify([runner.attachment, admin.attachment]), /credential|secret|payload/i);
});

test("replaces an existing connection for the same Runner", () => {
  const { hub } = createHub();
  const first = new FakeWebSocket();
  const replacement = new FakeWebSocket();

  hub.acceptRunner(first as unknown as WebSocket, "runner-a");
  hub.acceptRunner(replacement as unknown as WebSocket, "runner-a");
  const delivered = hub.notifyTaskAvailable("runner-a", "task-after-replace");

  assert.equal(first.attachment, null);
  assert.deepEqual(first.closeCalls, [{ code: 1000, reason: "replaced" }]);
  assert.deepEqual(first.sent, []);
  assert.deepEqual(replacement.closeCalls, []);
  assert.deepEqual(replacement.sent.map((message) => JSON.parse(message)), [
    { type: "task_available", taskId: "task-after-replace" },
  ]);
  assert.equal(delivered, 1);
  assert.deepEqual(hub.getPresence(), {
    onlineRunnerIds: ["runner-a"],
    runnerConnections: 1,
    adminConnections: 0,
  });
});

test("delivers task_available only to the targeted Runner", () => {
  const { hub } = createHub();
  const runnerA = new FakeWebSocket();
  const runnerB = new FakeWebSocket();
  const admin = new FakeWebSocket();
  hub.acceptRunner(runnerA as unknown as WebSocket, "runner-a");
  hub.acceptRunner(runnerB as unknown as WebSocket, "runner-b");
  hub.acceptAdmin(admin as unknown as WebSocket);

  const delivered = hub.notifyTaskAvailable("runner-b", "task-123");

  assert.equal(delivered, 1);
  assert.deepEqual(runnerA.sent, []);
  assert.deepEqual(admin.sent, []);
  assert.deepEqual(runnerB.sent.map((message) => JSON.parse(message)), [{ type: "task_available", taskId: "task-123" }]);
});

test("broadcasts admin events without sending them to Runners", () => {
  const { hub } = createHub();
  const runner = new FakeWebSocket();
  const firstAdmin = new FakeWebSocket();
  const secondAdmin = new FakeWebSocket();
  hub.acceptRunner(runner as unknown as WebSocket, "runner-a");
  hub.acceptAdmin(firstAdmin as unknown as WebSocket);
  hub.acceptAdmin(secondAdmin as unknown as WebSocket);

  const delivered = hub.broadcastAdminEvent({
    type: "task_changed",
    taskId: "task-123",
    runnerId: "runner-a",
    status: "running",
  });

  assert.equal(delivered, 2);
  assert.deepEqual(runner.sent, []);
  assert.deepEqual(firstAdmin.sent.map((message) => JSON.parse(message)), [
    { type: "task_changed", taskId: "task-123", runnerId: "runner-a", status: "running" },
  ]);
  assert.deepEqual(secondAdmin.sent, firstAdmin.sent);
});

test("projects admin events to strict safe wire objects", () => {
  const { hub } = createHub();
  const admin = new FakeWebSocket();
  hub.acceptAdmin(admin as unknown as WebSocket);
  const taskEvent = {
    type: "task_changed",
    taskId: "task-123",
    runnerId: "runner-a",
    status: "pending_runner",
    credential: "runner-secret",
    payload: { command: "sensitive" },
  } as unknown as AdminHubEvent;
  const presenceEvent = {
    type: "runner_presence_changed",
    runnerId: "runner-a",
    online: true,
    credential: "runner-secret",
    payload: { token: "sensitive" },
  } as unknown as AdminHubEvent;

  hub.broadcastAdminEvent(taskEvent);
  hub.broadcastAdminEvent(presenceEvent);

  assert.deepEqual(admin.sent.map((message) => JSON.parse(message)), [
    { type: "task_changed", taskId: "task-123", runnerId: "runner-a", status: "pending_runner" },
    { type: "runner_presence_changed", runnerId: "runner-a", online: true },
  ]);
  assert.doesNotMatch(admin.sent.join(""), /credential|secret|payload|sensitive/i);
});

test("broadcasts Runner presence when connections open and close", () => {
  const { hub } = createHub();
  const admin = new FakeWebSocket();
  const runner = new FakeWebSocket();
  hub.acceptAdmin(admin as unknown as WebSocket);

  hub.acceptRunner(runner as unknown as WebSocket, "runner-a");
  hub.webSocketClose(runner as unknown as WebSocket);

  assert.deepEqual(admin.sent.map((message) => JSON.parse(message)), [
    { type: "runner_presence_changed", runnerId: "runner-a", online: true },
    { type: "runner_presence_changed", runnerId: "runner-a", online: false },
  ]);
  assert.equal(runner.attachment, null);
});

test("fetch upgrades trusted internal Runner and admin connection requests", async () => {
  const pairFactory = createWebSocketPairFactory();
  const { state, hub } = createHub(pairFactory.factory);

  const responsePromises = withUpgradeResponse(() => [
    hub.fetch(
      new Request("https://runner-hub.internal/connect", {
        headers: {
          upgrade: "websocket",
          "x-task-hub-role": "runner",
          "x-task-hub-runner-id": "runner-a",
        },
      }),
    ),
    hub.fetch(
      new Request("https://runner-hub.internal/connect", {
        headers: { upgrade: "websocket", "x-task-hub-role": "admin" },
      }),
    ),
  ]);
  const responses = await Promise.all(responsePromises);

  assert.equal(responses[0]?.status, 101);
  assert.equal(responses[1]?.status, 101);
  assert.equal(responses[0]?.headers.get("sec-websocket-protocol"), null);
  assert.equal(responses[1]?.headers.get("sec-websocket-protocol"), "taskhub-admin");
  assert.equal((responses[0] as Response & { webSocket?: WebSocket }).webSocket, pairFactory.pairs[0]?.[0]);
  assert.equal((responses[1] as Response & { webSocket?: WebSocket }).webSocket, pairFactory.pairs[1]?.[0]);
  assert.equal(state.accepted[0]?.socket, pairFactory.pairs[0]?.[1]);
  assert.equal(state.accepted[1]?.socket, pairFactory.pairs[1]?.[1]);
  assert.deepEqual(state.accepted.map((entry) => entry.socket.attachment), [
    { role: "runner", runnerId: "runner-a" },
    { role: "admin" },
  ]);
});

test("fetch rejects non-upgrade and untrusted connection metadata", async () => {
  const pairFactory = createWebSocketPairFactory();
  const { hub } = createHub(pairFactory.factory);

  const notUpgrade = await hub.fetch(
    new Request("https://runner-hub.internal/connect", {
      headers: { "x-task-hub-role": "admin" },
    }),
  );
  const missingRunnerId = await hub.fetch(
    new Request("https://runner-hub.internal/connect", {
      headers: { upgrade: "websocket", "x-task-hub-role": "runner" },
    }),
  );
  const unknownRole = await hub.fetch(
    new Request("https://runner-hub.internal/connect", {
      headers: { upgrade: "websocket", "x-task-hub-role": "unknown" },
    }),
  );

  assert.equal(notUpgrade.status, 426);
  assert.equal(missingRunnerId.status, 400);
  assert.equal(unknownRole.status, 400);
  assert.equal(pairFactory.pairs.length, 0);
});

test("reports deduplicated online Runner and admin presence from hibernation attachments", () => {
  const { state, hub } = createHub();
  const runnerA = new FakeWebSocket();
  const duplicateRunnerA = new FakeWebSocket();
  const runnerB = new FakeWebSocket();
  const admin = new FakeWebSocket();
  hub.acceptRunner(runnerA as unknown as WebSocket, "runner-a");
  hub.acceptRunner(runnerB as unknown as WebSocket, "runner-b");
  hub.acceptAdmin(admin as unknown as WebSocket);

  duplicateRunnerA.serializeAttachment({ role: "runner", runnerId: "runner-a" });
  state.acceptWebSocket(duplicateRunnerA as unknown as WebSocket, ["runner", "runner:runner-a"]);

  assert.deepEqual(hub.getPresence(), {
    onlineRunnerIds: ["runner-a", "runner-b"],
    runnerConnections: 3,
    adminConnections: 1,
  });
});

test("exposes notifications and presence through the internal fetch boundary", async () => {
  const { hub } = createHub();
  const runner = new FakeWebSocket();
  const admin = new FakeWebSocket();
  hub.acceptRunner(runner as unknown as WebSocket, "runner-a");
  hub.acceptAdmin(admin as unknown as WebSocket);

  const wakeResponse = await hub.fetch(new Request("https://runner-hub.internal/task-available", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runnerId: "runner-a", taskId: "task-1" }),
  }));
  const eventResponse = await hub.fetch(new Request("https://runner-hub.internal/admin-event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "task_changed", taskId: "task-1", runnerId: "runner-a", status: "running" }),
  }));
  const presenceResponse = await hub.fetch(new Request("https://runner-hub.internal/presence"));

  assert.deepEqual(await wakeResponse.json(), { delivered: 1 });
  assert.deepEqual(await eventResponse.json(), { delivered: 1 });
  assert.deepEqual(await presenceResponse.json(), {
    onlineRunnerIds: ["runner-a"], runnerConnections: 1, adminConnections: 1,
  });
  assert.deepEqual(JSON.parse(runner.sent[0] as string), { type: "task_available", taskId: "task-1" });
  assert.deepEqual(JSON.parse(admin.sent.at(-1) as string), {
    type: "task_changed", taskId: "task-1", runnerId: "runner-a", status: "running",
  });
});

test("rejects malformed internal Hub events", async () => {
  const { hub } = createHub();
  const response = await hub.fetch(new Request("https://runner-hub.internal/admin-event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "task_changed", taskId: "task-1", runnerId: "runner-a", status: "secret" }),
  }));

  assert.equal(response.status, 400);
});

test("bounds Runner tags while preserving exact targeted lookup", () => {
  const { state, hub } = createHub();
  const sharedPrefix = "r".repeat(300);
  const first = new FakeWebSocket();
  const second = new FakeWebSocket();
  hub.acceptRunner(first as unknown as WebSocket, `${sharedPrefix}-a`);
  hub.acceptRunner(second as unknown as WebSocket, `${sharedPrefix}-b`);

  const delivered = hub.notifyTaskAvailable(`${sharedPrefix}-b`, "task-long-id");

  assert.ok(state.accepted.every((entry) => entry.tags.every((tag) => tag.length <= 256)));
  assert.deepEqual(first.sent, []);
  assert.equal(delivered, 1);
  assert.deepEqual(second.sent.map((message) => JSON.parse(message)), [
    { type: "task_available", taskId: "task-long-id" },
  ]);
});
