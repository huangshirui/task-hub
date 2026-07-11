# Task Hub Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-managed runner identity, reliable online status, authenticated runner/task administration APIs, log inspection, and a responsive Worker-hosted management console.

**Architecture:** Extend the existing `TaskStore` and `TaskHubService` boundaries so both in-memory tests and D1/R2 production storage expose the same management operations. Keep runner protocol routes compatible, use authenticated claim polling as the online heartbeat, and serve a dependency-free HTML/CSS/JS console directly from the Worker.

**Tech Stack:** Cloudflare Workers, TypeScript, D1, R2, Queue, Node test runner, Python unittest, static HTML/CSS/JavaScript.

---

## File Map

- Create `cloudflare/migrations/0002_admin_console.sql`: add runner names and list-query indexes.
- Modify `src/worker/types.ts`: registration input, persisted runner, management query, pagination, and log types.
- Create `src/worker/security.ts`: runner credential hashing and timing-safe verification.
- Modify `src/worker/in-memory-store.ts`: implement management storage operations for service tests.
- Modify `src/worker/d1-store.ts`: implement D1 runner/task queries, heartbeat updates, and R2 log reads.
- Modify `src/worker/task-service.ts`: generated IDs, hashed credentials, online status, filtering, details, and logs.
- Create `src/worker/admin-page.ts`: management page document, styles, and browser behavior.
- Modify `src/worker/index.ts`: admin authentication, management routes, and `/admin` page route.
- Create `tests/worker/admin-service.test.ts`: service behavior and status boundary tests.
- Create `tests/worker/admin-routes.test.ts`: admin authentication and HTTP contract tests.
- Create `tests/worker/admin-page.test.ts`: page structure and security regression tests.
- Create `tests/worker/d1-store.test.ts`: SQL binding and R2 log retrieval tests.
- Modify `tests/worker/runner-registration.test.ts`: generated IDs and hashed persistence tests.
- Modify `runner/platforms/ubuntu_server/install.sh`: optional runner ID and response persistence.
- Modify `runner/taskhub_runner/platforms/windows/setup.py`: allow setup after server-generated identity.
- Modify `runner/taskhub_runner/platforms/windows/tray.py`: parse and persist registration response ID.
- Modify `runner/tests/test_ubuntu_installer.py`: generated-ID installer contract tests.
- Modify `runner/tests/test_platform_layout.py`: Windows generated-ID persistence tests.
- Modify `README.md`, `docs/configuration.md`, `docs/deployment.md`, and platform READMEs: document admin token, APIs, status semantics, and registration migration.

### Task 1: Domain Types And Credential Security

**Files:**
- Modify: `src/worker/types.ts`
- Create: `src/worker/security.ts`
- Test: `tests/worker/admin-service.test.ts`

- [ ] **Step 1: Write failing credential and generated-registration tests**

Add tests that call `hashRunnerCredential("runner-secret")`, assert the result differs from the secret, verify the correct secret, reject a wrong secret, and register a runner without `runnerId` through `TaskHubService` expecting a `runner_` ID and name fallback.

```ts
test("runner credentials are hashed and verified", async () => {
  const hash = await hashRunnerCredential("runner-secret");
  assert.notEqual(hash, "runner-secret");
  assert.equal(await verifyRunnerCredential("runner-secret", hash), true);
  assert.equal(await verifyRunnerCredential("wrong", hash), false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd run build`

Expected: TypeScript fails because `security.ts`, optional registration identity, and persisted runner types do not exist.

- [ ] **Step 3: Add explicit domain types and security helpers**

Define separate `RunnerRegistrationInput` and `RunnerRecord` types. `RunnerRecord` contains `credentialHash`, `name`, `lastHeartbeatAt`, `createdAt`, and `updatedAt`; it never exposes a plaintext credential. Add `RunnerStatus`, `RunnerView`, `TaskListQuery`, `RunnerListQuery`, `Page<T>`, and `TaskLogResult`.

Implement SHA-256 hex hashing and constant-time comparison in `security.ts` using Web Crypto:

```ts
export async function hashRunnerCredential(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd run test:worker`

Expected: credential tests pass; existing compile failures caused by the changed store contract are addressed in Task 2 before proceeding.

### Task 2: Store Contract, Migration, Pagination, And Logs

**Files:**
- Create: `cloudflare/migrations/0002_admin_console.sql`
- Modify: `src/worker/in-memory-store.ts`
- Modify: `src/worker/d1-store.ts`
- Test: `tests/worker/d1-store.test.ts`
- Test: `tests/worker/admin-service.test.ts`

- [ ] **Step 1: Write failing store tests**

Cover runner upsert without credential disclosure, `touchRunnerHeartbeat`, deterministic runner/task ordering, cursor continuation, filters, current-task lookup, and R2 log flattening with one malformed object.

```ts
const logs = await store.getTaskLogs("task-a");
assert.deepEqual(logs.entries.map((entry) => entry.message), ["first", "second"]);
assert.equal(logs.invalidObjects, 1);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm.cmd run test:worker`

Expected: failures report missing `listRunners`, `listTasks`, `touchRunnerHeartbeat`, `findCurrentTask`, and `getTaskLogs` methods.

- [ ] **Step 3: Add migration and in-memory implementation**

Create the migration exactly as specified:

```sql
ALTER TABLE runners ADD COLUMN name TEXT;
CREATE INDEX idx_runners_last_heartbeat ON runners(last_heartbeat_at DESC, runner_id ASC);
CREATE INDEX idx_tasks_created ON tasks(created_at DESC, task_id DESC);
```

Implement cloned return values, stable descending task order, stable runner order, opaque base64url cursors, and filter-before-pagination behavior in memory.

- [ ] **Step 4: Implement D1 and R2 operations**

Use parameter binding for every filter. Query one extra row to determine `nextCursor`. Never select `credential_hash` for management views. Extend the R2 binding with `list` and `get`; parse each object as `LogEntry[]`, count malformed objects, flatten entries, and sort by timestamp then object key.

- [ ] **Step 5: Run focused and existing Worker tests**

Run: `npm.cmd run test:worker`

Expected: all Worker tests pass.

### Task 3: Service Registration, Online Status, And Management Queries

**Files:**
- Modify: `src/worker/task-service.ts`
- Test: `tests/worker/admin-service.test.ts`
- Modify: `tests/worker/task-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Add separate tests for explicit ID preservation, generated ID, hashed storage, successful claim heartbeat with no task, task heartbeat refresh, failed authentication not refreshing heartbeat, exact 15/60 second status boundaries, runner detail recent tasks, task filters, and missing records.

```ts
await service.claimTask("runner-a", "secret-a");
assert.equal(store.runners.get("runner-a")?.lastHeartbeatAt, "2026-07-11T00:00:00.000Z");
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd run test:worker`

Expected: new management service methods and heartbeat behavior are missing.

- [ ] **Step 3: Implement minimal service behavior**

Generate `runner_${crypto.randomUUID()}` only when input omits the ID. Hash credentials before store writes. Verify hashes during runner authentication. Touch heartbeat only after successful authentication. Derive statuses without persisting a boolean.

Expose service methods:

```ts
listRunners(query: RunnerListQuery): Promise<Page<RunnerView>>
getRunnerView(runnerId: string): Promise<RunnerDetail | undefined>
listTasks(query: TaskListQuery): Promise<Page<TaskRecord>>
getTaskForAdmin(taskId: string): Promise<TaskRecord | undefined>
getTaskLogs(taskId: string): Promise<TaskLogResult | undefined>
```

- [ ] **Step 4: Run and verify GREEN**

Run: `npm.cmd run test:worker`

Expected: all service and prior lifecycle tests pass.

### Task 4: Authenticated Management HTTP API

**Files:**
- Modify: `src/worker/index.ts`
- Create: `tests/worker/admin-routes.test.ts`
- Modify: `tests/worker/runner-registration.test.ts`

- [ ] **Step 1: Write failing route tests**

Build a reusable fake D1/R2/Queue environment. Verify every `/api/admin/*` route returns `401` for absent and wrong tokens, list routes return page objects, detail routes return `404`, malformed filters return `400`, and admin submission returns `202`.

```ts
const response = await worker.fetch(new Request("https://example/api/admin/runners"), env as never);
assert.equal(response.status, 401);
assert.deepEqual(await response.json(), { error: "unauthorized" });
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd run test:worker`

Expected: `/api/admin/*` routes return `404`.

- [ ] **Step 3: Implement route parsing and authentication**

Add `TASK_HUB_ADMIN_TOKEN` to `Env`. Authenticate before route-specific parsing. Add helpers for validated enums, bounded `limit` values from 1 to 100, and opaque cursors. Keep a stable `{ error: string }` response shape.

Update registration response to include `{ runnerId, name }` and update its tests to assert that the fake database receives a credential hash rather than the original secret.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm.cmd run test:worker`

Expected: all route and registration tests pass.

### Task 5: Worker-Hosted Management Page

**Files:**
- Create: `src/worker/admin-page.ts`
- Modify: `src/worker/index.ts`
- Create: `tests/worker/admin-page.test.ts`

- [ ] **Step 1: Write failing page contract tests**

Request `/admin` and assert HTML content type, responsive viewport metadata, token form, runner list, task table, detail panel, self-check command, status labels, and no embedded admin token. Assert `/admin/` behaves identically.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd run test:worker`

Expected: `/admin` returns `404`.

- [ ] **Step 3: Implement the static console**

Export `adminPageResponse()` from `admin-page.ts`. Use semantic HTML, CSS variables, Lucide-compatible inline text symbols only where no package is available, fixed responsive grid tracks, accessible labels, and no nested cards.

Browser JavaScript must:

- save the token in `sessionStorage`;
- call `/api/admin/runners` and `/api/admin/tasks` with Bearer auth;
- populate filters and deterministic selection;
- fetch detail and logs on row selection;
- submit `selfcheck` for the selected runner;
- poll every five seconds only while visible;
- clear the token and return to sign-in on `401`;
- render explicit loading, empty, and network-error states.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm.cmd run test:worker`

Expected: page contract and all Worker tests pass.

### Task 6: Generated Runner IDs In Ubuntu And Windows Installers

**Files:**
- Modify: `runner/platforms/ubuntu_server/install.sh`
- Modify: `runner/taskhub_runner/platforms/windows/setup.py`
- Modify: `runner/taskhub_runner/platforms/windows/tray.py`
- Modify: `runner/tests/test_ubuntu_installer.py`
- Modify: `runner/tests/test_platform_layout.py`

- [ ] **Step 1: Write failing installer tests**

Assert Ubuntu no longer requires `--runner-id` unless `--no-register` is used, parses `runnerId` from the registration JSON response, and writes it to config. Add a Windows unit test where a mocked registration response returns a generated ID and setup persists that ID.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd run test:runner`

Expected: installer assertions fail because both platforms currently require a caller-supplied ID.

- [ ] **Step 3: Implement Ubuntu response handling**

Allow an empty `RUNNER_ID` during normal registration. Omit `runnerId` from the JSON request when empty, capture the response body, validate a non-empty returned `runnerId`, and use it for all generated paths/config output. Continue requiring an ID with `--no-register`.

- [ ] **Step 4: Implement Windows response handling**

Make `--runner-id` optional for registered setup. Register before calling `setup_user_runner`, return the response ID from `register_current_config`, and write configuration with the final ID. Preserve explicit ID and `--no-register` behavior.

- [ ] **Step 5: Run and verify GREEN**

Run: `npm.cmd run test:runner`

Expected: all Python and installer contract tests pass.

### Task 7: Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/deployment.md`
- Modify: `runner/platforms/ubuntu_server/README.md`
- Modify: `runner/platforms/windows/README.md`

- [ ] **Step 1: Update operator documentation**

Document `TASK_HUB_ADMIN_TOKEN`, `/admin`, all management endpoints, status thresholds, generated and explicit Runner IDs, one-time re-registration after credential hashing rollout, and safe token handling. Add the admin secret to deployment setup commands and GitHub secret lists.

- [ ] **Step 2: Run whitespace and complete automated gates**

Run:

```powershell
git diff --check
npm.cmd test
```

Expected: no whitespace errors; all Worker and Runner tests pass.

- [ ] **Step 3: Start a local HTTP harness and perform visual verification**

Serve the built Worker with a local fake binding harness on an available localhost port. Open `/admin`, authenticate with the fake admin token, and verify runner selection, task filtering, task detail, logs, and self-check submission.

Capture desktop and mobile screenshots. Confirm the page is nonblank, content does not overlap or clip, controls retain stable dimensions, and the mobile layout remains usable.

- [ ] **Step 4: Review final diff and commit implementation**

Run `git status --short`, inspect every changed file, ensure no credentials or generated runtime data are present, then commit the implementation with a scoped message.
