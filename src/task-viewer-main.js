/**
 * src/task-viewer-main.js — Orchestrator for task-viewer.html.
 *
 * Fetches tasks, wires the filter bar, detail panel, and mutation flows
 * (claim/complete/block + dep add/remove). Views: lanes (default) and
 * clusters. The cytoscape DAG view was removed — it was the heaviest
 * dependency and the two tile views cover the same UX.
 */

import {
    fetchAllTasks, fetchTaskDetail, fetchCycleCheck,
    claimTask, setStatus, setPriority, addDep, removeDep, enrichTasks, DONE_STATUSES,
} from './task-client.js';
import { TaskPanel }       from './task-panel.js';
import { TaskLanes }       from './task-lanes.js';
import { TaskClusters }    from './task-clusters.js';

const $ = sel => document.querySelector(sel);

// ── Global app state ────────────────────────────────────────────────
const state = {
    tasks: {},          // id → task (enriched)
    panel: null,        // TaskPanel
    lanes: null,        // TaskLanes
    clusters: null,     // TaskClusters
    viewMode: 'lanes',  // 'lanes' | 'clusters'
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

// ── Request dedupe / cancellation ───────────────────────────────────
// Only ever one full-list fetch and one task-detail fetch in flight at
// a time. Starting a new one aborts the previous, so rapid-fire clicks
// (or a stacked-up auto-refresh) never queue N slow requests.
let _allTasksCtrl = null;
let _detailCtrl   = null;

function _replaceCtrl(ref) {
    if (ref && !ref.signal.aborted) ref.abort('superseded');
    return new AbortController();
}

// ── URL state persistence ───────────────────────────────────────────
// Filter / view selections live in window.location.search so a browser
// refresh (or copy-paste of the URL) restores the same view. Only values
// that diverge from the defaults are written, keeping the URL readable.
const URL_DEFAULTS = {
    type: '', status: '', room: '', cluster: '',
    mvp: false, ready: false, walk: false, hideDone: true,
    ghosts: true, autoRefresh: false,
    search: '',
    view: 'lanes',
    tileW: 180, tileH: 74,
    sel: '',
};

function readUrlParams() {
    const p = new URLSearchParams(window.location.search);
    const str  = (k, d) => (p.has(k) ? p.get(k) : d);
    const bool = (k, d) => {
        if (!p.has(k)) return d;
        const v = p.get(k);
        return v === '1' || v === 'true';
    };
    const num  = (k, d) => {
        const v = parseInt(p.get(k), 10);
        return Number.isFinite(v) ? v : d;
    };
    const rawView = str('view', URL_DEFAULTS.view);
    // The old graph view is gone — collapse it to lanes.
    const view = (rawView === 'lanes' || rawView === 'clusters') ? rawView : URL_DEFAULTS.view;
    return {
        type:        str('type',        URL_DEFAULTS.type),
        status:      str('status',      URL_DEFAULTS.status),
        room:        str('room',        URL_DEFAULTS.room),
        cluster:     str('cluster',     URL_DEFAULTS.cluster),
        mvp:         bool('mvp',         URL_DEFAULTS.mvp),
        ready:       bool('ready',       URL_DEFAULTS.ready),
        walk:        bool('walk',        URL_DEFAULTS.walk),
        hideDone:    bool('hideDone',    URL_DEFAULTS.hideDone),
        ghosts:      bool('ghosts',      URL_DEFAULTS.ghosts),
        autoRefresh: bool('autoRefresh', URL_DEFAULTS.autoRefresh),
        search:      str('search',      URL_DEFAULTS.search).trim().toLowerCase(),
        view,
        tileW:       num('tileW',       URL_DEFAULTS.tileW),
        tileH:       num('tileH',       URL_DEFAULTS.tileH),
        sel:         str('sel',         URL_DEFAULTS.sel),
    };
}

function writeUrlParams() {
    const f = state.filters;
    const ghostsEl = $('#f-ghosts');
    const autoEl   = $('#f-autorefresh');
    const tileWEl  = $('#f-tile-w');
    const tileHEl  = $('#f-tile-h');
    const cur = {
        type:        f.type,
        status:      f.status,
        room:        f.room,
        cluster:     f.cluster,
        mvp:         f.mvpOnly,
        ready:       f.readyOnly,
        walk:        f.walkOnly,
        hideDone:    f.hideDone,
        ghosts:      ghostsEl ? ghostsEl.checked : URL_DEFAULTS.ghosts,
        autoRefresh: autoEl   ? autoEl.checked   : URL_DEFAULTS.autoRefresh,
        search:      f.search || '',
        view:        state.viewMode,
        tileW:       tileWEl ? (parseInt(tileWEl.value, 10) || URL_DEFAULTS.tileW) : URL_DEFAULTS.tileW,
        tileH:       tileHEl ? (parseInt(tileHEl.value, 10) || URL_DEFAULTS.tileH) : URL_DEFAULTS.tileH,
        sel:         state.selectedId || '',
    };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(cur)) {
        const def = URL_DEFAULTS[k];
        if (typeof def === 'boolean') {
            if (v !== def) p.set(k, v ? '1' : '0');
        } else if (typeof def === 'number') {
            if (v !== def) p.set(k, String(v));
        } else if (v !== def && v !== '') {
            p.set(k, v);
        }
    }
    const qs = p.toString();
    const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState(null, '', url);
}

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
// pushed into the existing lanes/clusters via setData; filters, selection,
// and view-mode are preserved. Toggle via the auto-refresh checkbox — off
// by default so normal reads don't hit the API on a timer.
const AUTO_REFRESH_INTERVAL_MS = 10_000;
let autoRefreshTimer = null;
let refreshInFlight  = false;

async function refreshData() {
    // Drop the tick if the previous refresh is still running — the server
    // is already busy and we don't want to stack requests.
    if (refreshInFlight) return;
    refreshInFlight = true;
    _allTasksCtrl = _replaceCtrl(_allTasksCtrl);
    try {
        const raw = await fetchAllTasks({ signal: _allTasksCtrl.signal });
        const before = Object.keys(state.tasks).length;
        state.tasks = enrichTasks(raw);
        const after = Object.keys(state.tasks).length;
        const delta = after - before;
        if (state.lanes) state.lanes.setData(state.tasks);
        if (state.clusters) state.clusters.setData(state.tasks);
        applyCurrentFilter();
        // Refresh the detail pane if a task is selected and its data changed.
        if (state.selectedId && state.tasks[state.selectedId] && state.panel) {
            state.panel.render(state.tasks[state.selectedId], state.tasks);
        }
        setStatusBadge(`${after} tasks${delta !== 0 ? ` (${delta >= 0 ? '+' : ''}${delta})` : ''}`);
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const lbl = $('#autorefresh-last');
        if (lbl) lbl.textContent = `last ${hh}:${mm}:${ss}${delta !== 0 ? ` (${delta >= 0 ? '+' : ''}${delta})` : ''}`;
    } catch (err) {
        if (err?.status === 0 && String(err?.message).includes('cancelled')) return;
        console.warn('auto-refresh failed:', err);
        setStatusBadge('refresh error: ' + (err?.message || err));
    } finally {
        refreshInFlight = false;
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
        _allTasksCtrl = _replaceCtrl(_allTasksCtrl);
        const raw = await fetchAllTasks({ signal: _allTasksCtrl.signal });
        state.tasks = enrichTasks(raw);
        setStatusBadge(`${Object.keys(state.tasks).length} tasks`);

        const url = readUrlParams();

        buildFilterOptions();

        // Hydrate filter state + controls from the URL before any render so
        // the first filter pass already reflects the saved selection.
        state.filters.type      = url.type;
        state.filters.status    = url.status;
        state.filters.room      = url.room;
        state.filters.cluster   = url.cluster;
        state.filters.mvpOnly   = url.mvp;
        state.filters.readyOnly = url.ready;
        state.filters.walkOnly  = url.walk;
        state.filters.hideDone  = url.hideDone;
        state.filters.search    = url.search;
        state.viewMode          = url.view;

        $('#f-type').value        = url.type;
        $('#f-status').value      = url.status;
        $('#f-room').value        = url.room;
        $('#f-cluster').value     = url.cluster;
        $('#f-mvp').checked       = url.mvp;
        $('#f-ready').checked     = url.ready;
        $('#f-walk').checked      = url.walk;
        $('#f-hide-done').checked = url.hideDone;
        $('#f-ghosts').checked    = url.ghosts;
        $('#f-autorefresh').checked = url.autoRefresh;
        $('#f-search').value      = url.search;
        $('#f-tile-w').value      = url.tileW;
        $('#f-tile-h').value      = url.tileH;

        state.panel = new TaskPanel($('#details'), {
            onStatusChange:     handleStatusChange,
            onPriorityChange:   handlePriorityChange,
            onNavigate:         navigateTo,
            onRemoveDep:        handleRemoveDep,
            onEnterAddDepMode:  enterAddDepMode,
        });
        state.panel.showEmpty();

        state.lanes = new TaskLanes($('#lanes'), {
            onPillTap:        handleNodeTap,
            onBackgroundTap:  handleBackgroundTap,
        });
        state.lanes.setData(state.tasks);
        state.lanes.setShowGhosts(url.ghosts);
        state.lanes.setTileSize(url.tileW, url.tileH);

        state.clusters = new TaskClusters($('#clusters'), {
            onTaskTap:        handleNodeTap,
            onBackgroundTap:  handleBackgroundTap,
        });
        state.clusters.setData(state.tasks);
        state.clusters.setTileSize(url.tileW, url.tileH);

        applyCurrentFilter();
        wireFilters();
        wireViewToggle();
        setViewMode(state.viewMode);

        if (url.autoRefresh) setAutoRefresh(true);
        if (url.sel && state.tasks[url.sel]) {
            // Don't await — let the detail fetch run in the background so
            // a slow /api/tasks/<id> doesn't block the initial render.
            selectTask(url.sel);
        }

        // Normalize the URL after hydration (drops unknown / default params).
        writeUrlParams();
    } catch (err) {
        console.error(err);
        toast('failed to load tasks: ' + (err?.message || err), true);
        setStatusBadge('error: ' + (err?.message || err));
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
        writeUrlParams();
    };

    ['#f-type','#f-status','#f-room','#f-cluster','#f-mvp','#f-ready','#f-walk','#f-hide-done']
        .forEach(s => $(s).addEventListener('change', onChange));

    $('#f-ghosts').addEventListener('change', (ev) => {
        if (state.lanes) state.lanes.setShowGhosts(ev.target.checked);
        writeUrlParams();
    });
    $('#f-search').addEventListener('input', onChange);
    $('#btn-refresh').addEventListener('click', () => boot());
    $('#f-autorefresh').addEventListener('change', (ev) => {
        setAutoRefresh(ev.target.checked);
        writeUrlParams();
    });

    $('#mode-cancel').addEventListener('click', exitAddDepMode);

    // Tile size sliders for the lanes view (live CSS-variable updates;
    // no re-render needed since tiles use var(--tile-w/h) directly).
    const applyTileSize = () => {
        const w = parseInt($('#f-tile-w').value, 10) || 180;
        const h = parseInt($('#f-tile-h').value, 10) || 74;
        if (state.lanes) state.lanes.setTileSize(w, h);
        if (state.clusters) state.clusters.setTileSize(w, h);
        writeUrlParams();
    };
    $('#f-tile-w').addEventListener('input', applyTileSize);
    $('#f-tile-h').addEventListener('input', applyTileSize);
}

function applyCurrentFilter() {
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
    if (state.lanes) state.lanes.applyFilter(matchPred, hidePred);
    if (state.clusters) state.clusters.applyFilter(matchPred, hidePred);

    const totalVisible = Object.values(state.tasks)
        .filter(t => !hidePred(t) && matchPred(t)).length;
    $('#empty').classList.toggle('active', totalVisible === 0);
}

function setViewMode(mode) {
    if (mode !== 'lanes' && mode !== 'clusters') mode = 'lanes';
    state.viewMode = mode;
    $('#lanes').classList.toggle('active',  mode === 'lanes');
    $('#clusters').classList.toggle('active', mode === 'clusters');
    const btnLanes    = $('#btn-view-lanes');
    const btnClusters = $('#btn-view-clusters');
    if (btnLanes)    btnLanes.classList.toggle('active',    mode === 'lanes');
    if (btnClusters) btnClusters.classList.toggle('active', mode === 'clusters');
    if (state.selectedId) {
        if (mode === 'lanes') state.lanes && state.lanes.select(state.selectedId);
        else state.clusters && state.clusters.select(state.selectedId);
    }
    writeUrlParams();
}

function wireViewToggle() {
    $('#btn-view-lanes').addEventListener('click', () => setViewMode('lanes'));
    $('#btn-view-clusters').addEventListener('click', () => setViewMode('clusters'));
}

// ── Node / edge interaction ────────────────────────────────────────
async function handleNodeTap(tid) {
    if (state.addDepSource) {
        return attemptAddDep(state.addDepSource, tid);
    }
    selectTask(tid);
}

async function selectTask(tid) {
    state.selectedId = tid;
    if (state.lanes) state.lanes.select(tid);
    if (state.clusters) state.clusters.select(tid);
    writeUrlParams();
    state.panel.showLoading(tid);
    _detailCtrl = _replaceCtrl(_detailCtrl);
    const myCtrl = _detailCtrl;
    try {
        const detail = await fetchTaskDetail(tid, { signal: myCtrl.signal });
        // If a newer selectTask already fired, drop this result on the floor.
        if (myCtrl !== _detailCtrl) return;
        state.panel.render(detail, state.tasks);
    } catch (err) {
        if (myCtrl !== _detailCtrl) return; // superseded; newer call owns the panel
        if (err?.status === 0 && String(err?.message).includes('cancelled')) return;
        state.panel.showEmpty(`error: ${err?.message || err}`);
        toast('failed to load task: ' + (err?.message || err), true);
    }
}

function navigateTo(tid) {
    selectTask(tid);
    // Scroll the active tile into view in whichever list view is showing.
    const el = document.querySelector(`.task-pill[data-tid="${CSS.escape(tid)}"],
                                        .cluster-task-row[data-tid="${CSS.escape(tid)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
        if (state.lanes) state.lanes.setData(state.tasks);
        if (state.clusters) state.clusters.setData(state.tasks);
        applyCurrentFilter();
        selectTask(tid);
        toast(`${tid}: ${result.old || '?'} → ${result.new || to}`);
    } catch (err) {
        toast('mutation failed: ' + (err?.message || err), true);
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
        if (state.lanes) state.lanes.setData(state.tasks);
        if (state.clusters) state.clusters.setData(state.tasks);
        applyCurrentFilter();
        selectTask(tid);
        toast(`${tid}: priority → ${level}${result.cleared ? ' (cleared)' : ` (${result.value})`}`);
    } catch (err) {
        toast('priority change failed: ' + (err?.message || err), true);
    }
}

// ── Dep add / remove ───────────────────────────────────────────────
// With the graph view gone, add-dep mode is a simple modal state: user
// clicks "+ add dep" in the detail panel, banner appears, next tile click
// in the lanes/clusters view is treated as the target. Cycle / self-dep
// checks run server-side.
function enterAddDepMode(sourceId) {
    state.addDepSource = sourceId;
    $('#mode-text').textContent = `+ add dep: click the task that ${sourceId} should depend on`;
    $('#mode-banner').classList.add('active');
}

function exitAddDepMode() {
    state.addDepSource = null;
    $('#mode-banner').classList.remove('active');
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
            const t = state.tasks[source];
            if (t) {
                t.depends = t.depends || [];
                if (!t.depends.includes(target)) t.depends.push(target);
                state.tasks = enrichTasks(state.tasks);
            }
            if (state.lanes) state.lanes.setData(state.tasks);
            if (state.clusters) state.clusters.setData(state.tasks);
            applyCurrentFilter();
            selectTask(source);
            toast(`${source} → ${target} added`);
        } else if (result.already) {
            toast('already exists');
        }
    } catch (err) {
        toast('add-dep failed: ' + (err?.message || err), true);
    }
}

async function handleRemoveDep(source, target) {
    try {
        const result = await removeDep(source, target);
        if (result.removed) {
            const t = state.tasks[source];
            if (t && t.depends) t.depends = t.depends.filter(d => d !== target);
            state.tasks = enrichTasks(state.tasks);
            if (state.lanes) state.lanes.setData(state.tasks);
            if (state.clusters) state.clusters.setData(state.tasks);
            applyCurrentFilter();
            selectTask(source);
            toast(`${source} → ${target} removed`);
        } else {
            toast('already absent');
        }
    } catch (err) {
        toast('remove-dep failed: ' + (err?.message || err), true);
    }
}

// ── Utility ────────────────────────────────────────────────────────
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

boot();
