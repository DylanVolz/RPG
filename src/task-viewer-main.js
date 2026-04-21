/**
 * src/task-viewer-main.js — Orchestrator for task-viewer.html.
 *
 * Fetches tasks, builds the graph, wires filter bar, detail panel, and
 * mutation flows (claim/complete/block + dep add/remove).
 */

import {
    fetchAllTasks, fetchTaskDetail, fetchCycleCheck,
    claimTask, setStatus, addDep, removeDep, enrichTasks, DONE_STATUSES,
} from './task-client.js';
import { createTaskGraph } from './task-graph.js';
import { TaskPanel }       from './task-panel.js';

const $ = sel => document.querySelector(sel);

// ── Global app state ────────────────────────────────────────────────
const state = {
    tasks: {},          // id → task (enriched)
    panel: null,        // TaskPanel
    graph: null,        // TaskGraph controller
    selectedId: null,
    addDepSource: null, // non-null when user is picking a target
    filters: {
        type: new Set(),
        status: new Set(),
        room: '',
        cluster: '',
        mvpOnly: false,
        readyOnly: false,
        search: '',
    },
};

// ── Toast ───────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, isError ? 6000 : 3000);
}

function setStatusBadge(txt) {
    const el = $('#status-badge');
    if (el) el.textContent = txt;
}

// ── Initial boot ────────────────────────────────────────────────────
async function boot() {
    try {
        setStatusBadge('fetching tasks…');
        const raw = await fetchAllTasks();
        state.tasks = enrichTasks(raw);
        setStatusBadge(`${Object.keys(state.tasks).length} tasks`);

        buildFilterOptions();
        state.panel = new TaskPanel($('#details'), {
            onStatusChange:     handleStatusChange,
            onNavigate:         navigateTo,
            onRemoveDep:        handleRemoveDep,
            onEnterAddDepMode:  enterAddDepMode,
        });
        state.panel.showEmpty();

        state.graph = createTaskGraph($('#graph-host'), {
            onNodeTap:        handleNodeTap,
            onEdgeTap:        handleEdgeTap,
            onBackgroundTap:  handleBackgroundTap,
        });
        state.graph.setData(state.tasks);
        applyCurrentFilter();

        wireFilters();
    } catch (err) {
        console.error(err);
        toast('failed to load tasks: ' + err.message, true);
        setStatusBadge('error');
    }
}

// ── Filter bar ──────────────────────────────────────────────────────
function buildFilterOptions() {
    const types    = new Set();
    const statuses = new Set();
    const rooms    = new Set();
    const clusters = new Set();
    for (const t of Object.values(state.tasks)) {
        if (t.type)    types.add(t.type);
        if (t.status)  statuses.add(t.status);
        if (t.room)    rooms.add(t.room);
        if (t.cluster) clusters.add(t.cluster);
    }

    const fillMulti = (sel, values) => {
        const el = $(sel);
        el.innerHTML = '<option value="__ALL__" selected>all</option>' +
            [...values].sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        el.size = Math.min(8, values.size + 1);
    };
    const fillSingle = (sel, values) => {
        const el = $(sel);
        el.innerHTML = '<option value="">all</option>' +
            [...values].sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    };

    fillMulti('#f-type',    types);
    fillMulti('#f-status',  statuses);
    fillSingle('#f-room',    rooms);
    fillSingle('#f-cluster', clusters);
}

function wireFilters() {
    const readMultiSet = (sel) => {
        const el = $(sel);
        const vals = new Set();
        for (const opt of el.selectedOptions) {
            if (opt.value && opt.value !== '__ALL__') vals.add(opt.value);
        }
        return vals;
    };

    const onChange = () => {
        state.filters.type      = readMultiSet('#f-type');
        state.filters.status    = readMultiSet('#f-status');
        state.filters.room      = $('#f-room').value;
        state.filters.cluster   = $('#f-cluster').value;
        state.filters.mvpOnly   = $('#f-mvp').checked;
        state.filters.readyOnly = $('#f-ready').checked;
        state.filters.search    = $('#f-search').value.trim().toLowerCase();
        applyCurrentFilter();
    };

    ['#f-type','#f-status','#f-room','#f-cluster','#f-mvp','#f-ready']
        .forEach(s => $(s).addEventListener('change', onChange));
    $('#f-search').addEventListener('input', onChange);
    $('#btn-refresh').addEventListener('click', () => boot());
    $('#btn-fit').addEventListener('click', () => state.graph && state.graph.fit());

    $('#mode-cancel').addEventListener('click', exitAddDepMode);
}

function applyCurrentFilter() {
    if (!state.graph) return;
    const f = state.filters;
    const pred = (t) => {
        if (f.type.size    && !f.type.has(t.type))     return false;
        if (f.status.size  && !f.status.has(t.status)) return false;
        if (f.room         && t.room    !== f.room)    return false;
        if (f.cluster      && t.cluster !== f.cluster) return false;
        if (f.mvpOnly      && !t.is_mvp)               return false;
        if (f.readyOnly    && t.readiness !== 'ready') return false;
        if (f.search) {
            const hay = (t.id + ' ' + (t.title || '')).toLowerCase();
            if (!hay.includes(f.search)) return false;
        }
        return true;
    };
    state.graph.applyFilter(pred);

    const totalMatching = Object.values(state.tasks).filter(pred).length;
    $('#empty').classList.toggle('active', totalMatching === 0);
}

// ── Node / edge interaction ────────────────────────────────────────
async function handleNodeTap(tid) {
    if (state.addDepSource) {
        return attemptAddDep(state.addDepSource, tid);
    }
    await selectTask(tid);
}

async function selectTask(tid) {
    state.selectedId = tid;
    state.graph.select(tid);
    state.panel.showLoading(tid);
    try {
        const detail = await fetchTaskDetail(tid);
        state.panel.render(detail, state.tasks);
    } catch (err) {
        state.panel.showEmpty(`error: ${err.message}`);
        toast('failed to load task: ' + err.message, true);
    }
}

function navigateTo(tid) {
    selectTask(tid);
    state.graph.cy.animate({
        center: { eles: state.graph.cy.getElementById(tid) },
        zoom:   Math.max(state.graph.cy.zoom(), 0.7),
    }, { duration: 300 });
}

function handleEdgeTap(source, target) {
    // Edge click → show the source task's detail (target lives in its depends).
    selectTask(source);
}

function handleBackgroundTap() {
    if (state.addDepSource) {
        exitAddDepMode();
    }
}

// ── Status mutations ───────────────────────────────────────────────
async function handleStatusChange(tid, to, reason) {
    try {
        let result;
        if (to === 'in-progress') {
            result = await claimTask(tid);
        } else {
            result = await setStatus(tid, to, reason);
        }
        // Optimistic: update local state immediately.
        const t = state.tasks[tid];
        if (t) {
            t.status = to;
            state.tasks = enrichTasks(state.tasks); // re-derive readiness / fan-in
        }
        state.graph.setData(state.tasks);
        applyCurrentFilter();
        await selectTask(tid);
        toast(`${tid}: ${result.old || '?'} → ${result.new || to}`);
    } catch (err) {
        toast('mutation failed: ' + err.message, true);
    }
}

// ── Dep add / remove ───────────────────────────────────────────────
function enterAddDepMode(sourceId) {
    state.addDepSource = sourceId;
    state.graph.setAddDepSource(sourceId);

    // Pre-compute: candidates that would create a cycle if added.
    // Heuristic: any task upstream of sourceId via depends_on is a cycle.
    const wouldCycle = new Set();
    const stack = [sourceId];
    wouldCycle.add(sourceId);
    while (stack.length) {
        const n = stack.pop();
        for (const [tid, t] of Object.entries(state.tasks)) {
            if ((t.depends || []).includes(n) && !wouldCycle.has(tid)) {
                wouldCycle.add(tid); stack.push(tid);
            }
        }
    }
    state.graph.markTargetCandidates(sourceId, wouldCycle);

    $('#mode-text').textContent = `+ add dep: click the task that ${sourceId} should depend on`;
    $('#mode-banner').classList.add('active');
}

function exitAddDepMode() {
    state.addDepSource = null;
    state.graph.clearSelection();
    $('#mode-banner').classList.remove('active');
    if (state.selectedId) state.graph.select(state.selectedId);
}

async function attemptAddDep(source, target) {
    exitAddDepMode();
    if (source === target) {
        toast('cannot depend on self', true);
        return;
    }
    try {
        // Pre-flight on the server for a crisp error.
        const check = await fetchCycleCheck(source, target);
        if (check.would_cycle) {
            toast(`would cycle: ${(check.path || []).join(' → ')}`, true);
            return;
        }
        const result = await addDep(source, target);
        if (result.added) {
            // Update local state + graph.
            const t = state.tasks[source];
            if (t) {
                t.depends = t.depends || [];
                if (!t.depends.includes(target)) t.depends.push(target);
                state.tasks = enrichTasks(state.tasks);
            }
            state.graph.addEdge(source, target);
            applyCurrentFilter();
            await selectTask(source);
            toast(`${source} → ${target} added`);
        } else if (result.already) {
            toast('already exists');
        }
    } catch (err) {
        toast('add-dep failed: ' + err.message, true);
    }
}

async function handleRemoveDep(source, target) {
    try {
        const result = await removeDep(source, target);
        if (result.removed) {
            const t = state.tasks[source];
            if (t && t.depends) t.depends = t.depends.filter(d => d !== target);
            state.tasks = enrichTasks(state.tasks);
            state.graph.removeEdge(source, target);
            applyCurrentFilter();
            await selectTask(source);
            toast(`${source} → ${target} removed`);
        } else {
            toast('already absent');
        }
    } catch (err) {
        toast('remove-dep failed: ' + err.message, true);
    }
}

// ── Utility ────────────────────────────────────────────────────────
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

boot();
