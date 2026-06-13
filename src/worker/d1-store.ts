import type { LogEntry, RunnerRegistration, TaskRecord, TaskStore, WebhookDelivery } from "./types.js";

interface QueueBinding {
  send(message: unknown): Promise<unknown>;
}

interface R2Binding {
  put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<unknown>;
}

export class D1TaskStore implements TaskStore {
  constructor(
    private readonly db: D1Database,
    private readonly queue?: QueueBinding,
    private readonly objects?: R2Binding,
  ) {}

  async putRunner(registration: RunnerRegistration): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO runners (
          runner_id, credential_hash, platform, labels_json, task_types_json, capabilities_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(runner_id) DO UPDATE SET
          credential_hash = excluded.credential_hash,
          platform = excluded.platform,
          labels_json = excluded.labels_json,
          task_types_json = excluded.task_types_json,
          capabilities_json = excluded.capabilities_json,
          updated_at = excluded.updated_at`,
      )
      .bind(
        registration.runnerId,
        registration.credential,
        registration.platform,
        JSON.stringify(registration.labels),
        JSON.stringify(registration.taskTypes),
        JSON.stringify(registration.capabilities),
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
  }

  async getRunner(runnerId: string): Promise<RunnerRegistration | undefined> {
    const row = await this.db.prepare("SELECT * FROM runners WHERE runner_id = ?").bind(runnerId).first<Record<string, unknown>>();
    if (!row) {
      return undefined;
    }
    return {
      runnerId: String(row.runner_id),
      credential: String(row.credential_hash),
      platform: row.platform as RunnerRegistration["platform"],
      labels: JSON.parse(String(row.labels_json)) as string[],
      taskTypes: JSON.parse(String(row.task_types_json)) as RunnerRegistration["taskTypes"],
      capabilities: JSON.parse(String(row.capabilities_json)) as string[],
    };
  }

  async putTask(task: TaskRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO tasks (
          task_id, runner_id, type, name, payload_json, status, timeout_seconds, priority,
          callback_url, idempotency_key, lease_id, lease_expires_at, result_json, exit_code, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          status = excluded.status,
          lease_id = excluded.lease_id,
          lease_expires_at = excluded.lease_expires_at,
          result_json = excluded.result_json,
          exit_code = excluded.exit_code,
          error = excluded.error,
          updated_at = excluded.updated_at`,
      )
      .bind(
        task.taskId,
        task.runnerId,
        task.type,
        task.name,
        JSON.stringify(task.payload),
        task.status,
        task.timeoutSeconds,
        task.priority,
        task.callbackUrl ?? null,
        task.idempotencyKey ?? null,
        task.leaseId ?? null,
        task.leaseExpiresAt ?? null,
        task.result ? JSON.stringify(task.result) : null,
        task.exitCode ?? null,
        task.error ?? null,
        task.createdAt,
        task.updatedAt,
      )
      .run();
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    const row = await this.db.prepare("SELECT * FROM tasks WHERE task_id = ?").bind(taskId).first<Record<string, unknown>>();
    return row ? taskFromRow(row) : undefined;
  }

  async findTaskByIdempotencyKey(idempotencyKey: string): Promise<TaskRecord | undefined> {
    const row = await this.db
      .prepare("SELECT * FROM tasks WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<Record<string, unknown>>();
    return row ? taskFromRow(row) : undefined;
  }

  async enqueueTask(taskId: string): Promise<void> {
    await this.queue?.send({ taskId });
  }

  async findClaimableTask(runnerId: string, now: Date): Promise<TaskRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE runner_id = ?
           AND (status = 'pending_runner' OR (status = 'leased' AND lease_expires_at <= ?))
         ORDER BY priority DESC, created_at ASC
         LIMIT 1`,
      )
      .bind(runnerId, now.toISOString())
      .first<Record<string, unknown>>();
    return row ? taskFromRow(row) : undefined;
  }

  async saveLogs(taskId: string, leaseId: string, entries: LogEntry[]): Promise<void> {
    const key = `tasks/${taskId}/logs/${Date.now()}-${leaseId}.json`;
    await this.objects?.put(key, JSON.stringify(entries));
  }

  async saveWebhookDelivery(delivery: WebhookDelivery): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO webhook_deliveries (
          event_id, task_id, event_type, callback_url, payload_json, signature, attempts, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .bind(
        delivery.eventId,
        delivery.payload.taskId,
        delivery.eventType,
        delivery.callbackUrl,
        JSON.stringify(delivery.payload),
        delivery.signature,
        delivery.createdAt,
      )
      .run();
  }
}

function taskFromRow(row: Record<string, unknown>): TaskRecord {
  return {
    taskId: String(row.task_id),
    runnerId: String(row.runner_id),
    type: row.type as TaskRecord["type"],
    name: String(row.name),
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    status: row.status as TaskRecord["status"],
    timeoutSeconds: Number(row.timeout_seconds),
    priority: Number(row.priority),
    callbackUrl: row.callback_url ? String(row.callback_url) : undefined,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
    leaseId: row.lease_id ? String(row.lease_id) : undefined,
    leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : undefined,
    result: row.result_json ? (JSON.parse(String(row.result_json)) as Record<string, unknown>) : undefined,
    exitCode: row.exit_code === null || row.exit_code === undefined ? undefined : Number(row.exit_code),
    error: row.error ? String(row.error) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
