import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("deploy workflow generates wrangler.toml from GitHub variables", () => {
  const workflow = readFileSync(".github/workflows/deploy-worker.yml", "utf8");

  assert.match(workflow, /CF_WORKER_NAME/);
  assert.match(workflow, /CF_D1_DATABASE_ID/);
  assert.match(workflow, /CF_KV_NAMESPACE_ID/);
  assert.match(workflow, /cat > wrangler\.toml/);
  assert.doesNotMatch(workflow, /replace-with-cloudflare/);
});

test("forkable Cloudflare template is committed instead of real wrangler config", () => {
  const template = readFileSync("cloudflare/wrangler.toml.template", "utf8");
  const gitignore = readFileSync(".gitignore", "utf8");

  assert.match(template, /\{\{CF_WORKER_NAME\}\}/);
  assert.match(template, /\{\{CF_D1_DATABASE_ID\}\}/);
  assert.match(template, /\{\{CF_KV_NAMESPACE_ID\}\}/);
  assert.match(gitignore, /^wrangler\.toml$/m);
});
