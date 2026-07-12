import type {
  ClaimResponse,
  CompleteTaskInput,
  LogEntry,
  Page,
  RunnerDetail,
  RunnerListQuery,
  RunnerRecord,
  RunnerRegistrationInput,
  RunnerView,
  SubmitTaskInput,
  TaskListQuery,
  TaskLogResult,
  TaskRecord,
  TaskStore,
  TerminalTaskStatus,
} from "./types.js";
import { hashRunnerCredential, verifyRunnerCredential } from "./security.js";
import { AuthenticationError, NotFoundError, ValidationError } from "./errors.js";

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
    if (!registration || typeof registration !== "object") {
      throw new ValidationError("invalid runner registration");
    }
    if (typeof registration.credential !== "string" || !registration.credential) {
      throw new ValidationError("runner credential is required");
    }
    if (registration.runnerId !== undefined && (typeof registration.runnerId !== "string" || !registration.runnerId.trim())) {
      throw new ValidationError("invalid runnerId");
    }
    if (registration.name !== undefined && typeof registration.name !== "string") {
      throw new ValidationError("invalid runner name");
    }
    if (!(["linux", "windows", "darwin"] as unknown[]).includes(registration.platform)) {
      throw new ValidationError("invalid runner platform");
    }
    if (!isStringArray(registration.labels) || !isTaskTypeArray(registration.taskTypes) || !isStringArray(registration.capabilities)) {
      throw new ValidationError("invalid runner capabilities");
    }
    const runnerId = registration.runnerId || `runner_${this.randomUUID()}`;
    const now = this.now().toISOString();
    const previous = await this.store.getRunner(runnerId);
    const runner: RunnerRecord = {
      runnerId,
      name: registration.name?.trim() || previous?.name || runnerId,
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
    if (!input || typeof input !== "object") {
      throw new ValidationError("invalid task submission");
    }
    if (typeof input.runnerId !== "string" || !input.runnerId.trim()) {
      throw new ValidationError("runnerId is required");
    }
    if (!isTaskType(input.type)) {
      throw new ValidationError("invalid task type");
    }
    if (typeof input.name !== "string" || !input.name.trim()) {
      throw new ValidationError("task name is required");
    }
    if (!isPlainObject(input.payload)) {
      throw new ValidationError("task payload must be an object");
    }
    if (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds <= 0) {
      throw new ValidationError("timeoutSeconds must be a positive integer");
    }
    if (input.priority !== undefined && !Number.isInteger(input.priority)) {
      throw new ValidationError("priority must be an integer");
    }
    if (input.callbackUrl !== undefined && !isHttpUrl(input.callbackUrl)) {
      throw new ValidationError("callbackUrl must be an HTTP URL");
    }
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== "string" || !input.idempotencyKey)) {
      throw new ValidationError("idempotencyKey must be a non-empty string");
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

  async authenticateRunnerConnection(runnerId: string, credential: string): Promise<void> {
    await this.authenticateRunner(runnerId, credential);
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
    return this.store.listRunnerViews({ ...query, limit, now: this.now() });
  }

  async getRunnerView(runnerId: string): Promise<RunnerDetail | undefined> {
    const view = await this.store.getRunnerView(runnerId, this.now());
    if (!view) {
      return undefined;
    }
    const recentTasks = (await this.store.listTasks({ runnerId, limit: 20 })).items;
    return { ...view, recentTasks };
  }

  async listTasks(query: TaskListQuery = {}): Promise<Page<TaskRecord>> {
    const limit = normalizeLimit(query.limit);
    return this.store.listTasks({ ...query, limit });
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

  private async authenticateRunner(runnerId: string, credential: string): Promise<RunnerRecord> {
    const runner = await this.store.getRunner(runnerId);
    if (!runner || !(await verifyRunnerCredential(credential, runner.credentialHash))) {
      throw new AuthenticationError("invalid runner credential");
    }
    return runner;
  }

  private async requireTask(taskId: string): Promise<TaskRecord> {
    const task = await this.store.getTask(taskId);
    if (!task) {
      throw new NotFoundError(`task ${taskId} not found`);
    }
    return task;
  }

  private async requireLease(taskId: string, leaseId: string, runnerId: string): Promise<TaskRecord> {
    const task = await this.requireTask(taskId);
    if (task.runnerId !== runnerId || task.leaseId !== leaseId) {
      throw new ValidationError("invalid task lease");
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

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError("limit must be an integer between 1 and 100");
  }
  return limit;
}

const allowedTaskTypes = new Set(["selfcheck", "shell", "python", "git", "agent", "backup", "build", "ocr", "file"]);

function isTaskType(value: unknown): value is TaskRecord["type"] {
  return typeof value === "string" && allowedTaskTypes.has(value);
}

function isTaskTypeArray(value: unknown): value is TaskRecord["type"][] {
  return Array.isArray(value) && value.every(isTaskType);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
