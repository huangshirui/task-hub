import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../../src/worker/index.js";

const runnerRegistration = {
  runnerId: "runner-linux",
  credential: "runner-secret",
  platform: "linux",
  labels: ["ubuntu-server"],
  taskTypes: ["shell"],
  capabilities: ["shell.registered_scripts"],
};

test("runner registration fails closed when registration token is not configured", async () => {
  const env = createEnv();
  const response = await registerRunner(env, "admin-secret");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "runner registration is disabled" });
  assert.equal(env.registrations.length, 0);
});

test("runner registration rejects invalid registration token", async () => {
  const env = createEnv({ RUNNER_REGISTRATION_TOKEN: "admin-secret" });
  const response = await registerRunner(env, "wrong-secret");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid runner registration token" });
  assert.equal(env.registrations.length, 0);
});

test("runner registration accepts valid registration token", async () => {
  const env = createEnv({ RUNNER_REGISTRATION_TOKEN: "admin-secret" });
  const response = await registerRunner(env, "admin-secret");

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { runnerId: "runner-linux" });
  assert.equal(env.registrations.length, 1);
  assert.equal(env.registrations[0]?.runnerId, "runner-linux");
  assert.equal(env.registrations[0]?.credential, "runner-secret");
});

function registerRunner(env: ReturnType<typeof createEnv>, token: string): Promise<Response> {
  return worker.fetch(
    new Request("https://task-hub.example/runners/register", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(runnerRegistration),
    }),
    env as never,
  );
}

function createEnv(overrides: { RUNNER_REGISTRATION_TOKEN?: string } = {}) {
  const registrations: Array<typeof runnerRegistration> = [];
  return {
    registrations,
    RUNNER_REGISTRATION_TOKEN: overrides.RUNNER_REGISTRATION_TOKEN,
    TASK_SUBMISSIONS: { send: async () => undefined },
    TASK_OBJECTS: { put: async () => undefined },
    TASK_DB: {
      prepare() {
        return {
          bind(...values: unknown[]) {
            return {
              async run() {
                registrations.push({
                  runnerId: String(values[0]),
                  credential: String(values[1]),
                  platform: values[2] as "linux",
                  labels: JSON.parse(String(values[3])) as string[],
                  taskTypes: JSON.parse(String(values[4])) as ["shell"],
                  capabilities: JSON.parse(String(values[5])) as string[],
                });
              },
              async first() {
                return undefined;
              },
            };
          },
        };
      },
    },
  };
}
