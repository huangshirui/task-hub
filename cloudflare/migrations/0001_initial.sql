CREATE TABLE runners (
  runner_id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL,
  platform TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  task_types_json TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  last_heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  timeout_seconds INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  callback_url TEXT,
  idempotency_key TEXT UNIQUE,
  lease_id TEXT,
  lease_expires_at TEXT,
  result_json TEXT,
  exit_code INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (runner_id) REFERENCES runners(runner_id)
);

CREATE INDEX idx_tasks_runner_status_priority
  ON tasks (runner_id, status, priority DESC, created_at ASC);

CREATE TABLE task_attempts (
  attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  runner_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  error TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id)
);

CREATE TABLE webhook_deliveries (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signature TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_status_code INTEGER,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id)
);
