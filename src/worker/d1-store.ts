import type {
  LogEntry,
  Page,
  RunnerRecord,
  RunnerStoreListQuery,
  RunnerView,
  TaskLogResult,
  TaskRecord,
  TaskStore,
  TaskStoreListQuery,
  WebhookDelivery,
} from "./types.js";
import { decodeRunnerCursor, decodeTaskCursor, encodeRunnerCursor, encodeTaskCursor } from "./pagination.js";

interface QueueBinding {
  send(message: unknown): Promise<unknown>;
}

interface R2Binding {
  put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<unknown>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export class D1TaskStore implements TaskStore {
  constructor(
    private readonly db: D1Database,
    private readonly queue?: QueueBinding,
    private readonly objects?: R2Binding,
  ) {}

  async putRunner(runner: RunnerRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO runners (
          runner_id, name, credential_hash, platform, labels_json, task_types_json, capabilities_json,
          last_heartbeat_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(runner_id) DO UPDATE SET
          name = excluded.name,
          credential_hash = excluded.credential_hash,
          platform = excluded.platform,
          labels_json = excluded.labels_json,
          task_types_json = excluded.task_types_json,
          capabilities_json = excluded.capabilities_json,
          last_heartbeat_at = COALESCE(excluded.last_heartbeat_at, runners.last_heartbeat_at),
          updated_at = excluded.updated_at`,
      )
      .bind(
        runner.runnerId,
        runner.name,
        runner.credentialHash,
        runner.platform,
        JSON.stringify(runner.labels),
        JSON.stringify(runner.taskTypes),
        JSON.stringify(runner.capabilities),
        runner.lastHeartbeatAt ?? null,
        runner.createdAt,
        runner.updatedAt,
      )
      .run();
  }

  async getRunner(runnerId: string): Promise<RunnerRecord | undefined> {
    const row = await this.db.prepare("SELECT * FROM runners WHERE runner_id = ?").bind(runnerId).first<Record<string, unknown>>();
    if (!row) {
      return undefined;
    }
    return {
      runnerId: String(row.runner_id),
      name: row.name ? String(row.name) : String(row.runner_id),
      credentialHash: String(row.credential_hash),
      platform: row.platform as RunnerRecord["platform"],
      labels: JSON.parse(String(row.labels_json)) as string[],
      taskTypes: JSON.parse(String(row.task_types_json)) as RunnerRecord["taskTypes"],
      capabilities: JSON.parse(String(row.capabilities_json)) as string[],
      lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  async listRunnerViews(query: RunnerStoreListQuery): Promise<Page<RunnerView>> {
    const afterRunnerId = decodeRunnerCursor(query.cursor);
    const onlineCutoff = new Date(query.now.getTime() - 15_000).toISOString();
    const staleCutoff = new Date(query.now.getTime() - 60_000).toISOString();
    const conditions: string[] = [];
    const values: unknown[] = [onlineCutoff, staleCutoff];
    if (query.status) {
      conditions.push("status = ?");
      values.push(query.status);
    }
    if (afterRunnerId) {
      conditions.push("runner_id > ?");
      values.push(afterRunnerId);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    values.push(query.limit + 1);
    const result = await this.db
      .prepare(
        `WITH runner_views AS (
          SELECT
            r.runner_id, COALESCE(r.name, r.runner_id) AS name, r.platform, r.labels_json,
            r.task_types_json, r.capabilities_json, r.last_heartbeat_at, r.created_at, r.updated_at,
            CASE
              WHEN r.last_heartbeat_at IS NOT NULL AND r.last_heartbeat_at >= ? THEN 'online'
              WHEN r.last_heartbeat_at IS NOT NULL AND r.last_heartbeat_at >= ? THEN 'stale'
              ELSE 'offline'
            END AS status,
            t.task_id AS current_task_id, t.name AS current_task_name,
            t.status AS current_task_status, t.updated_at AS current_task_updated_at
          FROM runners r
          LEFT JOIN tasks t ON t.task_id = (
            SELECT ct.task_id FROM tasks ct
            WHERE ct.runner_id = r.runner_id AND ct.status IN ('leased', 'running')
            ORDER BY ct.updated_at DESC, ct.task_id DESC LIMIT 1
          )
        )
        SELECT * FROM runner_views${where}
        ORDER BY runner_id ASC
        LIMIT ?`,
      )
      .bind(...values)
      .all<Record<string, unknown>>();
    const views = result.results.map(runnerViewFromRow);
    const items = views.slice(0, query.limit);
    return {
      items,
      nextCursor: views.length > query.limit && items.length
        ? encodeRunnerCursor(items[items.length - 1]!.runnerId)
        : undefined,
    };
  }

  async touchRunnerHeartbeat(runnerId: string, timestamp: string): Promise<void> {
    await this.db
      .prepare("UPDATE runners SET last_heartbeat_at = ?, updated_at = ? WHERE runner_id = ?")
      .bind(timestamp, timestamp, runnerId)
      .run();
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

  async listTasks(query: TaskStoreListQuery): Promise<Page<TaskRecord>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (query.runnerId) {
      conditions.push("runner_id = ?");
      values.push(query.runnerId);
    }
    if (query.status) {
      conditions.push("status = ?");
      values.push(query.status);
    }
    if (query.type) {
      conditions.push("type = ?");
      values.push(query.type);
    }
    const cursor = decodeTaskCursor(query.cursor);
    if (cursor) {
      conditions.push("(created_at < ? OR (created_at = ? AND task_id < ?))");
      values.push(cursor.createdAt, cursor.createdAt, cursor.taskId);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    values.push(query.limit + 1);
    const result = await this.db
      .prepare(`SELECT * FROM tasks${where} ORDER BY created_at DESC, task_id DESC LIMIT ?`)
      .bind(...values)
      .all<Record<string, unknown>>();
    const tasks = result.results.map(taskFromRow);
    const items = tasks.slice(0, query.limit);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: tasks.length > query.limit && last
        ? encodeTaskCursor({ createdAt: last.createdAt, taskId: last.taskId })
        : undefined,
    };
  }

  async findCurrentTask(runnerId: string): Promise<TaskRecord | undefined> {
    const row = await this.db
      .prepare(
        "SELECT * FROM tasks WHERE runner_id = ? AND status IN ('leased', 'running') ORDER BY updated_at DESC LIMIT 1",
      )
      .bind(runnerId)
      .first<Record<string, unknown>>();
    return row ? taskFromRow(row) : undefined;
  }

  async saveLogs(taskId: string, leaseId: string, entries: LogEntry[]): Promise<void> {
    const key = `tasks/${taskId}/logs/${Date.now()}-${leaseId}.json`;
    await this.objects?.put(key, JSON.stringify(entries));
  }

  async getTaskLogs(taskId: string): Promise<TaskLogResult> {
    if (!this.objects) {
      return { entries: [], invalidObjects: 0 };
    }
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.objects.list({ prefix: `tasks/${taskId}/logs/`, cursor });
      keys.push(...page.objects.map((object) => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    const entries: LogEntry[] = [];
    let invalidObjects = 0;
    for (const key of keys.sort()) {
      const object = await this.objects.get(key);
      if (!object) {
        invalidObjects += 1;
        continue;
      }
      try {
        const batch = JSON.parse(await object.text()) as unknown;
        if (!Array.isArray(batch) || !batch.every(isLogEntry)) {
          invalidObjects += 1;
          continue;
        }
        entries.push(...batch);
      } catch {
        invalidObjects += 1;
      }
    }
    entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return { entries, invalidObjects };
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

function runnerFromRow(row: Record<string, unknown>): RunnerRecord {
  return {
    runnerId: String(row.runner_id),
    name: row.name ? String(row.name) : String(row.runner_id),
    credentialHash: String(row.credential_hash),
    platform: row.platform as RunnerRecord["platform"],
    labels: JSON.parse(String(row.labels_json)) as string[],
    taskTypes: JSON.parse(String(row.task_types_json)) as RunnerRecord["taskTypes"],
    capabilities: JSON.parse(String(row.capabilities_json)) as string[],
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function runnerViewFromRow(row: Record<string, unknown>): RunnerView {
  return {
    runnerId: String(row.runner_id),
    name: String(row.name),
    platform: row.platform as RunnerView["platform"],
    labels: JSON.parse(String(row.labels_json)) as string[],
    taskTypes: JSON.parse(String(row.task_types_json)) as RunnerView["taskTypes"],
    capabilities: JSON.parse(String(row.capabilities_json)) as string[],
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : undefined,
    status: row.status as RunnerView["status"],
    currentTask: row.current_task_id
      ? {
          taskId: String(row.current_task_id),
          name: String(row.current_task_name),
          status: row.current_task_status as TaskRecord["status"],
          updatedAt: String(row.current_task_updated_at),
        }
      : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function isLogEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    (entry.stream === "stdout" || entry.stream === "stderr" || entry.stream === "system") &&
    typeof entry.message === "string" &&
    typeof entry.timestamp === "string"
  );
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
