# Deployment

## Bootstrap Cloudflare Resources

Run `.github/workflows/bootstrap-cloudflare.yml` manually from GitHub Actions.

It creates:

- Cloudflare Queue from `CF_QUEUE_NAME`
- D1 database from `CF_D1_DATABASE_NAME`
- R2 bucket from `CF_R2_BUCKET_NAME`

After bootstrap, copy generated IDs into repository variables:

- `CF_D1_DATABASE_ID`

The Runner connection hub is a SQLite-backed Durable Object declared in `wrangler.toml`. Wrangler creates it from migration tag `v1` during the first deployment; it does not require a separately created resource ID.

## Deploy Worker

`.github/workflows/deploy-worker.yml` runs on pushes to `main` and can also be triggered manually.

It performs:

1. `npm ci`
2. `npm test`
3. Generate `wrangler.toml` from GitHub Variables
4. `wrangler d1 migrations apply <CF_D1_DATABASE_NAME> --remote`
5. `wrangler deploy`

The Worker deploy includes the `RUNNER_HUB` Durable Object binding and its migration. Do not remove or rename an applied Durable Object migration tag. A rollback should deploy an earlier compatible Worker version while retaining the Durable Object class and migration history.

## Worker Secret

Set `WEBHOOK_SECRET`, `RUNNER_REGISTRATION_TOKEN`, and `TASK_HUB_ADMIN_TOKEN` as GitHub Secrets and, for local/manual deploys, as Cloudflare Worker secrets:

```powershell
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put RUNNER_REGISTRATION_TOKEN
npx wrangler secret put TASK_HUB_ADMIN_TOKEN
```

The GitHub Actions deploy step passes these three values through `wrangler-action`'s `secrets` input. Local/manual deploys still require the `wrangler secret put` commands above.

After deploying the credential-hashing release, re-run registration for every existing Runner. This preserves the Runner ID while replacing the legacy stored credential with a hash.

## Local Deploy

For local Wrangler usage:

```powershell
copy cloudflare\wrangler.toml.template wrangler.toml
npm.cmd test
npx wrangler d1 migrations apply <database-name> --remote
npx wrangler deploy
```

After deployment, open `https://<worker-host>/admin` and use `TASK_HUB_ADMIN_TOKEN` to verify Runner discovery and WebSocket presence. Submit a `selfcheck` task to a connected Runner and verify that it moves through `pending_runner`, `leased`, `running`, and `succeeded` without waiting for the 10-minute fallback claim.

`wrangler.toml` is intentionally ignored because it contains account-specific resource bindings.

## Upgrade Ubuntu Runners

Upgrade the shared Runner checkout with an immutable release tag, then let the updater validate and restart every account instance:

```bash
sudo /opt/task-hub/runner/platforms/ubuntu_server/update.sh --version v0.2.0 --dry-run
sudo /opt/task-hub/runner/platforms/ubuntu_server/update.sh --version v0.2.0
```

Do not use `install.sh` for upgrades. The updater preserves account-scoped identities, credentials, configuration, workspaces, permissions, and Handler selections and automatically rolls back on failure. See `runner/platforms/ubuntu_server/README.md` for commit-based upgrades and custom install paths.
