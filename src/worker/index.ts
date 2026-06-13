import { D1TaskStore } from "./d1-store.js";
import { TaskHubService } from "./task-service.js";
import type { CompleteTaskInput, LogEntry, RunnerRegistration, SubmitTaskInput } from "./types.js";

interface Env {
  TASK_DB: D1Database;
  TASK_SUBMISSIONS: Queue;
  TASK_OBJECTS: R2Bucket;
  WEBHOOK_SECRET?: string;
}

async function parseJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const service = new TaskHubService(
      new D1TaskStore(env.TASK_DB, env.TASK_SUBMISSIONS, env.TASK_OBJECTS),
      { webhookSecret: env.WEBHOOK_SECRET },
    );
    const url = new URL(request.url);

    try {
      if (request.method === "POST" && url.pathname === "/tasks") {
        const task = await service.submitTask(await parseJson<SubmitTaskInput>(request));
        return json({ taskId: task.taskId, status: task.status }, 202);
      }

      const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
      if (request.method === "GET" && taskMatch) {
        const task = await new D1TaskStore(env.TASK_DB).getTask(taskMatch[1] as string);
        return task ? json(task) : json({ error: "not found" }, 404);
      }

      if (request.method === "POST" && url.pathname === "/runners/register") {
        const runner = await service.registerRunner(await parseJson<RunnerRegistration>(request));
        return json({ runnerId: runner.runnerId }, 201);
      }

      const claimMatch = url.pathname.match(/^\/runners\/([^/]+)\/claim$/);
      if (request.method === "POST" && claimMatch) {
        const runnerId = claimMatch[1] as string;
        const credential = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        return json(await service.claimTask(runnerId, credential));
      }

      const heartbeatMatch = url.pathname.match(/^\/tasks\/([^/]+)\/heartbeat$/);
      if (request.method === "POST" && heartbeatMatch) {
        const body = await parseJson<{ leaseId: string; runnerId: string }>(request);
        const credential = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        return json(await service.heartbeat(heartbeatMatch[1] as string, body.leaseId, body.runnerId, credential));
      }

      const logsMatch = url.pathname.match(/^\/tasks\/([^/]+)\/logs$/);
      if (request.method === "POST" && logsMatch) {
        const body = await parseJson<{ leaseId: string; runnerId: string; entries: LogEntry[] }>(request);
        const credential = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        await service.appendLogs(logsMatch[1] as string, body.leaseId, body.runnerId, credential, body.entries);
        return json({ ok: true });
      }

      const completeMatch = url.pathname.match(/^\/tasks\/([^/]+)\/complete$/);
      if (request.method === "POST" && completeMatch) {
        const body = await parseJson<CompleteTaskInput & { leaseId: string; runnerId: string }>(request);
        const credential = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        const completed = await service.completeTask(
          completeMatch[1] as string,
          body.leaseId,
          body.runnerId,
          credential,
          body,
        );
        return json(completed);
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "unknown error" }, 400);
    }
  },

  async queue(batch: MessageBatch<{ taskId: string }>, env: Env): Promise<void> {
    const service = new TaskHubService(new D1TaskStore(env.TASK_DB, env.TASK_SUBMISSIONS, env.TASK_OBJECTS));
    for (const message of batch.messages) {
      await service.processQueuedTask(message.body.taskId);
      message.ack();
    }
  },
};
