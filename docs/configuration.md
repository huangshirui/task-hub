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
```

The deploy workflow generates a temporary `wrangler.toml` from these variables.

## GitHub Secrets

Set these as repository secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
WEBHOOK_SECRET
RUNNER_REGISTRATION_TOKEN
TASK_HUB_ADMIN_TOKEN
```

Do not commit API tokens, Worker secrets, Runner credentials, or real local runner config.

`RUNNER_REGISTRATION_TOKEN` protects `POST /runners/register`. Ubuntu one-line installs prompt for this value, use it once to register the runner, and then store only the generated runner credential on the runner host.

`TASK_HUB_ADMIN_TOKEN` protects every endpoint under `/api/admin/*`. The `/admin` page requests this value from the operator and stores it only in browser `sessionStorage`. Do not reuse `RUNNER_REGISTRATION_TOKEN` as the admin token.

Runner credentials are stored as SHA-256 hashes in D1. Existing Runner rows created before this behavior was deployed contain legacy plaintext values and must be re-registered once.

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

Continuous Runners use these timing settings:

```json
{
  "fallbackPollIntervalSeconds": 600,
  "fallbackJitterRatio": 0.1,
  "heartbeatIntervalSeconds": 20
}
```

The Runner normally receives task notifications over a hibernatable WebSocket. The fallback claim runs every 9-11 minutes with the defaults above. `heartbeatIntervalSeconds` applies only while a task is running and renews its 90-second lease.
