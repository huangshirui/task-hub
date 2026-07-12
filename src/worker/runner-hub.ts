import type {
  AdminHubEvent,
  RunnerHubAttachment,
  RunnerHubPresence,
  TaskAvailableEvent,
} from "./types.js";

const RUNNER_TAG = "runner";
const ADMIN_TAG = "admin";
const MAX_TAG_LENGTH = 256;
const ROLE_HEADER = "x-task-hub-role";
const RUNNER_ID_HEADER = "x-task-hub-runner-id";

type WebSocketPairValue = { 0: WebSocket; 1: WebSocket };
type WebSocketPairFactory = () => WebSocketPairValue;

export class RunnerHub {
  constructor(
    private readonly ctx: DurableObjectState,
    _env?: unknown,
    private readonly webSocketPairFactory: WebSocketPairFactory = () => new WebSocketPair(),
  ) {}

  fetch(request: Request): Response {
    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const role = request.headers.get(ROLE_HEADER);
    const runnerId = request.headers.get(RUNNER_ID_HEADER);
    if ((role !== "admin" && role !== "runner") || (role === "runner" && !runnerId)) {
      return new Response("Invalid connection metadata", { status: 400 });
    }

    const pair = this.webSocketPairFactory();
    if (role === "runner") {
      this.acceptRunner(pair[1], runnerId as string);
    } else {
      this.acceptAdmin(pair[1]);
    }

    const headers = role === "admin" ? { "sec-websocket-protocol": "taskhub-admin" } : undefined;
    return new Response(null, { status: 101, headers, webSocket: pair[0] });
  }

  acceptRunner(socket: WebSocket, runnerId: string): void {
    for (const existing of getRunnerWebSockets(this.ctx, runnerId)) {
      existing.serializeAttachment(null);
      existing.close(1000, "replaced");
    }

    const attachment: RunnerHubAttachment = { role: "runner", runnerId };
    socket.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(socket, [RUNNER_TAG, runnerTag(runnerId)]);
    this.broadcastAdminEvent({ type: "runner_presence_changed", runnerId, online: true });
  }

  acceptAdmin(socket: WebSocket): void {
    const attachment: RunnerHubAttachment = { role: "admin" };
    socket.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(socket, [ADMIN_TAG]);
  }

  notifyTaskAvailable(runnerId: string, taskId: string): number {
    const event: TaskAvailableEvent = { type: "task_available", taskId };
    return sendEvent(getRunnerWebSockets(this.ctx, runnerId), event);
  }

  broadcastAdminEvent(event: AdminHubEvent): number {
    return sendEvent(this.ctx.getWebSockets(ADMIN_TAG), projectAdminEvent(event));
  }

  getPresence(): RunnerHubPresence {
    const runnerAttachments = this.ctx
      .getWebSockets(RUNNER_TAG)
      .map(readAttachment)
      .filter((attachment): attachment is Extract<RunnerHubAttachment, { role: "runner" }> => attachment?.role === "runner");
    const adminConnections = this.ctx
      .getWebSockets(ADMIN_TAG)
      .map(readAttachment)
      .filter((attachment) => attachment?.role === "admin").length;

    return {
      onlineRunnerIds: [...new Set(runnerAttachments.map((attachment) => attachment.runnerId))].sort(),
      runnerConnections: runnerAttachments.length,
      adminConnections,
    };
  }

  webSocketClose(socket: WebSocket): void {
    this.handleDisconnectedSocket(socket);
  }

  webSocketError(socket: WebSocket): void {
    this.handleDisconnectedSocket(socket);
    try {
      socket.close(1011, "connection error");
    } catch {
      // The runtime may already have closed an errored socket.
    }
  }

  private handleDisconnectedSocket(socket: WebSocket): void {
    const attachment = readAttachment(socket);
    socket.serializeAttachment(null);
    if (attachment?.role === "runner" && getRunnerWebSockets(this.ctx, attachment.runnerId).length === 0) {
      this.broadcastAdminEvent({
        type: "runner_presence_changed",
        runnerId: attachment.runnerId,
        online: false,
      });
    }
  }
}

function runnerTag(runnerId: string): string {
  const prefix = "runner:";
  return `${prefix}${runnerId.slice(0, MAX_TAG_LENGTH - prefix.length)}`;
}

function getRunnerWebSockets(ctx: DurableObjectState, runnerId: string): WebSocket[] {
  return ctx.getWebSockets(runnerTag(runnerId)).filter((socket) => {
    const attachment = readAttachment(socket);
    return attachment?.role === "runner" && attachment.runnerId === runnerId;
  });
}

function readAttachment(socket: WebSocket): RunnerHubAttachment | undefined {
  try {
    const attachment = socket.deserializeAttachment();
    if (attachment?.role === "admin") {
      return { role: "admin" };
    }
    if (attachment?.role === "runner" && typeof attachment.runnerId === "string") {
      return { role: "runner", runnerId: attachment.runnerId };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function projectAdminEvent(event: AdminHubEvent): AdminHubEvent {
  if (event.type === "task_changed") {
    return {
      type: "task_changed",
      taskId: event.taskId,
      runnerId: event.runnerId,
      status: event.status,
    };
  }
  return {
    type: "runner_presence_changed",
    runnerId: event.runnerId,
    online: event.online,
  };
}

function sendEvent(sockets: WebSocket[], event: TaskAvailableEvent | AdminHubEvent): number {
  const message = JSON.stringify(event);
  let delivered = 0;
  for (const socket of sockets) {
    try {
      socket.send(message);
      delivered += 1;
    } catch {
      socket.close(1011, "send failed");
    }
  }
  return delivered;
}
