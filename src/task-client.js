/**
 * src/task-client.js — JSON client for the Task Viewer.
 *
 * Wraps /api/* endpoints served by Node (proxied to tools/task_api_server.py).
 * Every mutation function returns the parsed JSON response or throws a
 * TaskApiError with .status / .message for UI-level handling.
 */

export class TaskApiError extends Error {
    constructor(status, message, payload) {
        super(message);
        this.status  = status;
        this.payload = payload;
    }
}

async function _req(method, path, body) {
    const init = { method, headers: {} };
    if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const res = await fetch(path, init);
    const ct  = res.headers.get('Content-Type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
        const msg = (data && data.error) || `HTTP ${res.status}`;
        throw new TaskApiError(res.status, msg, data);
    }
    return data;
}

// ── Reads ──────────────────────────────────────────────────────────
export const fetchAllTasks    = ()    => _req('GET', '/api/tasks');
export const fetchTaskDetail  = (id)  => _req('GET', `/api/tasks/${encodeURIComponent(id)}`);
export const fetchClusters    = ()    => _req('GET', '/api/kg/clusters');
export const fetchRooms       = ()    => _req('GET', '/api/kg/rooms');
export const fetchStats       = ()    => _req('GET', '/api/kg/stats');
export const fetchCycleCheck  = (from, to) =>
    _req('GET', `/api/kg/cycle-check?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

// ── Mutations ──────────────────────────────────────────────────────
export const claimTask = (id) =>
    _req('POST', `/api/tasks/${encodeURIComponent(id)}/claim`, {});

export const setStatus = (id, status, reason) => {
    const body = { status };
    if (reason) body.reason = reason;
    return _req('POST', `/api/tasks/${encodeURIComponent(id)}/status`, body);
};

export const addDep = (id, target) =>
    _req('POST', `/api/tasks/${encodeURIComponent(id)}/depends-on`, { target });

export const removeDep = (id, target) =>
    _req('DELETE', `/api/tasks/${encodeURIComponent(id)}/depends-on/${encodeURIComponent(target)}`);

export const setTriple = (id, predicate, object, opts = {}) =>
    _req('POST', `/api/tasks/${encodeURIComponent(id)}/triple`, {
        predicate,
        object,
        invalidate_current: opts.invalidateCurrent !== false,
    });

// Priority scale: urgent=100, high=75, medium=50, low=clear (no triple, no badge)
export const setPriority = (id, level) =>
    _req('POST', `/api/tasks/${encodeURIComponent(id)}/priority`, { level });

// ── Derived helpers (client-side) ──────────────────────────────────

/**
 * Decorate raw task list (keyed dict) with computed fields:
 *   - readiness: "ready" | "blocked" | "done" | "blocked-by-status"
 *   - openDepCount: number of deps not yet done
 *   - fanIn: number of open downstream tasks depending on this one
 */
const DONE_STATUSES = new Set([
    'completed', 'completed-by-ai', 'deprecated', 'superseded', 'skipped',
]);

export function enrichTasks(tasksById) {
    // Build reverse adjacency
    const rev = new Map();
    for (const [tid, t] of Object.entries(tasksById)) {
        for (const d of t.depends || []) {
            if (!rev.has(d)) rev.set(d, []);
            rev.get(d).push(tid);
        }
    }
    for (const [tid, t] of Object.entries(tasksById)) {
        const openDeps = (t.depends || []).filter(d =>
            !DONE_STATUSES.has((tasksById[d] || {}).status));
        t.openDepCount = openDeps.length;
        const downstream = rev.get(tid) || [];
        t.fanIn = downstream.filter(r => !DONE_STATUSES.has(tasksById[r].status)).length;

        if (DONE_STATUSES.has(t.status))        t.readiness = 'done';
        else if (t.status === 'blocked')        t.readiness = 'blocked';
        else if (t.status === 'in-progress')    t.readiness = 'in-progress';
        else if (t.status === 'future-maybe')   t.readiness = 'future';
        else if (openDeps.length === 0)         t.readiness = 'ready';
        else                                    t.readiness = 'blocked-by-deps';
    }
    return tasksById;
}

export { DONE_STATUSES };
