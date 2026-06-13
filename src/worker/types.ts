export type TaskType = "shell" | "python" | "git" | "agent" | "backup" | "build" | "ocr" | "file";

export type TaskStatus =
  | "queued"
  | "pending_runner"
  | "leased"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "expired";

export type TerminalTaskStatus = "succeeded" | "failed" | "canceled";

export interface SubmitTaskInput {
  runnerId?: string;
  type: TaskType;
  name: string;
  payload: Record<string, unknown>;
  timeoutSeconds: number;
  priority?: number;
  callbackUrl?: string;
  idempotencyKey?: string;
}

export interface RunnerRegistration {
  runnerId: string;
  credential: string;
  platform: "linux" | "windows" | "darwin";
  labels: string[];
  taskTypes: TaskType[];
  capabilities: string[];
}

export interface TaskRecord {
  taskId: string;
  runnerId: string;
  type: TaskType;
  name: string;
  payload: Record<string, unknown>;
  status: TaskStatus;
  timeoutSeconds: number;
  priority: number;
  callbackUrl?: string;
  idempotencyKey?: string;
  leaseId?: string;
  leaseExpiresAt?: string;
  result?: Record<string, unknown>;
  exitCode?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimResponse {
  taskId: string;
  leaseId: string;
  leaseExpiresAt: string;
  type: TaskType;
  payload: Record<string, unknown>;
  timeoutSeconds: number;
  workspacePolicy: {
    maxBytes: number;
    allowedPaths: string[];
    artifactUploadPrefix: string;
  };
}

export interface LogEntry {
  stream: "stdout" | "stderr" | "system";
  message: string;
  timestamp: string;
}

export interface CompleteTaskInput {
  status: TerminalTaskStatus;
  exitCode?: number;
  result?: Record<string, unknown>;
  error?: string;
}

export interface WebhookDelivery {
  eventId: string;
  eventType: `task.${TerminalTaskStatus}`;
  callbackUrl: string;
  payload: {
    taskId: string;
    runnerId: string;
    status: TerminalTaskStatus;
    result?: Record<string, unknown>;
    exitCode?: number;
    error?: string;
  };
  signature: string;
  createdAt: string;
}

export interface TaskStore {
  putRunner(registration: RunnerRegistration): Promise<void>;
  getRunner(runnerId: string): Promise<RunnerRegistration | undefined>;
  putTask(task: TaskRecord): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | undefined>;
  findTaskByIdempotencyKey(idempotencyKey: string): Promise<TaskRecord | undefined>;
  enqueueTask(taskId: string): Promise<void>;
  findClaimableTask(runnerId: string, now: Date): Promise<TaskRecord | undefined>;
  saveLogs(taskId: string, leaseId: string, entries: LogEntry[]): Promise<void>;
  saveWebhookDelivery(delivery: WebhookDelivery): Promise<void>;
}
