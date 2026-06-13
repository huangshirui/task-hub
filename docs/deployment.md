# Deployment

## Bootstrap Cloudflare Resources

Run `.github/workflows/bootstrap-cloudflare.yml` manually from GitHub Actions.

It creates:

- Cloudflare Queue from `CF_QUEUE_NAME`
- D1 database from `CF_D1_DATABASE_NAME`
- R2 bucket from `CF_R2_BUCKET_NAME`
- KV namespace named `TASK_CACHE`

After bootstrap, copy generated IDs into repository variables:

- `CF_D1_DATABASE_ID`
- `CF_KV_NAMESPACE_ID`

## Deploy Worker

`.github/workflows/deploy-worker.yml` runs on pushes to `main` and can also be triggered manually.

It performs:

1. `npm ci`
2. `npm test`
3. Generate `wrangler.toml` from GitHub Variables
4. `wrangler d1 migrations apply <CF_D1_DATABASE_NAME> --remote`
5. `wrangler deploy`

## Worker Secret

Set `WEBHOOK_SECRET` as a GitHub Secret and, for local/manual deploys, as a Cloudflare Worker secret:

```powershell
npx wrangler secret put WEBHOOK_SECRET
```

## Local Deploy

For local Wrangler usage:

```powershell
copy cloudflare\wrangler.toml.template wrangler.toml
npm.cmd test
npx wrangler d1 migrations apply <database-name> --remote
npx wrangler deploy
```

`wrangler.toml` is intentionally ignored because it contains account-specific resource bindings.
