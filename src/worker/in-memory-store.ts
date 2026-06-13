import type { LogEntry, RunnerRegistration, TaskRecord, TaskStore, WebhookDelivery } from "./types.js";

export class InMemoryTaskStore implements TaskStore {
  readonly runners = new Map<string, RunnerRegistration>();
  readonly tasks = new Map<string, TaskRecord>();
  readonly enqueuedTaskIds: string[] = [];
  readonly logBatches: Array<{ taskId: string; leaseId: string; entries: LogEntry[] }> = [];
  readonly webhookDeliveries: WebhookDelivery[] = [];

  async putRunner(registration: RunnerRegistration): Promise<void> {
    this.runners.set(registration.runnerId, registration);
  }

  async getRunner(runnerId: string): Promise<RunnerRegistration | undefined> {
    return this.runners.get(runnerId);
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

  async saveLogs(taskId: string, leaseId: string, entries: LogEntry[]): Promise<void> {
    this.logBatches.push({ taskId, leaseId, entries });
  }

  async saveWebhookDelivery(delivery: WebhookDelivery): Promise<void> {
    this.webhookDeliveries.push(delivery);
  }
}
