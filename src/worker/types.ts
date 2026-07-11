export type TaskType = "selfcheck" | "shell" | "python" | "git" | "agent" | "backup" | "build" | "ocr" | "file";

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
export type RunnerStatus = "online" | "stale" | "offline";

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

export interface RunnerRegistrationInput {
  runnerId?: string;
  name?: string;
  credential: string;
  platform: "linux" | "windows" | "darwin";
  labels: string[];
  taskTypes: TaskType[];
  capabilities: string[];
}

export interface RunnerRecord {
  runnerId: string;
  name: string;
  credentialHash: string;
  platform: "linux" | "windows" | "darwin";
  labels: string[];
  taskTypes: TaskType[];
  capabilities: string[];
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunnerView {
  runnerId: string;
  name: string;
  platform: RunnerRecord["platform"];
  labels: string[];
  taskTypes: TaskType[];
  capabilities: string[];
  lastHeartbeatAt?: string;
  status: RunnerStatus;
  currentTask?: Pick<TaskRecord, "taskId" | "name" | "status" | "updatedAt">;
  createdAt: string;
  updatedAt: string;
}

export interface RunnerDetail extends RunnerView {
  recentTasks: TaskRecord[];
}

export interface RunnerListQuery {
  status?: RunnerStatus;
  limit?: number;
  cursor?: string;
}

export interface TaskListQuery {
  runnerId?: string;
  status?: TaskStatus;
  type?: TaskType;
  limit?: number;
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface TaskLogResult {
  entries: LogEntry[];
  invalidObjects: number;
}

export interface RunnerStoreListQuery extends RunnerListQuery {
  limit: number;
  now: Date;
}

export interface TaskStoreListQuery extends TaskListQuery {
  limit: number;
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
  putRunner(runner: RunnerRecord): Promise<void>;
  getRunner(runnerId: string): Promise<RunnerRecord | undefined>;
  listRunnerViews(query: RunnerStoreListQuery): Promise<Page<RunnerView>>;
  touchRunnerHeartbeat(runnerId: string, timestamp: string): Promise<void>;
  putTask(task: TaskRecord): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | undefined>;
  findTaskByIdempotencyKey(idempotencyKey: string): Promise<TaskRecord | undefined>;
  enqueueTask(taskId: string): Promise<void>;
  findClaimableTask(runnerId: string, now: Date): Promise<TaskRecord | undefined>;
  listTasks(query: TaskStoreListQuery): Promise<Page<TaskRecord>>;
  findCurrentTask(runnerId: string): Promise<TaskRecord | undefined>;
  saveLogs(taskId: string, leaseId: string, entries: LogEntry[]): Promise<void>;
  getTaskLogs(taskId: string): Promise<TaskLogResult>;
  saveWebhookDelivery(delivery: WebhookDelivery): Promise<void>;
}
