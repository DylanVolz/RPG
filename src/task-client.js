/**
 * src/task-client.js — JSON client for the Task Viewer.
 *
 * Wraps /api/* endpoints served by Node (proxied to tools/task_api_server.py).
 * Every mutation function returns the parsed JSON response or throws a
 * TaskApiError with .status / .message for UI-level handling.
 *
 * All calls use AbortController + a per-call timeout so a hung/dead server
 * fails cleanly instead of deadlocking the UI. A `signal` option on the
 * request overrides the timeout for callers that want to dedupe in-flight
 * work (e.g. cancel the previous task-detail fetch when a new one starts).
 */

export class TaskApiError extends Error {
    constructor(status, message, payload) {
        super(message);
        this.status  = status;
        this.payload = payload;
    }
}

// Default timeouts: reads have generous budgets since the full-task list
// can be 600+ rows; mutations should be quick and we'd rather surface a
// timeout than appear frozen.
const DEFAULT_READ_TIMEOUT_MS     = 20_000;
const DEFAULT_MUTATION_TIMEOUT_MS = 10_000;

async function _req(method, path, body, opts = {}) {
    const timeoutMs = opts.timeoutMs ??
        (method === 'GET' ? DEFAULT_READ_TIMEOUT_MS : DEFAULT_MUTATION_TIMEOUT_MS);

    // Combine caller-provided signal with our own timeout so either can
    // abort. AbortSignal.any exists in modern browsers; fall back for old.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
    const signals = [ctrl.signal];
    if (opts.signal) signals.push(opts.signal);
    const signal = signals.length === 1 ? signals[0]
        : (AbortSignal.any ? AbortSignal.any(signals) : ctrl.signal);
    if (opts.signal) {
        opts.signal.addEventListener('abort', () => ctrl.abort(opts.signal.reason), { once: true });
    }

    const init = { method, headers: {}, signal };
    if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }

    let res;
    try {
        res = await fetch(path, init);
    } catch (err) {
        clearTimeout(timer);
        if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
            const timedOut = ctrl.signal.aborted && ctrl.signal.reason?.name === 'TimeoutError';
            throw new TaskApiError(0, timedOut
                ? `timeout after ${Math.round(timeoutMs/1000)}s`
                : 'request cancelled');
        }
        throw new TaskApiError(0, `network error: ${err.message || err}`);
    }
    clearTimeout(timer);

    const ct  = res.headers.get('Content-Type') || '';
    let data;
    try {
        data = ct.includes('application/json') ? await res.json() : await res.text();
    } catch (err) {
        throw new TaskApiError(res.status, `parse error: ${err.message || err}`);
    }
    if (!res.ok) {
        const msg = (data && data.error) || `HTTP ${res.status}`;
        throw new TaskApiError(res.status, msg, data);
    }
    return data;
}

// ── Reads ──────────────────────────────────────────────────────────
export const fetchAllTasks    = (opts)     => _req('GET', '/api/tasks', undefined, opts);
export const fetchTaskDetail  = (id, opts) => _req('GET', `/api/tasks/${encodeURIComponent(id)}`, undefined, opts);
export const fetchClusters    = (opts)     => _req('GET', '/api/kg/clusters', undefined, opts);
export const fetchRooms       = (opts)     => _req('GET', '/api/kg/rooms', undefined, opts);
export const fetchStats       = (opts)     => _req('GET', '/api/kg/stats', undefined, opts);
export const fetchCycleCheck  = (from, to, opts) =>
    _req('GET', `/api/kg/cycle-check?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, undefined, opts);

// ── Mutations ──────────────────────────────────────────────────────
export const claimTask = (id, opts) =>
    _req('POST', `/api/tasks/${encodeURIComponent(id)}/claim`, {}, opts);

export const setStatus = (id, status, reason, opts) => {
    const body = { status };
    if (reason) body.reason = reason;
    return _req('POST', `/api/tasks/${encodeURIComponent(id)}/status`, body, opts);
};

export const addDep = (id, target, opts) =>
    _req('POST', `/api/tasks/${encodeURIComponent(id)}/depends-on`, { target }, opts);

export const removeDep = (id, target, opts) =>
    _req('DELETE', `/api/tasks/${encodeURIComponent(id)}/depends-on/${encodeURIComponent(target)}`, undefined, opts);

export const setTriple = (id, predicate, object, treeOpts = {}, opts) =>
    _req('POST', `/api/tasks/${encodeURIComponent(id)}/triple`, {
        predicate,
        object,
        invalidate_current: treeOpts.invalidateCurrent !== false,
    }, opts);

// Priority scale: urgent=100, high=75, medium=50, low=clear (no triple, no badge)
export const setPriority = (id, level, opts) =>
    _req('POST', `/api/tasks/${encodeURIComponent(id)}/priority`, { level }, opts);

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
