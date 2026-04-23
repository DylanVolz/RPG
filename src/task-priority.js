/**
 * src/task-priority.js — Shared task ordering helpers for the task viewer.
 *
 * Mirrors tools/taskq.py's cmd_ready sort key so browser views can use the
 * same prioritization language as the CLI.
 */

export const VERIFY_COST = {
    'auto_test':  0,
    'unit_test':  0,
    'test':       0,
    'test_scene': 1,
    'mixed':      2,
    'walkthrough': 3,
};

export const READINESS_ORDER = {
    'ready': 0,
    'in-progress': 1,
    'blocked-by-deps': 2,
    'blocked': 3,
    'future': 4,
    'done': 5,
};

export function taskqPriorityKey(t) {
    const boost = intOr(t.priority_boost, 0);
    const isMvp = t.is_mvp ? 1 : 0;
    const mvpOrder = t.mvp_order == null ? 1e9 : intOr(t.mvp_order, 1e9);
    const verifyCost = inferVerifyCost(t);
    const unblocks = intOr(t.unblocks_count, 0);
    const isEa = t.priority === 'EA' ? 1 : 0;
    return [
        -boost,
        -isMvp,
        mvpOrder,
        verifyCost,
        -unblocks,
        -isEa,
        String(t.phase || '99'),
        String(t.id || ''),
    ];
}

export function compareByTaskqPriority(a, b) {
    return compareKeys(taskqPriorityKey(a), taskqPriorityKey(b));
}

export function compareByReadinessThenTaskq(a, b) {
    const ra = READINESS_ORDER[a.readiness] ?? 99;
    const rb = READINESS_ORDER[b.readiness] ?? 99;
    if (ra !== rb) return ra - rb;
    return compareByTaskqPriority(a, b);
}

export function pickRepresentativeTask(tasks) {
    if (!tasks || !tasks.length) return null;
    return [...tasks].sort(compareByReadinessThenTaskq)[0];
}

function inferVerifyCost(t) {
    if (t.type === 'walkthrough') return 3;
    return VERIFY_COST[t.verifiable_by] ?? 2;
}

function intOr(value, fallback) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

function compareKeys(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const av = a[i];
        const bv = b[i];
        if (av === bv) continue;
        if (typeof av === 'string' || typeof bv === 'string') {
            return String(av).localeCompare(String(bv), undefined, { numeric: true });
        }
        return av < bv ? -1 : 1;
    }
    return 0;
}
