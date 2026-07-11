import type { LogEntry, RunnerRecord, TaskListQuery, TaskLogResult, TaskRecord, TaskStore, WebhookDelivery } from "./types.js";

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

  async listRunners(): Promise<RunnerRecord[]> {
    return [...this.runners.values()].map((runner) => ({ ...runner })).sort((a, b) => a.runnerId.localeCompare(b.runnerId));
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

  async listTasks(query: Omit<TaskListQuery, "limit" | "cursor">): Promise<TaskRecord[]> {
    return [...this.tasks.values()]
      .filter((task) => !query.runnerId || task.runnerId === query.runnerId)
      .filter((task) => !query.status || task.status === query.status)
      .filter((task) => !query.type || task.type === query.type)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.taskId.localeCompare(a.taskId))
      .map((task) => ({ ...task }));
  }

  async findCurrentTask(runnerId: string): Promise<TaskRecord | undefined> {
    return (await this.listTasks({ runnerId })).find((task) => task.status === "leased" || task.status === "running");
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
