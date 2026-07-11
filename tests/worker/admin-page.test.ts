import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorker } from "../../src/worker/index.js";
import { InMemoryTaskStore } from "../../src/worker/in-memory-store.js";

test("worker serves the responsive admin console without embedding credentials", async () => {
  const worker = createWorker(() => new InMemoryTaskStore());
  const env = {
    TASK_HUB_ADMIN_TOKEN: "server-only-secret",
    TASK_SUBMISSIONS: { send: async () => undefined },
    TASK_OBJECTS: { put: async () => undefined },
    TASK_DB: {},
  };

  for (const path of ["/admin", "/admin/"]) {
    const response = await worker.fetch(new Request(`https://task-hub.example${path}`), env as never);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /id="admin-token"/);
    assert.match(html, /id="runner-list"/);
    assert.match(html, /id="task-table-body"/);
    assert.match(html, /id="task-detail"/);
    assert.match(html, /id="task-logs"/);
    assert.match(html, /id="run-selfcheck"/);
    assert.match(html, /sessionStorage/);
    assert.match(html, /runnerRequestGeneration/);
    assert.match(html, /taskRequestGeneration/);
    assert.match(html, /detailRequestGeneration/);
    assert.match(html, /sessionEpoch/);
    assert.match(html, /refresh === state\.refreshPromise/);
    assert.match(html, /while \(page\.nextCursor\)/);
    assert.match(html, /finally\(schedulePolling\)/);
    assert.match(html, /leaseExpiresAt/);
    assert.doesNotMatch(html, /server-only-secret/);
  }
});
