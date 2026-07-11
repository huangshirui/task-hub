import type {
  ClaimResponse,
  CompleteTaskInput,
  LogEntry,
  Page,
  RunnerDetail,
  RunnerListQuery,
  RunnerRecord,
  RunnerRegistrationInput,
  RunnerStatus,
  RunnerView,
  SubmitTaskInput,
  TaskListQuery,
  TaskLogResult,
  TaskRecord,
  TaskStore,
  TerminalTaskStatus,
} from "./types.js";
import { hashRunnerCredential, verifyRunnerCredential } from "./security.js";

export interface TaskHubServiceOptions {
  now?: () => Date;
  leaseSeconds?: number;
  webhookSecret?: string;
  randomUUID?: () => string;
}

export class TaskHubService {
  private readonly now: () => Date;
  private readonly leaseSeconds: number;
  private readonly webhookSecret: string;
  private readonly randomUUID: () => string;

  constructor(
    private readonly store: TaskStore,
    options: TaskHubServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.leaseSeconds = options.leaseSeconds ?? 60;
    this.webhookSecret = options.webhookSecret ?? "dev-webhook-secret";
    this.randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  }

  async registerRunner(registration: RunnerRegistrationInput): Promise<RunnerRecord> {
    if (!registration.credential) {
      throw new Error("runner credential is required");
    }
    const runnerId = registration.runnerId || `runner_${this.randomUUID()}`;
    const now = this.now().toISOString();
    const previous = await this.store.getRunner(runnerId);
    const runner: RunnerRecord = {
      runnerId,
      name: registration.name?.trim() || runnerId,
      credentialHash: await hashRunnerCredential(registration.credential),
      platform: registration.platform,
      labels: registration.labels,
      taskTypes: registration.taskTypes,
      capabilities: registration.capabilities,
      lastHeartbeatAt: previous?.lastHeartbeatAt,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    await this.store.putRunner(runner);
    return runner;
  }

  async submitTask(input: SubmitTaskInput): Promise<TaskRecord> {
    if (!input.runnerId) {
      throw new Error("runnerId is required");
    }
    if (!input.name) {
      throw new Error("task name is required");
    }
    if (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds <= 0) {
      throw new Error("timeoutSeconds must be a positive integer");
    }
    if (input.idempotencyKey) {
      const existing = await this.store.findTaskByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const now = this.now().toISOString();
    const task: TaskRecord = {
      taskId: `task_${crypto.randomUUID()}`,
      runnerId: input.runnerId,
      type: input.type,
      name: input.name,
      payload: input.payload,
      status: "queued",
      timeoutSeconds: input.timeoutSeconds,
      priority: input.priority ?? 0,
      callbackUrl: input.callbackUrl,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.putTask(task);
    await this.store.enqueueTask(task.taskId);
    return task;
  }

  async processQueuedTask(taskId: string): Promise<TaskRecord> {
    const task = await this.requireTask(taskId);
    const runner = await this.store.getRunner(task.runnerId);
    const now = this.now().toISOString();

    if (!runner) {
      return this.updateTask({ ...task, status: "failed", error: `runner ${task.runnerId} is not registered`, updatedAt: now });
    }
    if (!runner.taskTypes.includes(task.type)) {
      return this.updateTask({
        ...task,
        status: "failed",
        error: `runner ${task.runnerId} does not support task type ${task.type}`,
        updatedAt: now,
      });
    }

    return this.updateTask({ ...task, status: "pending_runner", updatedAt: now });
  }

  async claimTask(runnerId: string, credential: string): Promise<ClaimResponse | null> {
    await this.authenticateRunner(runnerId, credential);

    const now = this.now();
    await this.store.touchRunnerHeartbeat(runnerId, now.toISOString());
    const task = await this.store.findClaimableTask(runnerId, now);
    if (!task) {
      return null;
    }

    const leaseId = `lease_${crypto.randomUUID()}`;
    const leaseExpiresAt = new Date(now.getTime() + this.leaseSeconds * 1000).toISOString();
    await this.updateTask({
      ...task,
      status: "leased",
      leaseId,
      leaseExpiresAt,
      updatedAt: now.toISOString(),
    });

    return {
      taskId: task.taskId,
      leaseId,
      leaseExpiresAt,
      type: task.type,
      payload: task.payload,
      timeoutSeconds: task.timeoutSeconds,
      workspacePolicy: {
        maxBytes: 1024 * 1024 * 1024,
        allowedPaths: [],
        artifactUploadPrefix: `tasks/${task.taskId}/artifacts/`,
      },
    };
  }

  async heartbeat(taskId: string, leaseId: string, runnerId: string, credential: string): Promise<TaskRecord> {
    await this.authenticateRunner(runnerId, credential);
    const task = await this.requireLease(taskId, leaseId, runnerId);
    const now = this.now();
    await this.store.touchRunnerHeartbeat(runnerId, now.toISOString());
    return this.updateTask({
      ...task,
      status: "running",
      leaseExpiresAt: new Date(now.getTime() + this.leaseSeconds * 1000).toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  async appendLogs(
    taskId: string,
    leaseId: string,
    runnerId: string,
    credential: string,
    entries: LogEntry[],
  ): Promise<void> {
    await this.authenticateRunner(runnerId, credential);
    await this.requireLease(taskId, leaseId, runnerId);
    await this.store.saveLogs(taskId, leaseId, entries);
  }

  async completeTask(
    taskId: string,
    leaseId: string,
    runnerId: string,
    credential: string,
    input: CompleteTaskInput,
  ): Promise<TaskRecord> {
    await this.authenticateRunner(runnerId, credential);
    const task = await this.requireLease(taskId, leaseId, runnerId);
    const now = this.now().toISOString();
    const completed = await this.updateTask({
      ...task,
      status: input.status,
      exitCode: input.exitCode,
      result: input.result,
      error: input.error,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });

    if (completed.callbackUrl) {
      await this.recordWebhookDelivery(completed, input.status);
    }
    return completed;
  }

  async listRunners(query: RunnerListQuery = {}): Promise<Page<RunnerView>> {
    const limit = normalizeLimit(query.limit);
    const offset = decodeCursor(query.cursor);
    const views = await Promise.all((await this.store.listRunners()).map((runner) => this.runnerView(runner)));
    const filtered = query.status ? views.filter((runner) => runner.status === query.status) : views;
    return pageFrom(filtered, offset, limit);
  }

  async getRunnerView(runnerId: string): Promise<RunnerDetail | undefined> {
    const runner = await this.store.getRunner(runnerId);
    if (!runner) {
      return undefined;
    }
    const view = await this.runnerView(runner);
    const recentTasks = (await this.store.listTasks({ runnerId })).slice(0, 20);
    return { ...view, recentTasks };
  }

  async listTasks(query: TaskListQuery = {}): Promise<Page<TaskRecord>> {
    const limit = normalizeLimit(query.limit);
    const offset = decodeCursor(query.cursor);
    const tasks = await this.store.listTasks({ runnerId: query.runnerId, status: query.status, type: query.type });
    return pageFrom(tasks, offset, limit);
  }

  async getTaskForAdmin(taskId: string): Promise<TaskRecord | undefined> {
    return this.store.getTask(taskId);
  }

  async getTaskLogs(taskId: string): Promise<TaskLogResult | undefined> {
    if (!(await this.store.getTask(taskId))) {
      return undefined;
    }
    return this.store.getTaskLogs(taskId);
  }

  private async runnerView(runner: RunnerRecord): Promise<RunnerView> {
    const currentTask = await this.store.findCurrentTask(runner.runnerId);
    return {
      runnerId: runner.runnerId,
      name: runner.name,
      platform: runner.platform,
      labels: runner.labels,
      taskTypes: runner.taskTypes,
      capabilities: runner.capabilities,
      lastHeartbeatAt: runner.lastHeartbeatAt,
      status: runnerStatus(runner.lastHeartbeatAt, this.now()),
      currentTask: currentTask
        ? {
            taskId: currentTask.taskId,
            name: currentTask.name,
            status: currentTask.status,
            updatedAt: currentTask.updatedAt,
          }
        : undefined,
      createdAt: runner.createdAt,
      updatedAt: runner.updatedAt,
    };
  }

  private async authenticateRunner(runnerId: string, credential: string): Promise<RunnerRecord> {
    const runner = await this.store.getRunner(runnerId);
    if (!runner || !(await verifyRunnerCredential(credential, runner.credentialHash))) {
      throw new Error("invalid runner credential");
    }
    return runner;
  }

  private async requireTask(taskId: string): Promise<TaskRecord> {
    const task = await this.store.getTask(taskId);
    if (!task) {
      throw new Error(`task ${taskId} not found`);
    }
    return task;
  }

  private async requireLease(taskId: string, leaseId: string, runnerId: string): Promise<TaskRecord> {
    const task = await this.requireTask(taskId);
    if (task.runnerId !== runnerId || task.leaseId !== leaseId) {
      throw new Error("invalid task lease");
    }
    return task;
  }

  private async updateTask(task: TaskRecord): Promise<TaskRecord> {
    await this.store.putTask(task);
    return task;
  }

  private async recordWebhookDelivery(task: TaskRecord, status: TerminalTaskStatus): Promise<void> {
    const payload = {
      taskId: task.taskId,
      runnerId: task.runnerId,
      status,
      result: task.result,
      exitCode: task.exitCode,
      error: task.error,
    };
    const body = JSON.stringify(payload);
    const signature = await signWebhookBody(this.webhookSecret, body);

    await this.store.saveWebhookDelivery({
      eventId: `evt_${crypto.randomUUID()}`,
      eventType: `task.${status}`,
      callbackUrl: task.callbackUrl as string,
      payload,
      signature,
      createdAt: this.now().toISOString(),
    });
  }
}

function runnerStatus(lastHeartbeatAt: string | undefined, now: Date): RunnerStatus {
  if (!lastHeartbeatAt) {
    return "offline";
  }
  const ageMs = now.getTime() - new Date(lastHeartbeatAt).getTime();
  if (ageMs <= 15_000) {
    return "online";
  }
  if (ageMs <= 60_000) {
    return "stale";
  }
  return "offline";
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  return limit;
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  try {
    const parsed = JSON.parse(atob(cursor)) as { offset?: unknown };
    if (!Number.isInteger(parsed.offset) || (parsed.offset as number) < 0) {
      throw new Error("invalid cursor");
    }
    return parsed.offset as number;
  } catch {
    throw new Error("invalid cursor");
  }
}

function pageFrom<T>(items: T[], offset: number, limit: number): Page<T> {
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < items.length ? btoa(JSON.stringify({ offset: nextOffset })) : undefined,
  };
}

async function signWebhookBody(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
