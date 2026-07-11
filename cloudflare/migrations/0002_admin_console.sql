ALTER TABLE runners ADD COLUMN name TEXT;

CREATE INDEX idx_runners_last_heartbeat
  ON runners (last_heartbeat_at DESC, runner_id ASC);

CREATE INDEX idx_tasks_created
  ON tasks (created_at DESC, task_id DESC);
