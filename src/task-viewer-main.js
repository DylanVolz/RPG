/**
 * src/task-viewer-main.js — Orchestrator for task-viewer.html.
 *
 * Fetches tasks, builds the graph, wires filter bar, detail panel, and
 * mutation flows (claim/complete/block + dep add/remove).
 */

import {
    fetchAllTasks, fetchTaskDetail, fetchCycleCheck,
    claimTask, setStatus, setPriority, addDep, removeDep, enrichTasks, DONE_STATUSES,
} from './task-client.js';
import { createTaskGraph } from './task-graph.js';
import { TaskPanel }       from './task-panel.js';
import { TaskLanes }       from './task-lanes.js';
import { TaskClusters }    from './task-clusters.js';

const $ = sel => document.querySelector(sel);

// ── Global app state ────────────────────────────────────────────────
const state = {
    tasks: {},          // id → task (enriched)
    panel: null,        // TaskPanel
    graph: null,        // TaskGraph controller
    lanes: null,        // TaskLanes
    clusters: null,     // TaskClusters
    viewMode: 'lanes',  // 'graph' | 'lanes' | 'clusters'
    selectedId: null,
    addDepSource: null, // non-null when user is picking a target
    filters: {
        type: '',
        status: '',
        room: '',
        cluster: '',
        mvpOnly: false,
        readyOnly: false,
        walkOnly: false,
        hideDone: true,   // default: hide completed / superseded / deprecated / skipped
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

// ── Auto-refresh (for watching synth runs live) ─────────────────────
// Re-fetches tasks every N seconds without tearing down the view. Data is
// pushed into the existing graph + lanes via setData; filters, selection,
// and view-mode are preserved. Toggle via the auto-refresh checkbox — off
// by default so normal reads don't hit the API on a timer.
const AUTO_REFRESH_INTERVAL_MS = 10_000;
let autoRefreshTimer = null;

async function refreshData() {
    try {
        const raw = await fetchAllTasks();
        const before = Object.keys(state.tasks).length;
        state.tasks = enrichTasks(raw);
        const after = Object.keys(state.tasks).length;
        const delta = after - before;
        if (state.graph) state.graph.setData(state.tasks);
        if (state.lanes) state.lanes.setData(state.tasks);
        if (state.clusters) state.clusters.setData(state.tasks);
        applyCurrentFilter();
        // Refresh the detail pane if a task is selected and its data changed.
        if (state.selectedTask && state.tasks[state.selectedTask] && state.panel) {
            state.panel.show(state.tasks[state.selectedTask], state.tasks);
        }
        setStatusBadge(`${after} tasks${delta !== 0 ? ` (${delta >= 0 ? '+' : ''}${delta})` : ''}`);
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const lbl = $('#autorefresh-last');
        if (lbl) lbl.textContent = `last ${hh}:${mm}:${ss}${delta !== 0 ? ` (${delta >= 0 ? '+' : ''}${delta})` : ''}`;
    } catch (err) {
        console.warn('auto-refresh failed:', err);
        setStatusBadge('refresh error');
    }
}

function setAutoRefresh(on) {
    const indicator = $('#autorefresh-indicator');
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
    if (on) {
        autoRefreshTimer = setInterval(refreshData, AUTO_REFRESH_INTERVAL_MS);
        if (indicator) indicator.style.display = 'inline';
        refreshData();  // kick one immediately
    } else {
        if (indicator) indicator.style.display = 'none';
    }
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
            onPriorityChange:   handlePriorityChange,
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

        state.lanes = new TaskLanes($('#lanes'), {
            onPillTap:        handleNodeTap,
            onBackgroundTap:  handleBackgroundTap,
        });
        state.lanes.setData(state.tasks);

        state.clusters = new TaskClusters($('#clusters'), {
            onTaskTap:        handleNodeTap,
            onBackgroundTap:  handleBackgroundTap,
        });
        state.clusters.setData(state.tasks);

        applyCurrentFilter();
        wireFilters();
        wireViewToggle();
        // Apply initial view mode so CSS classes on #graph / #lanes sync with
        // state.viewMode (avoids a first-paint flash of the wrong pane).
        setViewMode(state.viewMode);
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

    const fillSingle = (sel, values) => {
        const el = $(sel);
        el.innerHTML = '<option value="">all</option>' +
            [...values].sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    };

    fillSingle('#f-type',    types);
    fillSingle('#f-status',  statuses);
    fillSingle('#f-room',    rooms);
    fillSingle('#f-cluster', clusters);
}

function wireFilters() {
    const onChange = () => {
        state.filters.type      = $('#f-type').value;
        state.filters.status    = $('#f-status').value;
        state.filters.room      = $('#f-room').value;
        state.filters.cluster   = $('#f-cluster').value;
        state.filters.mvpOnly   = $('#f-mvp').checked;
        state.filters.readyOnly = $('#f-ready').checked;
        state.filters.walkOnly  = $('#f-walk').checked;
        state.filters.hideDone  = $('#f-hide-done').checked;
        state.filters.search    = $('#f-search').value.trim().toLowerCase();
        applyCurrentFilter();
    };

    ['#f-type','#f-status','#f-room','#f-cluster','#f-mvp','#f-ready','#f-walk','#f-hide-done']
        .forEach(s => $(s).addEventListener('change', onChange));

    // Ghost toggle is a pure lanes-view switch — no filter predicate change,
    // just tell the lanes controller to re-render with ghosts on/off.
    $('#f-ghosts').addEventListener('change', (ev) => {
        if (state.lanes) state.lanes.setShowGhosts(ev.target.checked);
    });
    $('#f-search').addEventListener('input', onChange);
    $('#btn-refresh').addEventListener('click', () => boot());
    $('#f-autorefresh').addEventListener('change', (ev) => setAutoRefresh(ev.target.checked));
    $('#btn-fit').addEventListener('click', () => state.graph && state.graph.fit());

    $('#mode-cancel').addEventListener('click', exitAddDepMode);

    // Tile size sliders for the lanes view (live CSS-variable updates;
    // no re-render needed since tiles use var(--tile-w/h) directly).
    const applyTileSize = () => {
        const w = parseInt($('#f-tile-w').value, 10) || 180;
        const h = parseInt($('#f-tile-h').value, 10) || 74;
        if (state.lanes) state.lanes.setTileSize(w, h);
        if (state.clusters) state.clusters.setTileSize(w, h);
    };
    $('#f-tile-w').addEventListener('input', applyTileSize);
    $('#f-tile-h').addEventListener('input', applyTileSize);
}

function applyCurrentFilter() {
    if (!state.graph) return;
    const f = state.filters;
    // Two-tier filter:
    //   hidePred → completely remove from the DOM (display:none). Used by
    //             hide-done so done tasks don't leave ghostly dim tiles.
    //   matchPred → dim non-matches to 0.15 opacity so filter-driven focus
    //             keeps positional context visible.
    // Explicit status-dropdown selection overrides hide-done: if you pick
    // status=completed, those tiles come back.
    const hidePred = (t) => (
        f.hideDone && DONE_STATUSES.has(t.status) && t.status !== f.status
    );
    const matchPred = (t) => {
        if (f.type       && t.type    !== f.type)      return false;
        if (f.status     && t.status  !== f.status)    return false;
        if (f.room       && t.room    !== f.room)      return false;
        if (f.cluster    && t.cluster !== f.cluster)   return false;
        if (f.mvpOnly    && !t.is_mvp)                  return false;
        if (f.readyOnly  && t.readiness !== 'ready')   return false;
        if (f.walkOnly) {
            if (t.type !== 'walkthrough' && t.verifiable_by !== 'walkthrough') return false;
        }
        if (f.search) {
            const hay = (t.id + ' ' + (t.title || '')).toLowerCase();
            if (!hay.includes(f.search)) return false;
        }
        return true;
    };
    state.graph.applyFilter(matchPred, hidePred);
    if (state.lanes) state.lanes.applyFilter(matchPred, hidePred);
    if (state.clusters) state.clusters.applyFilter(matchPred, hidePred);

    const totalVisible = Object.values(state.tasks)
        .filter(t => !hidePred(t) && matchPred(t)).length;
    $('#empty').classList.toggle('active', totalVisible === 0);
}

function setViewMode(mode) {
    state.viewMode = mode;
    $('#graph').classList.toggle('hidden', mode !== 'graph');
    $('#lanes').classList.toggle('active',  mode === 'lanes');
    $('#clusters').classList.toggle('active', mode === 'clusters');
    const btnGraph = $('#btn-view-graph');
    const btnLanes = $('#btn-view-lanes');
    const btnClusters = $('#btn-view-clusters');
    if (btnGraph) btnGraph.classList.toggle('active', mode === 'graph');
    if (btnLanes) btnLanes.classList.toggle('active', mode === 'lanes');
    if (btnClusters) btnClusters.classList.toggle('active', mode === 'clusters');
    if (state.selectedId) {
        if (mode === 'graph') state.graph && state.graph.select(state.selectedId);
        else if (mode === 'lanes') state.lanes && state.lanes.select(state.selectedId);
        else state.clusters && state.clusters.select(state.selectedId);
    }
    if (mode === 'graph' && state.graph) {
        // Cytoscape needs a resize kick when its container un-hides.
        setTimeout(() => state.graph.cy.resize(), 0);
    }
}

function wireViewToggle() {
    $('#btn-view-graph').addEventListener('click', () => setViewMode('graph'));
    $('#btn-view-lanes').addEventListener('click', () => setViewMode('lanes'));
    $('#btn-view-clusters').addEventListener('click', () => setViewMode('clusters'));
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
    if (state.lanes) state.lanes.select(tid);
    if (state.clusters) state.clusters.select(tid);
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
        if (state.lanes) state.lanes.setData(state.tasks);
        if (state.clusters) state.clusters.setData(state.tasks);
        applyCurrentFilter();
        await selectTask(tid);
        toast(`${tid}: ${result.old || '?'} → ${result.new || to}`);
    } catch (err) {
        toast('mutation failed: ' + err.message, true);
    }
}

// ── Priority (urgent / low) ────────────────────────────────────────
async function handlePriorityChange(tid, level) {
    try {
        const result = await setPriority(tid, level);
        // Optimistic: update the local task's priority_boost.
        const t = state.tasks[tid];
        if (t) {
            t.priority_boost = result.cleared ? 0 : result.value;
            state.tasks = enrichTasks(state.tasks);
        }
        if (state.graph) state.graph.setData(state.tasks);
        if (state.lanes) state.lanes.setData(state.tasks);
        if (state.clusters) state.clusters.setData(state.tasks);
        applyCurrentFilter();
        await selectTask(tid);
        toast(`${tid}: priority → ${level}${result.cleared ? ' (cleared)' : ` (${result.value})`}`);
    } catch (err) {
        toast('priority change failed: ' + err.message, true);
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
            if (state.lanes) state.lanes.setData(state.tasks);
            if (state.clusters) state.clusters.setData(state.tasks);
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
            if (state.lanes) state.lanes.setData(state.tasks);
            if (state.clusters) state.clusters.setData(state.tasks);
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
