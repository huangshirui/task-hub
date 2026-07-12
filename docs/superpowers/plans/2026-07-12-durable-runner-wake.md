# Durable Runner Wake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace frequent idle Runner and admin polling with a hibernatable Durable Object WebSocket wake channel while preserving D1 as the task source of truth and low-frequency HTTP claim fallback.

**Architecture:** A single SQLite-backed Durable Object owns hibernatable Runner and admin WebSockets. The Queue consumer publishes a runner-specific wake event only after a task reaches `pending_runner`; Runners then use the existing authenticated claim API. Runner task execution renews its lease by HTTP heartbeat, and a ten-minute jittered fallback claim preserves delivery when WebSocket notification is unavailable.

**Tech Stack:** Cloudflare Workers, Durable Objects WebSocket Hibernation API, D1, Queues, R2, TypeScript, Python standard library WebSocket client support, Node test runner, Python unittest.

---

### Task 1: Durable Object Connection Hub

**Files:**
- Create: `src/worker/runner-hub.ts`
- Create: `tests/worker/runner-hub.test.ts`
- Modify: `src/worker/types.ts`

- [ ] Write failing tests for authenticated Runner/admin connection metadata, duplicate Runner replacement, targeted wake delivery, admin event broadcast, and online snapshots.
- [ ] Run `npm.cmd run test:worker` and confirm failures are caused by the missing hub.
- [ ] Implement `RunnerHub` using `ctx.acceptWebSocket`, serialized attachments, tags, and no timers so the object remains hibernatable.
- [ ] Run `npm.cmd run test:worker` and confirm all Worker tests pass.

### Task 2: Worker and Queue Integration

**Files:**
- Modify: `src/worker/index.ts`
- Modify: `src/worker/task-service.ts`
- Modify: `tests/worker/admin-routes.test.ts`
- Create: `tests/worker/realtime-routes.test.ts`

- [ ] Write failing route tests for Runner WebSocket bearer authentication, short-lived signed admin WebSocket tickets carried as a subprotocol rather than a URL secret, `/api/admin/presence`, and Queue-to-hub notifications after `pending_runner` is durable.
- [ ] Run the focused Worker tests and confirm the expected failures.
- [ ] Add the Durable Object binding, Runner WebSocket upgrade route, authenticated admin ticket endpoint, admin WebSocket upgrade route, presence route, and Queue notification RPC.
- [ ] Emit task lifecycle events only for meaningful transitions, keeping task payloads out of WebSocket messages.
- [ ] Run the Worker suite and confirm green.

### Task 3: Runner Wake and Lease Heartbeat

**Files:**
- Modify: `runner/taskhub_runner/client.py`
- Modify: `runner/taskhub_runner/core.py`
- Modify: `runner/taskhub_runner/cli.py`
- Modify: `runner/taskhub_runner/config.py`
- Modify: `runner/taskhub_runner/platforms/windows/controller.py`
- Modify: `runner/taskhub_runner/platforms/windows/setup.py`
- Modify: `runner/platforms/ubuntu_server/install.sh`
- Modify: `runner/tests/test_runner.py`
- Modify: `runner/tests/test_cli.py`
- Modify: `runner/tests/test_windows_controller.py`
- Modify: `runner/tests/test_config.py`

- [ ] Write failing tests for wake-triggered claim, ten-minute jittered fallback, reconnect backoff, and 20-second heartbeat during a blocking handler.
- [ ] Run `npm.cmd run test:runner` and confirm failures are feature-related.
- [ ] Implement a dependency-light WebSocket wake client, keeping task execution serial and credentials out of process arguments.
- [ ] Run task heartbeat on a bounded background thread and stop it before complete.
- [ ] Preserve `--once` behavior and installer compatibility while adding fallback and heartbeat configuration defaults.
- [ ] Run the Runner suite and confirm green.

### Task 4: Event-Driven Admin Console

**Files:**
- Modify: `src/worker/admin-page.ts`
- Modify: `tests/worker/admin-page.test.ts`

- [ ] Write failing tests that require an admin WebSocket, event-driven list refresh, reconnect backoff, hidden-tab behavior, and no fixed five-second list poll.
- [ ] Run the focused test and confirm it fails against the polling implementation.
- [ ] Implement initial HTTP load followed by WebSocket invalidation events and bounded reconnect fallback.
- [ ] Keep manual refresh and stale-response protections.
- [ ] Run the Worker suite and confirm green.

### Task 5: Deployment Contract and Documentation

**Files:**
- Modify: `cloudflare/wrangler.toml.template`
- Modify: `.github/workflows/deploy-worker.yml`
- Modify: `tests/worker/workflow-config.test.ts`
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/deployment.md`
- Modify: `docs/runner-handlers.md`
- Modify: `runner/config/runner.example.json`
- Modify: platform-specific Runner examples and READMEs

- [ ] Write failing workflow tests for SQLite Durable Object binding and migration configuration and for removal of the unused KV binding.
- [ ] Run the workflow test and confirm the missing binding failure.
- [ ] Add Durable Object configuration and a stable migration tag to both template and generated CI config.
- [ ] Document WebSocket wake, protocol ping, fallback claim, execution heartbeat, lease behavior, and rollback.
- [ ] Run all tests.

### Task 6: Runtime Verification and Delivery

**Files:**
- Modify only files required by failures found during verification.

- [ ] Run `npm.cmd test`, `git diff --check`, and a deployment dry run when credentials permit.
- [ ] Review the complete diff for credential exposure, duplicate task execution, reconnect storms, and non-hibernatable timers.
- [ ] Commit the feature branch, merge to `main`, rerun the complete test suite, and push `origin/main`.
- [ ] Wait for GitHub Actions deployment success and inspect the deployed Worker version.
- [ ] Verify Runner WebSocket authentication, online presence, task wake, 20-second heartbeat, completion, logs, admin updates, fallback claim, and unauthorized rejection against production.
