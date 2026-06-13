# Configuration

Task Hub keeps committed templates separate from real deployment and machine credentials.

## Cloudflare

Committed:

- `cloudflare/wrangler.toml.template`
- `cloudflare/migrations/*.sql`

Ignored:

- `wrangler.toml`
- `.dev.vars`
- `.env*`

For local deploys, copy the template:

```powershell
copy cloudflare\wrangler.toml.template wrangler.toml
```

Then replace the `{{...}}` placeholders with your Cloudflare resource names and IDs.

## GitHub Variables

Set these as repository variables:

```text
CF_WORKER_NAME
CF_COMPATIBILITY_DATE
CF_QUEUE_NAME
CF_D1_DATABASE_NAME
CF_D1_DATABASE_ID
CF_R2_BUCKET_NAME
CF_KV_NAMESPACE_ID
```

The deploy workflow generates a temporary `wrangler.toml` from these variables.

## GitHub Secrets

Set these as repository secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
WEBHOOK_SECRET
```

Do not commit API tokens, Worker secrets, Runner credentials, or real local runner config.

## Runner

Committed examples:

- `runner/config/runner.example.json`
- `runner/config/scripts.example.json`

Ignored local files:

- `runner/config/runner.json`
- `runner/config/scripts.json`

Runner credentials should be injected with `credentialEnv`:

```json
{
  "credentialEnv": "TASK_HUB_RUNNER_TOKEN"
}
```

Then set the environment variable on the machine running the Runner.
