export function adminPageResponse(): Response {
  return new Response(adminDocument, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

const adminDocument = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Task Hub Console</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #f4f3ef;
      --surface: #ffffff;
      --surface-muted: #ebeae5;
      --ink: #181b1d;
      --muted: #667075;
      --line: #ced1cd;
      --line-strong: #9da4a1;
      --blue: #165d83;
      --blue-soft: #dcecf4;
      --green: #18704a;
      --green-soft: #dceee4;
      --amber: #9a5b08;
      --amber-soft: #f5e7c9;
      --red: #a03632;
      --red-soft: #f4dedb;
      --shadow: 0 10px 30px rgba(23, 28, 30, 0.12);
    }

    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      background: var(--paper);
      color: var(--ink);
      font-family: Bahnschrift, Aptos, "Segoe UI", sans-serif;
      font-size: 14px;
      letter-spacing: 0;
    }
    button, input, select { font: inherit; letter-spacing: 0; }
    button { cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: 0.48; }
    [hidden] { display: none !important; }

    .auth-view {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background-color: var(--ink);
    }
    .auth-panel {
      width: min(420px, 100%);
      padding: 28px;
      background: var(--surface);
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      box-shadow: var(--shadow);
    }
    .auth-mark {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      margin-bottom: 28px;
      color: white;
      background: var(--blue);
      border-radius: 4px;
      font-weight: 700;
    }
    .auth-panel h1 { margin: 0 0 8px; font-size: 25px; font-weight: 650; }
    .auth-panel p { margin: 0 0 24px; color: var(--muted); line-height: 1.5; }
    .field { display: grid; gap: 7px; }
    .field label { color: var(--muted); font-size: 12px; font-weight: 650; text-transform: uppercase; }
    .field input, .filter-select {
      width: 100%;
      min-height: 38px;
      padding: 8px 10px;
      color: var(--ink);
      background: var(--surface);
      border: 1px solid var(--line-strong);
      border-radius: 4px;
      outline: none;
    }
    .field input:focus, .filter-select:focus { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-soft); }
    .auth-error { min-height: 20px; margin: 10px 0 0; color: var(--red); font-size: 13px; }

    .button {
      min-height: 36px;
      padding: 7px 12px;
      border: 1px solid var(--line-strong);
      border-radius: 4px;
      background: var(--surface);
      color: var(--ink);
      font-weight: 620;
    }
    .button:hover:not(:disabled) { border-color: var(--ink); background: var(--surface-muted); }
    .button-primary { border-color: var(--blue); background: var(--blue); color: white; }
    .button-primary:hover:not(:disabled) { border-color: #0c445f; background: #0c445f; }
    .button-block { width: 100%; margin-top: 18px; }

    .app-shell { min-height: 100vh; display: grid; grid-template-rows: 58px minmax(0, 1fr); }
    .topbar {
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 0 18px;
      background: var(--ink);
      color: white;
      border-bottom: 3px solid var(--blue);
    }
    .brand { display: flex; align-items: baseline; gap: 10px; min-width: 230px; }
    .brand strong { font-size: 18px; font-weight: 680; }
    .brand span { color: #aeb7ba; font-size: 12px; text-transform: uppercase; }
    .topbar-meta { margin-left: auto; display: flex; align-items: center; gap: 12px; color: #c9d0d2; font-size: 12px; }
    .connection { display: inline-flex; align-items: center; gap: 7px; }
    .connection-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--amber); }
    .connection-dot.connected { background: #50c88a; }
    .topbar .button { min-height: 32px; border-color: #596164; background: #252a2c; color: white; }

    .workspace {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(230px, 280px) minmax(470px, 1fr) minmax(310px, 390px);
    }
    .pane { min-width: 0; min-height: 0; background: var(--surface); }
    .runner-pane, .detail-pane { display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .runner-pane { border-right: 1px solid var(--line); }
    .detail-pane { border-left: 1px solid var(--line); }
    .task-pane { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--paper); }
    .pane-head {
      min-height: 62px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      background: var(--surface);
    }
    .pane-head h2 { margin: 0; font-size: 14px; font-weight: 700; text-transform: uppercase; }
    .pane-count { color: var(--muted); font-variant-numeric: tabular-nums; }

    .runner-list { overflow: auto; }
    .runner-item {
      width: 100%;
      min-height: 84px;
      display: grid;
      grid-template-columns: 10px 1fr;
      gap: 10px;
      padding: 13px 14px;
      text-align: left;
      border: 0;
      border-bottom: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
    }
    .runner-item:hover { background: #f7f8f6; }
    .runner-item.selected { background: var(--blue-soft); box-shadow: inset 3px 0 0 var(--blue); }
    .status-bar { width: 4px; height: 100%; min-height: 44px; border-radius: 2px; background: var(--line-strong); }
    .status-bar.online { background: var(--green); }
    .status-bar.stale { background: var(--amber); }
    .status-bar.offline { background: var(--red); }
    .runner-name { display: flex; justify-content: space-between; gap: 8px; font-weight: 680; }
    .runner-id { margin-top: 5px; color: var(--muted); font-family: Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
    .runner-meta { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }

    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 2px 6px;
      border: 1px solid var(--line);
      border-radius: 3px;
      color: var(--muted);
      background: var(--surface-muted);
      font-size: 11px;
      font-weight: 650;
      text-transform: uppercase;
    }
    .badge.online, .badge.succeeded { border-color: #95cbb0; color: var(--green); background: var(--green-soft); }
    .badge.stale, .badge.leased, .badge.running { border-color: #d7b16d; color: var(--amber); background: var(--amber-soft); }
    .badge.offline, .badge.failed, .badge.canceled, .badge.expired { border-color: #d8a29e; color: var(--red); background: var(--red-soft); }
    .badge.queued, .badge.pending_runner { border-color: #9abfd2; color: var(--blue); background: var(--blue-soft); }

    .filters { display: grid; grid-template-columns: minmax(150px, 1fr) 150px 130px; gap: 8px; }
    .table-wrap { min-height: 0; overflow: auto; margin: 12px; border: 1px solid var(--line); background: var(--surface); }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      height: 36px;
      padding: 8px 10px;
      text-align: left;
      color: var(--muted);
      background: #f0f0ec;
      border-bottom: 1px solid var(--line-strong);
      font-size: 11px;
      text-transform: uppercase;
    }
    td { height: 48px; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
    tbody tr { cursor: pointer; }
    tbody tr:hover { background: #f7f8f6; }
    tbody tr.selected { background: var(--blue-soft); }
    .task-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 620; }
    .task-id { color: var(--muted); font-family: Consolas, monospace; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .time { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .table-empty { padding: 48px 16px; text-align: center; color: var(--muted); }
    .pager { min-height: 44px; display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 6px 12px; border-top: 1px solid var(--line); background: var(--surface); }

    .detail-scroll { overflow: auto; padding: 14px; }
    .detail-empty { min-height: 240px; display: grid; place-items: center; color: var(--muted); text-align: center; }
    .detail-title { margin: 0 0 4px; font-size: 18px; overflow-wrap: anywhere; }
    .detail-subtitle { margin: 0 0 16px; color: var(--muted); font-family: Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
    .detail-metric { min-height: 58px; padding: 9px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .detail-metric span { display: block; color: var(--muted); font-size: 10px; text-transform: uppercase; }
    .detail-metric strong { display: block; margin-top: 5px; font-size: 12px; overflow-wrap: anywhere; }
    .detail-section { margin-top: 18px; }
    .detail-section h3 { margin: 0 0 7px; color: var(--muted); font-size: 11px; text-transform: uppercase; }
    pre {
      max-height: 230px;
      margin: 0;
      padding: 10px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: #e8edef;
      background: #202527;
      border: 1px solid #101314;
      border-radius: 4px;
      font: 11px/1.55 Consolas, monospace;
    }
    .log-list { border: 1px solid var(--line); background: #202527; color: #dce2e4; border-radius: 4px; overflow: hidden; }
    .log-entry { display: grid; grid-template-columns: 62px 1fr; gap: 8px; padding: 7px 9px; border-bottom: 1px solid #394043; font: 11px/1.4 Consolas, monospace; }
    .log-entry:last-child { border-bottom: 0; }
    .log-stream { color: #8dbbd2; text-transform: uppercase; }
    .error-banner { margin: 12px; padding: 10px 12px; color: var(--red); background: var(--red-soft); border: 1px solid #d8a29e; border-radius: 4px; }

    @media (max-width: 1050px) {
      .workspace { grid-template-columns: 240px minmax(420px, 1fr); }
      .detail-pane { grid-column: 1 / -1; min-height: 420px; border-left: 0; border-top: 1px solid var(--line-strong); }
    }
    @media (max-width: 720px) {
      .app-shell { grid-template-rows: auto 1fr; }
      .topbar { min-height: 70px; flex-wrap: wrap; padding: 10px 12px; gap: 8px; }
      .brand { min-width: 0; }
      .topbar-meta { width: 100%; margin-left: 0; justify-content: space-between; }
      .workspace { display: block; }
      .runner-pane, .task-pane, .detail-pane { min-height: auto; border: 0; border-bottom: 1px solid var(--line-strong); }
      .runner-list { max-height: 300px; }
      .filters { grid-template-columns: 1fr; }
      .table-wrap { min-height: 360px; overflow-x: auto; }
      table { min-width: 620px; }
      .detail-scroll { min-height: 420px; }
    }
  </style>
</head>
<body>
  <section id="auth-view" class="auth-view">
    <form id="auth-form" class="auth-panel">
      <div class="auth-mark">TH</div>
      <h1>Task Hub Console</h1>
      <p>Operator access to runners, task state, results, and execution logs.</p>
      <div class="field">
        <label for="admin-token">Admin token</label>
        <input id="admin-token" name="token" type="password" autocomplete="current-password" required>
      </div>
      <div id="auth-error" class="auth-error" role="alert"></div>
      <button class="button button-primary button-block" type="submit">Connect</button>
    </form>
  </section>

  <div id="app" class="app-shell" hidden>
    <header class="topbar">
      <div class="brand"><strong>Task Hub</strong><span>operations console</span></div>
      <div class="topbar-meta">
        <span class="connection"><i id="connection-dot" class="connection-dot"></i><span id="connection-label">Connecting</span></span>
        <span id="last-refresh">Not refreshed</span>
        <button id="refresh" class="button" type="button">Refresh</button>
        <button id="sign-out" class="button" type="button">Sign out</button>
      </div>
    </header>

    <main class="workspace">
      <aside class="pane runner-pane">
        <div class="pane-head"><h2>Runners</h2><span id="runner-count" class="pane-count">0</span></div>
        <div id="runner-list" class="runner-list"><div class="table-empty">Loading runners...</div></div>
      </aside>

      <section class="pane task-pane">
        <div class="pane-head">
          <div><h2>Task activity</h2><span id="task-count" class="pane-count">0 tasks</span></div>
          <div class="filters">
            <select id="runner-filter" class="filter-select" aria-label="Filter by runner"><option value="">All runners</option></select>
            <select id="status-filter" class="filter-select" aria-label="Filter by status">
              <option value="">All statuses</option><option>queued</option><option>pending_runner</option><option>leased</option>
              <option>running</option><option>succeeded</option><option>failed</option><option>canceled</option><option>expired</option>
            </select>
            <button id="run-selfcheck" class="button button-primary" type="button" disabled>Run self-check</button>
          </div>
        </div>
        <div id="task-error" class="error-banner" hidden></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th style="width:40%">Task</th><th style="width:18%">Type</th><th style="width:20%">Status</th><th style="width:22%">Updated</th></tr></thead>
            <tbody id="task-table-body"><tr><td colspan="4" class="table-empty">Loading tasks...</td></tr></tbody>
          </table>
        </div>
        <div class="pager"><button id="next-page" class="button" type="button" disabled>Next page</button></div>
      </section>

      <aside class="pane detail-pane">
        <div class="pane-head"><h2>Task detail</h2><span id="detail-status"></span></div>
        <div id="task-detail" class="detail-scroll"><div class="detail-empty">Select a task to inspect execution details.</div><div id="task-logs" hidden></div></div>
      </aside>
    </main>
  </div>

  <script>
    (function () {
      "use strict";
      var TOKEN_KEY = "taskHubAdminToken";
      var state = { token: sessionStorage.getItem(TOKEN_KEY) || "", runners: [], tasks: [], selectedRunnerId: "", selectedTaskId: "", taskCursor: "", nextCursor: "", timer: 0, runnerRequestGeneration: 0, taskRequestGeneration: 0, detailRequestGeneration: 0, sessionEpoch: 0, refreshEpoch: -1, refreshPromise: null };
      var authView = document.getElementById("auth-view");
      var app = document.getElementById("app");
      var authForm = document.getElementById("auth-form");
      var tokenInput = document.getElementById("admin-token");
      var authError = document.getElementById("auth-error");

      authForm.addEventListener("submit", function (event) {
        event.preventDefault();
        state.sessionEpoch += 1;
        state.token = tokenInput.value.trim();
        sessionStorage.setItem(TOKEN_KEY, state.token);
        connect();
      });
      document.getElementById("refresh").addEventListener("click", refreshAll);
      document.getElementById("sign-out").addEventListener("click", signOut);
      document.getElementById("runner-filter").addEventListener("change", function (event) {
        state.selectedRunnerId = event.target.value;
        state.taskCursor = "";
        renderRunners();
        loadTasks();
      });
      document.getElementById("status-filter").addEventListener("change", function () { state.taskCursor = ""; loadTasks(); });
      document.getElementById("run-selfcheck").addEventListener("click", runSelfcheck);
      document.getElementById("next-page").addEventListener("click", function () { state.taskCursor = state.nextCursor; loadTasks(); });
      document.addEventListener("visibilitychange", function () {
        schedulePolling();
        if (!document.hidden && state.token) refreshAll();
      });

      function connect() {
        var epoch = state.sessionEpoch;
        var token = state.token;
        authError.textContent = "";
        refreshAll().then(function () {
          if (epoch !== state.sessionEpoch || token !== state.token) return;
          authView.hidden = true;
          app.hidden = false;
          schedulePolling();
        }).catch(function (error) {
          if (epoch === state.sessionEpoch && error.message !== "unauthorized") authError.textContent = error.message;
        });
      }

      function signOut() {
        state.sessionEpoch += 1;
        sessionStorage.removeItem(TOKEN_KEY);
        state.token = "";
        state.runners = [];
        state.tasks = [];
        state.selectedRunnerId = "";
        state.selectedTaskId = "";
        state.taskCursor = "";
        state.nextCursor = "";
        state.runnerRequestGeneration += 1;
        state.taskRequestGeneration += 1;
        state.detailRequestGeneration += 1;
        state.refreshEpoch = -1;
        state.refreshPromise = null;
        clearTimeout(state.timer);
        app.hidden = true;
        authView.hidden = false;
        tokenInput.value = "";
        document.getElementById("task-detail").innerHTML = '<div class="detail-empty">Select a task to inspect execution details.</div><div id="task-logs" hidden></div>';
        document.getElementById("detail-status").replaceChildren();
        tokenInput.focus();
      }

      async function api(path, options) {
        options = options || {};
        var requestEpoch = state.sessionEpoch;
        var requestToken = state.token;
        var headers = new Headers(options.headers || {});
        headers.set("authorization", "Bearer " + requestToken);
        if (options.body) headers.set("content-type", "application/json");
        var response = await fetch(path, Object.assign({}, options, { headers: headers }));
        if (response.status === 401) {
          if (requestEpoch === state.sessionEpoch && requestToken === state.token) {
            signOut();
            authError.textContent = "The admin token was rejected.";
          }
          throw new Error("unauthorized");
        }
        var body = await response.json();
        if (!response.ok) throw new Error(body.error || "Request failed");
        return body;
      }

      async function refreshAll() {
        if (state.refreshPromise && state.refreshEpoch === state.sessionEpoch) return state.refreshPromise;
        var epoch = state.sessionEpoch;
        var refresh = (async function () {
          setConnection(false, "Refreshing");
          try {
            await loadRunners();
            await loadTasks();
            if (epoch !== state.sessionEpoch) return;
            setConnection(true, "Connected");
            document.getElementById("last-refresh").textContent = "Updated " + new Date().toLocaleTimeString();
          } catch (error) {
            if (epoch === state.sessionEpoch) setConnection(false, "Unavailable");
            throw error;
          }
        }());
        state.refreshPromise = refresh;
        state.refreshEpoch = epoch;
        try {
          return await refresh;
        } finally {
          if (refresh === state.refreshPromise) {
            state.refreshPromise = null;
            state.refreshEpoch = -1;
          }
        }
      }

      async function loadRunners() {
        var generation = ++state.runnerRequestGeneration;
        var epoch = state.sessionEpoch;
        var runners = [];
        var page;
        var cursor = "";
        do {
          var path = "/api/admin/runners?limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
          page = await api(path);
          if (generation !== state.runnerRequestGeneration || epoch !== state.sessionEpoch) return;
          runners.push.apply(runners, page.items);
          cursor = page.nextCursor || "";
        } while (page.nextCursor);
        if (generation !== state.runnerRequestGeneration || epoch !== state.sessionEpoch) return;
        state.runners = runners;
        if (state.selectedRunnerId && !state.runners.some(function (runner) { return runner.runnerId === state.selectedRunnerId; })) state.selectedRunnerId = "";
        renderRunners();
        renderRunnerFilter();
      }

      async function loadTasks() {
        var generation = ++state.taskRequestGeneration;
        var epoch = state.sessionEpoch;
        var params = new URLSearchParams({ limit: "50" });
        var status = document.getElementById("status-filter").value;
        if (state.selectedRunnerId) params.set("runnerId", state.selectedRunnerId);
        if (status) params.set("status", status);
        if (state.taskCursor) params.set("cursor", state.taskCursor);
        try {
          var page = await api("/api/admin/tasks?" + params.toString());
          if (generation !== state.taskRequestGeneration || epoch !== state.sessionEpoch) return;
          state.tasks = page.items;
          state.nextCursor = page.nextCursor || "";
          document.getElementById("next-page").disabled = !state.nextCursor;
          document.getElementById("task-error").hidden = true;
          renderTasks();
        } catch (error) {
          if (generation !== state.taskRequestGeneration || epoch !== state.sessionEpoch) return;
          var banner = document.getElementById("task-error");
          banner.textContent = error.message;
          banner.hidden = false;
          throw error;
        }
      }

      function renderRunners() {
        var list = document.getElementById("runner-list");
        document.getElementById("runner-count").textContent = String(state.runners.length);
        document.getElementById("run-selfcheck").disabled = !state.selectedRunnerId;
        if (!state.runners.length) {
          list.innerHTML = '<div class="table-empty">No runners registered.</div>';
          return;
        }
        list.replaceChildren();
        state.runners.forEach(function (runner) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "runner-item" + (runner.runnerId === state.selectedRunnerId ? " selected" : "");
          button.addEventListener("click", function () {
            state.selectedRunnerId = runner.runnerId === state.selectedRunnerId ? "" : runner.runnerId;
            state.taskCursor = "";
            document.getElementById("runner-filter").value = state.selectedRunnerId;
            renderRunners();
            loadTasks();
          });
          var bar = document.createElement("span");
          bar.className = "status-bar " + runner.status;
          var content = document.createElement("span");
          var title = document.createElement("span");
          title.className = "runner-name";
          title.append(document.createTextNode(runner.name));
          title.append(makeBadge(runner.status));
          var id = document.createElement("div"); id.className = "runner-id"; id.textContent = runner.runnerId;
          var meta = document.createElement("div"); meta.className = "runner-meta";
          meta.append(makeBadge(runner.platform));
          runner.taskTypes.forEach(function (type) { meta.append(makeBadge(type)); });
          content.append(title, id, meta);
          button.append(bar, content);
          list.append(button);
        });
      }

      function renderRunnerFilter() {
        var select = document.getElementById("runner-filter");
        var value = state.selectedRunnerId;
        select.replaceChildren(new Option("All runners", ""));
        state.runners.forEach(function (runner) { select.add(new Option(runner.name, runner.runnerId)); });
        select.value = value;
      }

      function renderTasks() {
        var body = document.getElementById("task-table-body");
        document.getElementById("task-count").textContent = state.tasks.length + " tasks";
        if (!state.tasks.length) {
          body.innerHTML = '<tr><td colspan="4" class="table-empty">No tasks match the current filters.</td></tr>';
          return;
        }
        body.replaceChildren();
        state.tasks.forEach(function (task) {
          var row = document.createElement("tr");
          if (task.taskId === state.selectedTaskId) row.className = "selected";
          row.tabIndex = 0;
          row.addEventListener("click", function () { selectTask(task.taskId); });
          row.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") selectTask(task.taskId); });
          row.append(taskCell(task), textCell(task.type), badgeCell(task.status), textCell(formatTime(task.updatedAt), "time"));
          body.append(row);
        });
      }

      async function selectTask(taskId) {
        state.selectedTaskId = taskId;
        var generation = ++state.detailRequestGeneration;
        var epoch = state.sessionEpoch;
        renderTasks();
        var detail = document.getElementById("task-detail");
        detail.innerHTML = '<div class="detail-empty">Loading task details...</div>';
        try {
          var result = await Promise.all([api("/api/admin/tasks/" + encodeURIComponent(taskId)), api("/api/admin/tasks/" + encodeURIComponent(taskId) + "/logs")]);
          if (generation !== state.detailRequestGeneration || epoch !== state.sessionEpoch || taskId !== state.selectedTaskId) return;
          renderDetail(result[0], result[1]);
        } catch (error) {
          if (generation !== state.detailRequestGeneration || epoch !== state.sessionEpoch) return;
          detail.innerHTML = '<div class="error-banner"></div>';
          detail.firstElementChild.textContent = error.message;
        }
      }

      function renderDetail(task, logs) {
        var detail = document.getElementById("task-detail");
        detail.replaceChildren();
        var title = document.createElement("h3"); title.className = "detail-title"; title.textContent = task.name;
        var subtitle = document.createElement("p"); subtitle.className = "detail-subtitle"; subtitle.textContent = task.taskId;
        var grid = document.createElement("div"); grid.className = "detail-grid";
        grid.append(
          metric("Status", task.status),
          metric("Runner", task.runnerId),
          metric("Type", task.type),
          metric("Updated", formatTime(task.updatedAt)),
          metric("Lease ID", task.leaseId),
          metric("Lease expires", formatTime(task.leaseExpiresAt)),
          metric("Created", formatTime(task.createdAt)),
          metric("Timeout", task.timeoutSeconds + " seconds")
        );
        detail.append(title, subtitle, grid, jsonSection("Payload", task.payload));
        if (task.result) detail.append(jsonSection("Result", task.result));
        if (task.error) detail.append(textSection("Error", task.error));
        detail.append(logSection(logs));
        document.getElementById("detail-status").replaceChildren(makeBadge(task.status));
      }

      async function runSelfcheck() {
        if (!state.selectedRunnerId) return;
        var button = document.getElementById("run-selfcheck");
        button.disabled = true;
        try {
          await api("/api/admin/tasks", { method: "POST", body: JSON.stringify({ runnerId: state.selectedRunnerId, type: "selfcheck", name: "Console self-check", payload: {}, timeoutSeconds: 60 }) });
          state.taskCursor = "";
          await loadTasks();
        } catch (error) {
          var banner = document.getElementById("task-error"); banner.textContent = error.message; banner.hidden = false;
        } finally {
          button.disabled = !state.selectedRunnerId;
        }
      }

      function taskCell(task) {
        var cell = document.createElement("td");
        var name = document.createElement("div"); name.className = "task-name"; name.textContent = task.name;
        var id = document.createElement("div"); id.className = "task-id"; id.textContent = task.taskId;
        cell.append(name, id); return cell;
      }
      function textCell(value, className) { var cell = document.createElement("td"); cell.textContent = value; if (className) cell.className = className; return cell; }
      function badgeCell(value) { var cell = document.createElement("td"); cell.append(makeBadge(value)); return cell; }
      function makeBadge(value) { var badge = document.createElement("span"); badge.className = "badge " + value; badge.textContent = String(value).replace("_", " "); return badge; }
      function metric(label, value) { var node = document.createElement("div"); node.className = "detail-metric"; var small = document.createElement("span"); small.textContent = label; var strong = document.createElement("strong"); strong.textContent = value || "-"; node.append(small, strong); return node; }
      function jsonSection(label, value) { var section = document.createElement("section"); section.className = "detail-section"; var heading = document.createElement("h3"); heading.textContent = label; var pre = document.createElement("pre"); pre.textContent = JSON.stringify(value, null, 2); section.append(heading, pre); return section; }
      function textSection(label, value) { var section = jsonSection(label, value); section.querySelector("pre").textContent = value; return section; }
      function logSection(logs) {
        var section = document.createElement("section"); section.className = "detail-section";
        var heading = document.createElement("h3"); heading.textContent = "Logs" + (logs.invalidObjects ? " (" + logs.invalidObjects + " invalid objects skipped)" : "");
        var list = document.createElement("div"); list.id = "task-logs"; list.className = "log-list";
        if (!logs.entries.length) { var empty = document.createElement("div"); empty.className = "log-entry"; empty.textContent = "No logs uploaded."; list.append(empty); }
        logs.entries.forEach(function (entry) { var row = document.createElement("div"); row.className = "log-entry"; var stream = document.createElement("span"); stream.className = "log-stream"; stream.textContent = entry.stream; var message = document.createElement("span"); message.textContent = entry.message; row.append(stream, message); list.append(row); });
        section.append(heading, list); return section;
      }
      function formatTime(value) { return value ? new Date(value).toLocaleString() : "-"; }
      function setConnection(connected, label) { document.getElementById("connection-dot").className = "connection-dot" + (connected ? " connected" : ""); document.getElementById("connection-label").textContent = label; }
      function poll() { refreshAll().catch(function () {}).finally(schedulePolling); }
      function schedulePolling() { clearTimeout(state.timer); if (!document.hidden && state.token) state.timer = setTimeout(poll, 5000); }

      if (state.token) connect(); else tokenInput.focus();
    }());
  </script>
</body>
</html>`;
