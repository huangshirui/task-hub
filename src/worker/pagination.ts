export interface TaskCursor {
  createdAt: string;
  taskId: string;
}

export function encodeRunnerCursor(runnerId: string): string {
  return encode({ runnerId });
}

export function decodeRunnerCursor(cursor: string | undefined): string | undefined {
  if (!cursor) {
    return undefined;
  }
  const value = decode(cursor);
  if (typeof value.runnerId !== "string" || !value.runnerId) {
    throw new ValidationError("invalid cursor");
  }
  return value.runnerId;
}

export function encodeTaskCursor(cursor: TaskCursor): string {
  return encode(cursor);
}

export function decodeTaskCursor(cursor: string | undefined): TaskCursor | undefined {
  if (!cursor) {
    return undefined;
  }
  const value = decode(cursor);
  if (typeof value.createdAt !== "string" || !value.createdAt || typeof value.taskId !== "string" || !value.taskId) {
    throw new ValidationError("invalid cursor");
  }
  return { createdAt: value.createdAt, taskId: value.taskId };
}

function encode(value: object): string {
  return btoa(JSON.stringify(value));
}

function decode(cursor: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(atob(cursor)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ValidationError("invalid cursor");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationError("invalid cursor");
  }
}
import { ValidationError } from "./errors.js";
