import { decodeRunnerCursor, decodeTaskCursor, encodeRunnerCursor, encodeTaskCursor } from "./pagination.js";
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

export class InMemoryTaskStore implements TaskStore {
  readonly runners = new Map<string, RunnerRecord>();
  readonly tasks = new Map<string, TaskRecord>();
  readonly enqueuedTaskIds: string[] = [];
  readonly logBatches: Array<{ taskId: string; leaseId: string; entries: LogEntry[] }> = [];
  readonly webhookDeliveries: WebhookDelivery[] = [];

  async putRunner(runner: RunnerRecord): Promise<void> {
    this.runners.set(runner.runnerId, { ...runner });
  }

  async getRunner(runnerId: string): Promise<RunnerRecord | undefined> {
    const runner = this.runners.get(runnerId);
    return runner ? { ...runner } : undefined;
  }

  async listRunnerViews(query: RunnerStoreListQuery): Promise<Page<RunnerView>> {
    const afterRunnerId = decodeRunnerCursor(query.cursor);
    const views = await Promise.all(
      [...this.runners.values()]
        .filter((runner) => !afterRunnerId || runner.runnerId > afterRunnerId)
        .sort((a, b) => a.runnerId.localeCompare(b.runnerId))
        .map(async (runner) => runnerView(runner, await this.findCurrentTask(runner.runnerId), query.now)),
    );
    const filtered = query.status ? views.filter((runner) => runner.status === query.status) : views;
    const items = filtered.slice(0, query.limit);
    return {
      items,
      nextCursor: filtered.length > query.limit && items.length
        ? encodeRunnerCursor(items[items.length - 1]!.runnerId)
        : undefined,
    };
  }

  async touchRunnerHeartbeat(runnerId: string, timestamp: string): Promise<void> {
    const runner = this.runners.get(runnerId);
    if (runner) {
      this.runners.set(runnerId, { ...runner, lastHeartbeatAt: timestamp, updatedAt: timestamp });
    }
  }

  async putTask(task: TaskRecord): Promise<void> {
    this.tasks.set(task.taskId, { ...task });
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  async findTaskByIdempotencyKey(idempotencyKey: string): Promise<TaskRecord | undefined> {
    for (const task of this.tasks.values()) {
      if (task.idempotencyKey === idempotencyKey) {
        return { ...task };
      }
    }
    return undefined;
  }

  async enqueueTask(taskId: string): Promise<void> {
    this.enqueuedTaskIds.push(taskId);
  }

  async findClaimableTask(runnerId: string, now: Date): Promise<TaskRecord | undefined> {
    const candidates = [...this.tasks.values()].filter((task) => {
      if (task.runnerId !== runnerId) {
        return false;
      }
      if (task.status === "pending_runner") {
        return true;
      }
      return task.status === "leased" && task.leaseExpiresAt !== undefined && new Date(task.leaseExpiresAt) <= now;
    });

    candidates.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
    const selected = candidates[0];
    return selected ? { ...selected } : undefined;
  }

  async listTasks(query: TaskStoreListQuery): Promise<Page<TaskRecord>> {
    const cursor = decodeTaskCursor(query.cursor);
    const filtered = [...this.tasks.values()]
      .filter((task) => !query.runnerId || task.runnerId === query.runnerId)
      .filter((task) => !query.status || task.status === query.status)
      .filter((task) => !query.type || task.type === query.type)
      .filter((task) => !cursor || task.createdAt < cursor.createdAt || (task.createdAt === cursor.createdAt && task.taskId < cursor.taskId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.taskId.localeCompare(a.taskId))
      .map((task) => ({ ...task }));
    const items = filtered.slice(0, query.limit);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: filtered.length > query.limit && last
        ? encodeTaskCursor({ createdAt: last.createdAt, taskId: last.taskId })
        : undefined,
    };
  }

  async findCurrentTask(runnerId: string): Promise<TaskRecord | undefined> {
    return [...this.tasks.values()]
      .filter((task) => task.runnerId === runnerId && (task.status === "leased" || task.status === "running"))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  async saveLogs(taskId: string, leaseId: string, entries: LogEntry[]): Promise<void> {
    this.logBatches.push({ taskId, leaseId, entries });
  }

  async getTaskLogs(taskId: string): Promise<TaskLogResult> {
    const entries = this.logBatches
      .filter((batch) => batch.taskId === taskId)
      .flatMap((batch) => batch.entries)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return { entries, invalidObjects: 0 };
  }

  async saveWebhookDelivery(delivery: WebhookDelivery): Promise<void> {
    this.webhookDeliveries.push(delivery);
  }
}

function runnerView(runner: RunnerRecord, currentTask: TaskRecord | undefined, now: Date): RunnerView {
  const ageMs = runner.lastHeartbeatAt ? now.getTime() - new Date(runner.lastHeartbeatAt).getTime() : Number.POSITIVE_INFINITY;
  const status = ageMs <= 15_000 ? "online" : ageMs <= 60_000 ? "stale" : "offline";
  return {
    runnerId: runner.runnerId,
    name: runner.name,
    platform: runner.platform,
    labels: [...runner.labels],
    taskTypes: [...runner.taskTypes],
    capabilities: [...runner.capabilities],
    lastHeartbeatAt: runner.lastHeartbeatAt,
    status,
    currentTask: currentTask
      ? { taskId: currentTask.taskId, name: currentTask.name, status: currentTask.status, updatedAt: currentTask.updatedAt }
      : undefined,
    createdAt: runner.createdAt,
    updatedAt: runner.updatedAt,
  };
}
