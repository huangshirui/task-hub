# Task Hub Admin Console Design

## Objective

Complete the operational surface needed to discover runners, determine whether they are online, inspect task execution, and exercise the system through a small management page.

The work must preserve existing runner installations and task clients while adding a secure management API and a browser-based test console.

## Scope

This feature includes:

- server-generated runner IDs when an installer does not provide one;
- backward-compatible support for explicitly supplied runner IDs;
- a human-readable runner name;
- runner credential hashing for new and re-registered runners;
- reliable online status derived from authenticated runner polling;
- authenticated runner and task management APIs;
- task log retrieval from R2;
- self-check task submission from the management API;
- a responsive management page served directly by the Worker;
- installer changes that persist a generated runner ID;
- migrations, tests, configuration documentation, and deployment documentation.

This feature does not add multi-user accounts, RBAC, WebSockets, historical analytics, arbitrary command execution, or remote handler installation.

## Architecture

The Cloudflare Worker remains the single HTTP entry point. D1 remains the source of truth for runner registrations and task state, while R2 remains the source of truth for uploaded task logs.

The Worker serves a static management application at `/admin`. The application calls authenticated JSON endpoints under `/api/admin`. It uses no frontend framework and introduces no separate frontend build pipeline.

Existing runner protocol routes remain in place. Existing `POST /tasks` and `GET /tasks/:taskId` routes remain compatible so current clients continue to work.

## Authentication

Management endpoints use a new Worker secret named `TASK_HUB_ADMIN_TOKEN`.

Requests to `/api/admin/*` must include:

```http
Authorization: Bearer <TASK_HUB_ADMIN_TOKEN>
```

The management page asks the operator for this token. It stores the value in `sessionStorage`, sends it only in the `Authorization` header, and never embeds it in page source, query strings, or persistent browser storage.

Runner registration continues to use `RUNNER_REGISTRATION_TOKEN`. Runner claim, task heartbeat, log upload, and completion continue to use each runner's credential. These credentials are not interchangeable.

## Runner Identity And Registration

`runnerId` becomes optional in the registration input:

- If supplied, the Worker uses it. This preserves current installers and allows stable operator-defined IDs.
- If omitted, the Worker creates `runner_<uuid>` and returns it in the registration response.

Registration also accepts an optional `name`. If no name is supplied, the display name defaults to the final runner ID.

The response is:

```json
{
  "runnerId": "runner_7db26f65-2ab1-4b60-9967-a9a1ca9e1844",
  "name": "Study Windows PC"
}
```

Installers must read the response and write the returned ID into `runner.json`. Existing command-line `--runner-id` arguments become optional, not invalid.

Runner credentials are hashed with SHA-256 before being stored in `credential_hash`. Authentication hashes the presented credential and compares hashes using a timing-safe byte comparison. Existing plaintext registrations cannot be converted without the original secret, so an existing runner must be re-registered once after deployment. The registration flow replaces the legacy value with a hash.

## Online Status

The Runner already polls `POST /runners/:runnerId/claim` while idle. Every successfully authenticated claim updates `last_heartbeat_at`, even when there is no task to return. Task heartbeats also update the same field.

The management API derives status relative to Worker time:

- `online`: last heartbeat is no more than 15 seconds old;
- `stale`: last heartbeat is more than 15 seconds and no more than 60 seconds old;
- `offline`: no heartbeat exists or it is more than 60 seconds old.

The stored record does not contain a mutable `online` boolean. This avoids stale state when a runner disappears without sending a final message.

## Management API

### List Runners

```http
GET /api/admin/runners?status=online&limit=50&cursor=<opaque>
```

Returns runner ID, name, platform, labels, supported task types, capabilities, last heartbeat, derived status, current task summary, creation time, and update time. The response includes an opaque cursor when another page exists.

### Runner Detail

```http
GET /api/admin/runners/:runnerId
```

Returns the same runner fields plus recent tasks assigned to that runner. Credentials and credential hashes are never returned.

### List Tasks

```http
GET /api/admin/tasks?runnerId=<id>&status=running&type=selfcheck&limit=50&cursor=<opaque>
```

All filters are optional. Results are ordered by `created_at DESC, task_id DESC`. Invalid status, type, limit, or cursor values return `400` with a clear error.

### Task Detail

```http
GET /api/admin/tasks/:taskId
```

Returns the complete task record needed by the console, including payload, result, error, lease expiry, and timestamps.

### Task Logs

```http
GET /api/admin/tasks/:taskId/logs
```

Lists R2 objects under `tasks/<taskId>/logs/`, loads them in key order, validates each JSON batch, and returns a flattened chronological list. Malformed log objects are skipped and reported in an `invalidObjects` count so one bad object does not hide all valid logs.

### Submit Test Task

```http
POST /api/admin/tasks
```

The request uses the existing task submission contract. The console initially submits only `selfcheck`. The server still validates the runner registration and advertised task type through the normal queue flow.

## Data Model

A new D1 migration adds:

```sql
ALTER TABLE runners ADD COLUMN name TEXT;
CREATE INDEX idx_runners_last_heartbeat ON runners(last_heartbeat_at DESC, runner_id ASC);
CREATE INDEX idx_tasks_created ON tasks(created_at DESC, task_id DESC);
```

The existing `last_heartbeat_at` column becomes active. Existing rows receive their display fallback in application code, so the migration does not need to rewrite every row.

Store interfaces gain focused methods for listing runners, touching runner heartbeat, listing tasks, finding a current task, and reading log batches. In-memory and D1/R2 implementations must obey the same contracts.

## Management Page

The page is a compact operational console rather than a marketing surface. It uses an industrial, light-neutral palette with green, amber, red, and blue reserved for status and actions.

The first viewport contains:

- a narrow header with service name, connection state, last refresh time, and refresh control;
- a runner rail showing name, ID, platform, capabilities, and online status;
- a task workspace with filters and a dense task table;
- a detail panel for payload, result, error, lease information, and logs;
- a `Run self-check` command for the selected runner.

The page has explicit loading, empty, unauthorized, network-error, and retry states. Selection and filters do not resize the main layout. On narrow screens, the runner rail and task detail become sequential full-width sections; text and controls must not overlap.

The browser polls runner and task lists every five seconds while the page is visible. It pauses polling when the tab is hidden and refreshes immediately when visibility returns.

## Error Handling

- Missing or invalid admin credentials return `401` without disclosing which token check failed.
- Unknown runners and tasks return `404`.
- Invalid filters and bodies return `400` with a stable JSON error shape.
- Registration without a Worker registration secret remains fail-closed.
- Runner authentication failure does not update heartbeat.
- R2 log retrieval errors return `500`; malformed individual objects do not fail the complete response.
- The management page clears its stored token and returns to the sign-in state after a `401`.

## Compatibility And Rollout

The migration must be applied before deploying the new Worker code. Existing explicit runner IDs remain valid. Existing Runner credentials must be refreshed by re-running registration because legacy rows contain unhashed values.

Ubuntu and Windows installers keep accepting `--runner-id`. When it is omitted, they register first, save the returned ID, and then create local configuration. Documentation must explain both deterministic and generated identity modes.

The deploy workflow continues to deploy only Worker, Cloudflare, package, and Worker-test changes. Runner-only changes do not independently trigger Worker deployment.

## Verification

Automated tests must prove:

- registration generates an ID when omitted and preserves an explicit ID;
- credentials are stored hashed and authenticate correctly;
- authenticated claims and task heartbeats update runner heartbeat;
- status boundaries produce online, stale, and offline results;
- runner and task lists filter and paginate deterministically;
- management endpoints reject missing or invalid admin tokens;
- runner/task detail endpoints return `404` for missing records;
- task log retrieval flattens valid batches and reports malformed objects;
- Windows and Ubuntu installers persist the Worker-returned runner ID;
- the existing task lifecycle still passes unchanged.

The final verification gate is:

```powershell
npm.cmd test
```

The management page must also be served from a local Worker-compatible HTTP harness and visually checked at desktop and mobile viewport sizes for blank output, overlap, clipping, and usable task selection.
