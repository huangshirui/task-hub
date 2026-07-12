import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("deploy workflow generates wrangler.toml from GitHub variables", () => {
  const workflow = readFileSync(".github/workflows/deploy-worker.yml", "utf8");

  assert.match(workflow, /CF_WORKER_NAME/);
  assert.match(workflow, /CF_D1_DATABASE_ID/);
  assert.match(workflow, /name = "RUNNER_HUB"/);
  assert.match(workflow, /class_name = "RunnerHub"/);
  assert.match(workflow, /new_sqlite_classes = \["RunnerHub"\]/);
  assert.doesNotMatch(workflow, /CF_KV_NAMESPACE_ID|TASK_CACHE/);
  assert.match(workflow, /cat > wrangler\.toml/);
  assert.doesNotMatch(workflow, /replace-with-cloudflare/);
});

test("deploy workflow publishes required Worker secrets", () => {
  const workflow = readFileSync(".github/workflows/deploy-worker.yml", "utf8");

  for (const secret of ["WEBHOOK_SECRET", "RUNNER_REGISTRATION_TOKEN", "TASK_HUB_ADMIN_TOKEN"]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
    assert.match(workflow, new RegExp(`^\\s{10}${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}$`, "m"));
    assert.match(workflow, new RegExp(`^\\s+${secret}$`, "m"));
  }
});

test("forkable Cloudflare template is committed instead of real wrangler config", () => {
  const template = readFileSync("cloudflare/wrangler.toml.template", "utf8");
  const gitignore = readFileSync(".gitignore", "utf8");

  assert.match(template, /\{\{CF_WORKER_NAME\}\}/);
  assert.match(template, /\{\{CF_D1_DATABASE_ID\}\}/);
  assert.match(template, /name = "RUNNER_HUB"/);
  assert.match(template, /class_name = "RunnerHub"/);
  assert.match(template, /new_sqlite_classes = \["RunnerHub"\]/);
  assert.doesNotMatch(template, /CF_KV_NAMESPACE_ID|TASK_CACHE/);
  assert.match(gitignore, /^wrangler\.toml$/m);
});

test("bootstrap workflow does not create the unused KV namespace", () => {
  const workflow = readFileSync(".github/workflows/bootstrap-cloudflare.yml", "utf8");
  assert.doesNotMatch(workflow, /Create KV namespace|kv namespace create|TASK_CACHE/);
});
