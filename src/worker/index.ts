import { D1TaskStore } from "./d1-store.js";
import { adminPageResponse } from "./admin-page.js";
import { AuthenticationError, NotFoundError, ValidationError } from "./errors.js";
import { constantTimeStringEqual } from "./security.js";
import { TaskHubService } from "./task-service.js";
import type {
  CompleteTaskInput,
  LogEntry,
  RunnerListQuery,
  RunnerRegistrationInput,
  SubmitTaskInput,
  TaskListQuery,
  TaskStatus,
  TaskStore,
  TaskType,
} from "./types.js";

export interface Env {
  TASK_DB: D1Database;
  TASK_SUBMISSIONS: Queue;
  TASK_OBJECTS: R2Bucket;
  WEBHOOK_SECRET?: string;
  RUNNER_REGISTRATION_TOKEN?: string;
  TASK_HUB_ADMIN_TOKEN?: string;
}

type StoreFactory = (env: Env) => TaskStore;

const taskStatuses: TaskStatus[] = [
  "queued",
  "pending_runner",
  "leased",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "expired",
];
const taskTypes: TaskType[] = ["selfcheck", "shell", "python", "git", "agent", "backup", "build", "ocr", "file"];

async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ValidationError("invalid JSON body");
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bearerToken(request: Request): string {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
}

export function createWorker(
  storeFactory: StoreFactory = (env) => new D1TaskStore(env.TASK_DB, env.TASK_SUBMISSIONS, env.TASK_OBJECTS),
) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const service = new TaskHubService(storeFactory(env), { webhookSecret: env.WEBHOOK_SECRET });
      const url = new URL(request.url);

      try {
        if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/")) {
          return adminPageResponse();
        }

        if (url.pathname.startsWith("/api/admin/")) {
          if (!env.TASK_HUB_ADMIN_TOKEN || !constantTimeStringEqual(bearerToken(request), env.TASK_HUB_ADMIN_TOKEN)) {
            return json({ error: "unauthorized" }, 401);
          }
          return await handleAdminRequest(request, url, service);
        }

        if (request.method === "POST" && url.pathname === "/tasks") {
          const task = await service.submitTask(await parseJson<SubmitTaskInput>(request));
          return json({ taskId: task.taskId, status: task.status }, 202);
        }

        const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
        if (request.method === "GET" && taskMatch) {
          const task = await service.getTaskForAdmin(taskMatch[1] as string);
          return task ? json(task) : json({ error: "not found" }, 404);
        }

        if (request.method === "POST" && url.pathname === "/runners/register") {
          if (!env.RUNNER_REGISTRATION_TOKEN) {
            return json({ error: "runner registration is disabled" }, 401);
          }
          if (bearerToken(request) !== env.RUNNER_REGISTRATION_TOKEN) {
            return json({ error: "invalid runner registration token" }, 401);
          }
          const runner = await service.registerRunner(await parseJson<RunnerRegistrationInput>(request));
          return json({ runnerId: runner.runnerId, name: runner.name }, 201);
        }

        const claimMatch = url.pathname.match(/^\/runners\/([^/]+)\/claim$/);
        if (request.method === "POST" && claimMatch) {
          return json(await service.claimTask(claimMatch[1] as string, bearerToken(request)));
        }

        const heartbeatMatch = url.pathname.match(/^\/tasks\/([^/]+)\/heartbeat$/);
        if (request.method === "POST" && heartbeatMatch) {
          const body = await parseJson<{ leaseId: string; runnerId: string }>(request);
          return json(
            await service.heartbeat(heartbeatMatch[1] as string, body.leaseId, body.runnerId, bearerToken(request)),
          );
        }

        const logsMatch = url.pathname.match(/^\/tasks\/([^/]+)\/logs$/);
        if (request.method === "POST" && logsMatch) {
          const body = await parseJson<{ leaseId: string; runnerId: string; entries: LogEntry[] }>(request);
          await service.appendLogs(
            logsMatch[1] as string,
            body.leaseId,
            body.runnerId,
            bearerToken(request),
            body.entries,
          );
          return json({ ok: true });
        }

        const completeMatch = url.pathname.match(/^\/tasks\/([^/]+)\/complete$/);
        if (request.method === "POST" && completeMatch) {
          const body = await parseJson<CompleteTaskInput & { leaseId: string; runnerId: string }>(request);
          return json(
            await service.completeTask(
              completeMatch[1] as string,
              body.leaseId,
              body.runnerId,
              bearerToken(request),
              body,
            ),
          );
        }

        return json({ error: "not found" }, 404);
      } catch (error) {
        if (error instanceof ValidationError) {
          return json({ error: error.message }, 400);
        }
        if (error instanceof AuthenticationError) {
          return json({ error: error.message }, 401);
        }
        if (error instanceof NotFoundError) {
          return json({ error: "not found" }, 404);
        }
        return json({ error: "internal server error" }, 500);
      }
    },

    async queue(batch: MessageBatch<{ taskId: string }>, env: Env): Promise<void> {
      const service = new TaskHubService(storeFactory(env));
      for (const message of batch.messages) {
        await service.processQueuedTask(message.body.taskId);
        message.ack();
      }
    },
  };
}

async function handleAdminRequest(request: Request, url: URL, service: TaskHubService): Promise<Response> {
  if (url.pathname === "/api/admin/runners" && request.method === "GET") {
    const query: RunnerListQuery = {
      status: parseRunnerStatus(url.searchParams.get("status")),
      limit: parseLimit(url.searchParams.get("limit")),
      cursor: url.searchParams.get("cursor") ?? undefined,
    };
    return json(await service.listRunners(query));
  }

  const runnerMatch = url.pathname.match(/^\/api\/admin\/runners\/([^/]+)$/);
  if (runnerMatch && request.method === "GET") {
    const runner = await service.getRunnerView(decodeURIComponent(runnerMatch[1] as string));
    return runner ? json(runner) : json({ error: "not found" }, 404);
  }

  if (url.pathname === "/api/admin/tasks" && request.method === "GET") {
    const query: TaskListQuery = {
      runnerId: url.searchParams.get("runnerId") ?? undefined,
      status: parseEnum(url.searchParams.get("status"), taskStatuses, "status"),
      type: parseEnum(url.searchParams.get("type"), taskTypes, "type"),
      limit: parseLimit(url.searchParams.get("limit")),
      cursor: url.searchParams.get("cursor") ?? undefined,
    };
    return json(await service.listTasks(query));
  }

  if (url.pathname === "/api/admin/tasks" && request.method === "POST") {
    const task = await service.submitTask(await parseJson<SubmitTaskInput>(request));
    return json({ taskId: task.taskId, status: task.status }, 202);
  }

  const taskLogsMatch = url.pathname.match(/^\/api\/admin\/tasks\/([^/]+)\/logs$/);
  if (taskLogsMatch && request.method === "GET") {
    const logs = await service.getTaskLogs(decodeURIComponent(taskLogsMatch[1] as string));
    return logs ? json(logs) : json({ error: "not found" }, 404);
  }

  const taskMatch = url.pathname.match(/^\/api\/admin\/tasks\/([^/]+)$/);
  if (taskMatch && request.method === "GET") {
    const task = await service.getTaskForAdmin(decodeURIComponent(taskMatch[1] as string));
    return task ? json(task) : json({ error: "not found" }, 404);
  }

  return json({ error: "not found" }, 404);
}

function parseRunnerStatus(value: string | null): RunnerListQuery["status"] {
  return parseEnum(value, ["online", "stale", "offline"], "status");
}

function parseEnum<T extends string>(value: string | null, allowed: readonly T[], name: string): T | undefined {
  if (value === null) {
    return undefined;
  }
  if (!allowed.includes(value as T)) {
    throw new ValidationError(`invalid ${name}`);
  }
  return value as T;
}

function parseLimit(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw new ValidationError("limit must be an integer between 1 and 100");
  }
  return Number(value);
}

export default createWorker();
