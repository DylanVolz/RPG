/**
 * src/task-lanes.js — Grid-based swimlanes with global dep-rank columns.
 *
 * Each room is one lane (one grid row band per lane; multiple physical rows
 * within the band when two tasks in the same lane share a rank). Every
 * task is placed at column = (rank + 2) of a global CSS grid — column 1 is
 * the sticky lane-header column, columns 2..N are rank 0..N-2. Because all
 * lanes share the same column template, a dependent task in room B sits
 * strictly to the right of the task it depends on in room A.
 *
 * Both axes scroll: horizontally when max-rank * tile-width exceeds the
 * viewport, vertically when total rooms × lane-height exceeds it.
 */

import { compareByTaskqPriority } from './task-priority.js';

const STATUS_COLOR = {
    'not-started':      '#6b7076',
    'in-progress':      '#4a8ccc',
    'completed':        '#5c9c54',
    'completed-by-ai':  '#7ab07e',
    'blocked':          '#cc5c5c',
    'deprecated':       '#4a4a4a',
    'superseded':       '#4a4a4a',
    'skipped':          '#4a4a4a',
    'future-maybe':     '#8a6dcc',
};

const DONE_STATUSES = new Set([
    'completed', 'completed-by-ai', 'deprecated', 'superseded', 'skipped',
]);

export class TaskLanes {
    constructor(container, opts = {}) {
        this.container = container;         // #lanes (scroll host)
        this.grid      = container.querySelector('#lanes-grid') || container;
        this.opts      = opts;
        this.tasksById = {};
        this.rankMap   = new Map();
        this.maxRank   = 0;
        this.selectedId = null;
        this.showGhosts = true;             // toggled by #f-ghosts checkbox via setShowGhosts
        this._bindHandlers();
    }

    setShowGhosts(on) {
        const next = !!on;
        if (next === this.showGhosts) return;
        this.showGhosts = next;
        this.render();
    }

    _bindHandlers() {
        this.grid.addEventListener('click', (ev) => {
            const pill = ev.target.closest('.task-pill');
            if (pill) {
                if (this.opts.onPillTap) this.opts.onPillTap(pill.dataset.tid);
                return;
            }
            if (this.opts.onBackgroundTap) this.opts.onBackgroundTap();
        });
    }

    setData(tasksById) {
        this.tasksById = tasksById;
        this.rankMap   = computeDepRanks(tasksById);
        this.maxRank   = 0;
        for (const r of this.rankMap.values()) if (r > this.maxRank) this.maxRank = r;
        this.render();
    }

    render() {
        const grouped = groupByRoom(this.tasksById);

        // Vertical room order: primary key = min rank of any task in the
        // room whose dep crosses into a *different* room. Rooms that no
        // other room depends on (self-contained foundations) get their own
        // avg-rank as the primary key so they stay near the top. This makes
        // a room land directly under the upstream room it first depends on,
        // and multiple dependents of the same upstream are fan-ordered by
        // their shallowest crossing-task depth.
        const firstCrossRank = new Map();
        for (const [room, tasks] of grouped) {
            let best = Infinity;
            for (const t of tasks) {
                const tRoom = t.room;
                for (const dep of (t.depends || [])) {
                    const target = this.tasksById[dep];
                    if (!target) continue;
                    if (target.room && target.room !== tRoom) {
                        const r = this.rankMap.get(t.id) ?? 0;
                        if (r < best) best = r;
                    }
                }
            }
            firstCrossRank.set(room, best);
        }
        const avgRank = (arr) => arr.length
            ? arr.reduce((s, t) => s + (this.rankMap.get(t.id) ?? 0), 0) / arr.length
            : 0;
        const rooms = [...grouped.keys()].sort((a, b) => {
            const fa = firstCrossRank.get(a);
            const fb = firstCrossRank.get(b);
            // Rooms with NO cross-room deps: use -Infinity so they land at
            // the top (they don't wait for anyone). Both-Infinity ties fall
            // through to avg-rank.
            const ka = fa === Infinity ? -Infinity : fa;
            const kb = fb === Infinity ? -Infinity : fb;
            if (ka !== kb) return ka - kb;
            const aa = avgRank(grouped.get(a));
            const bb = avgRank(grouped.get(b));
            if (aa !== bb) return aa - bb;
            return a.localeCompare(b);
        });

        // Column template: sticky header column + one column per rank (0..maxRank).
        const cols = this.maxRank + 1;
        this.grid.style.gridTemplateColumns =
            `var(--lane-header-w) repeat(${cols}, var(--tile-w))`;

        const parts = [];

        // Column-0 corner of the ruler (sits above the headers).
        parts.push(`<div class="rank-ruler rr-header">dep depth →</div>`);
        // One ruler tick per column.
        for (let r = 0; r <= this.maxRank; r++) {
            parts.push(`<div class="rank-ruler" style="grid-column:${r + 2};">${r}</div>`);
        }

        // Row 1 is the rank ruler. Lane bands start at row 2.
        // We explicitly track row offsets so a multi-stack lane doesn't leak
        // tiles into an adjacent lane's row band.
        let rowCursor = 2;
        // Ghosts are a visual pointer that reads "the task to my right
        // depends on a task in the same column in a lane ABOVE me". So they
        // only make sense when the upstream task's room is strictly earlier
        // in the vertical room order than the current downstream room. Build
        // a lookup so per-ghost we can check `upstreamIdx < myIdx`.
        const roomIdx = new Map();
        rooms.forEach((room, idx) => roomIdx.set(room, idx));
        rooms.forEach((room) => {
            const myIdx = roomIdx.get(room);
            const tasks = grouped.get(room);
            const total = tasks.length;
            const open  = tasks.filter(t => !DONE_STATUSES.has(t.status)).length;
            const ready = tasks.filter(t => t.readiness === 'ready').length;
            const maxDepthInRoom = tasks.reduce((m, t) => Math.max(m, this.rankMap.get(t.id) ?? 0), 0);

            // Real tasks grouped by rank (column).
            const byRank = new Map();
            for (const t of tasks) {
                const r = this.rankMap.get(t.id) ?? 0;
                if (!byRank.has(r)) byRank.set(r, []);
                byRank.get(r).push(t);
            }
            // Within-rank sort mirrors tools/taskq.py's ready ordering so
            // stacks read the same way as the CLI queue.
            for (const [, ts] of byRank) ts.sort(compareByTaskqPriority);

            // Ghost tiles: per cross-room dep, dedupe by upstream T-ID so
            // multiple downstream tasks depending on the same upstream in
            // this lane show only ONE ghost marker.
            const ghostsByCol = new Map();  // col → [{upstreamTask, upstreamRoom}]
            const seenGhostUpstream = new Set();
            // Ghosts only appear in lanes that have at least one room above
            // them — i.e. never in the topmost lane. The check `upIdx < myIdx`
            // enforces this automatically (no upstream room can be above the
            // top lane, so myIdx=0 always fails the guard).
            if (this.showGhosts && myIdx > 0) {
                for (const t of tasks) {
                    for (const depId of (t.depends || [])) {
                        const up = this.tasksById[depId];
                        if (!up) continue;
                        if (!up.room || up.room === room) continue;  // same-room or orphan
                        const upIdx = roomIdx.get(up.room);
                        if (upIdx === undefined || upIdx >= myIdx) continue;  // upstream MUST be above
                        if (seenGhostUpstream.has(depId)) continue;
                        seenGhostUpstream.add(depId);
                        const col = (this.rankMap.get(depId) ?? 0) + 2;
                        if (!ghostsByCol.has(col)) ghostsByCol.set(col, []);
                        ghostsByCol.get(col).push({ upstreamTask: up, upstreamRoom: up.room });
                    }
                }
            }

            // Per-column stack depth = real tile count + ghost count at that col.
            const cols = new Set([...byRank.keys()].map(r => r + 2));
            for (const c of ghostsByCol.keys()) cols.add(c);
            let maxStack = 1;
            for (const c of cols) {
                const real  = (byRank.get(c - 2) || []).length;
                const ghost = (ghostsByCol.get(c) || []).length;
                const h = real + ghost;
                if (h > maxStack) maxStack = h;
            }

            // Lane header spans the whole lane's row band (sticky at col 1).
            parts.push(`
              <div class="lane-header" data-room="${esc(room)}"
                   style="grid-column: 1; grid-row: ${rowCursor} / span ${maxStack};">
                ${esc(room)}
                <span class="lane-count">${open}/${total} · ${ready} ready · d${maxDepthInRoom}</span>
              </div>
            `);

            // Real tiles first at each column, then any ghosts below.
            for (const [rank, ts] of byRank) {
                const col = rank + 2;
                ts.forEach((t, stackIdx) => {
                    parts.push(renderPill(t, rank, {
                        col,
                        row: rowCursor + stackIdx,
                    }));
                });
            }
            for (const [col, ghosts] of ghostsByCol) {
                const realAtCol = (byRank.get(col - 2) || []).length;
                ghosts.forEach((g, gIdx) => {
                    parts.push(renderGhost(g.upstreamTask, g.upstreamRoom, col, rowCursor + realAtCol + gIdx));
                });
            }
            rowCursor += maxStack;
        });

        this.grid.innerHTML = parts.join('');

        if (this.selectedId) {
            const el = this.grid.querySelector(`.task-pill[data-tid="${cssEsc(this.selectedId)}"]`);
            if (el) el.classList.add('selected');
        }
    }

    select(tid) {
        if (this.selectedId) {
            const prev = this.grid.querySelector(`.task-pill[data-tid="${cssEsc(this.selectedId)}"]`);
            if (prev) prev.classList.remove('selected');
        }
        this.selectedId = tid;
        if (tid) {
            const el = this.grid.querySelector(`.task-pill[data-tid="${cssEsc(tid)}"]`);
            if (el) {
                el.classList.add('selected');
                el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
            }
        }
    }

    clearSelection() { this.select(null); }

    applyFilter(matchPred, hidePred) {
        let visible = 0;
        for (const pill of this.grid.querySelectorAll('.task-pill')) {
            const t = this.tasksById[pill.dataset.tid];
            const hide  = t && hidePred ? hidePred(t) : false;
            const match = t ? matchPred(t) : false;
            pill.classList.toggle('hidden', hide);
            pill.classList.toggle('dim',    !hide && !match);
            if (!hide && match) visible++;
        }
        // Hide lane-header rows whose lane has zero visible tasks. Consider
        // a tile "visible" if it's neither hidden nor dimmed.
        const headerByRoom = new Map();
        for (const h of this.grid.querySelectorAll('.lane-header')) {
            headerByRoom.set(h.dataset.room, h);
        }
        for (const [room, header] of headerByRoom) {
            const anyVisible = this.grid.querySelector(
                `.task-pill:not(.dim):not(.hidden)[data-room="${cssEsc(room)}"]`
            );
            header.style.display = anyVisible ? '' : 'none';
        }
        return visible;
    }

    /** Adjust tile dimensions at runtime. */
    setTileSize(width, height) {
        this.container.style.setProperty('--tile-w', `${width}px`);
        this.container.style.setProperty('--tile-h', `${height}px`);
    }

    destroy() { this.grid.innerHTML = ''; }
}

// ── helpers ────────────────────────────────────────────────────────
function groupByRoom(tasksById) {
    const out = new Map();
    for (const t of Object.values(tasksById)) {
        const room = t.room || '(unassigned)';
        if (!out.has(room)) out.set(room, []);
        out.get(room).push(t);
    }
    return out;
}

/**
 * Rank each task by the LONGEST chain of depends_on it sits at the end of.
 * Tasks with no deps → rank 0; each extra dep hop adds 1. Cycle-tolerant.
 */
function computeDepRanks(tasksById) {
    const rank     = new Map();
    const visiting = new Set();
    function r(tid) {
        if (rank.has(tid))     return rank.get(tid);
        if (visiting.has(tid)) return 0;
        visiting.add(tid);
        const t = tasksById[tid];
        let mx = -1;
        for (const d of (t ? t.depends : []) || []) {
            if (tasksById[d]) mx = Math.max(mx, r(d));
        }
        visiting.delete(tid);
        const me = mx + 1;
        rank.set(tid, me);
        return me;
    }
    for (const tid of Object.keys(tasksById)) r(tid);
    return rank;
}

function renderPill(t, rank, opts) {
    const color = STATUS_COLOR[t.status] || '#6b7076';
    const isWalkType   = t.type === 'walkthrough';
    const isWalkVerify = t.verifiable_by === 'walkthrough';
    const cls = [
        'task-pill',
        DONE_STATUSES.has(t.status) ? 'done' : '',
        t.is_mvp ? 'mvp' : '',
        t.readiness === 'ready' ? 'ready-marker' : '',
        isWalkType   ? 'walk-type'   : '',
        isWalkVerify ? 'walk-verify' : '',
    ].filter(Boolean).join(' ');

    const prefix = isWalkType   ? '<span class="wt-badge" title="walkthrough task">▶</span>' : '';
    const suffix = isWalkVerify ? '<span class="wv-badge" title="verified by walkthrough">◇</span>' : '';

    const tipParts = [
        esc(t.title || ''),
        `${esc(t.id)} · ${esc(t.status)}${t.type ? ' · ' + esc(t.type) : ''}${t.cluster ? ' · ' + esc(t.cluster) : ''}${rank ? ' · depth ' + rank : ''}`,
    ];
    if (isWalkType)   tipParts.push('▶ produces a walkthrough script');
    if (isWalkVerify) tipParts.push('◇ verified by walkthrough');

    const chips = [];
    // Priority badges — only render when actually set. "low" (boost=0 / unset)
    // is the default and deliberately badge-less to avoid UI clutter.
    const pb = t.priority_boost | 0;
    if (pb >= 100)      chips.push('<span class="chip urgent">URGENT</span>');
    else if (pb >= 75)  chips.push('<span class="chip high">HIGH</span>');
    else if (pb >= 50)  chips.push('<span class="chip medium">MEDIUM</span>');
    if (t.readiness === 'ready')      chips.push('<span class="chip ready">ready</span>');
    if (t.is_mvp) {
        const mo = (t.mvp_order != null) ? '#' + t.mvp_order : '';
        chips.push(`<span class="chip mvp">MVP${mo}</span>`);
    }
    if ((t.unblocks_count | 0) > 0)   chips.push(`<span class="chip">↑${t.unblocks_count}</span>`);
    if (t.priority === 'EA')          chips.push('<span class="chip ea">EA</span>');
    if (t.phase != null && t.phase !== '') chips.push(`<span class="chip">P${esc(t.phase)}</span>`);
    if (t.cluster)                    chips.push(`<span class="chip">${esc(t.cluster)}</span>`);

    const style = `grid-column: ${opts.col}; grid-row: ${opts.row};`;

    return `<div class="${cls}" data-tid="${esc(t.id)}" data-rank="${rank|0}" data-room="${esc(t.room || '')}" style="${style}" title="${tipParts.join('&#10;')}">
      <div class="pill-row1">
        ${prefix}<span class="dot" style="background:${color}"></span>
        <span class="tid">${esc(t.id)}</span>
        <span class="typ">${esc(t.type || '')}</span>${suffix}
      </div>
      <div class="pill-title">${esc(t.title || '')}</div>
      <div class="pill-meta">${chips.join('')}</div>
    </div>`;
}

/**
 * Ghost tile — placed in a downstream lane at the column of the upstream
 * task it depends on. Carries data-tid of the UPSTREAM so clicks flow
 * through the same onPillTap → selectTask path as real tiles.
 */
function renderGhost(upstream, upstreamRoom, col, row) {
    const style = `grid-column: ${col}; grid-row: ${row};`;
    const tipParts = [
        `cross-lane dep marker`,
        `→ ${esc(upstream.id)}  (${esc(upstreamRoom)})`,
        upstream.title ? esc(upstream.title) : '',
        `click to open upstream task`,
    ].filter(Boolean);
    return `<div class="task-pill ghost" data-tid="${esc(upstream.id)}" data-ghost="1" data-room="${esc(upstreamRoom)}" style="${style}" title="${tipParts.join('&#10;')}">
      <div class="pill-row1">
        <span class="ghost-arrow">→</span>
        <span class="tid">${esc(upstream.id)}</span>
      </div>
      <div class="pill-title">${esc(upstreamRoom)}</div>
    </div>`;
}

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function cssEsc(s) { return String(s || '').replace(/"/g, '\\"'); }
