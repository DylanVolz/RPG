/**
 * src/task-clusters.js — Cluster-centric summary tiles for the Task Viewer.
 *
 * Each feature cluster becomes one card. Unclustered tasks fall back to a
 * singleton synthetic cluster so nothing disappears from the view.
 */

import {
    compareByReadinessThenTaskq,
    pickRepresentativeTask,
} from './task-priority.js';

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

export class TaskClusters {
    constructor(container, opts = {}) {
        this.container = container;
        this.grid = container.querySelector('#clusters-grid') || container;
        this.opts = opts;
        this.tasksById = {};
        this.groupByTaskId = new Map();
        this.groups = new Map();
        this.selectedId = null;
        this.matchPred = null;
        this.hidePred = null;
        this._bindHandlers();
    }

    _bindHandlers() {
        this.grid.addEventListener('click', (ev) => {
            const taskEl = ev.target.closest('[data-tid]');
            if (taskEl && this.opts.onTaskTap) {
                this.opts.onTaskTap(taskEl.dataset.tid);
                return;
            }
            if (this.opts.onBackgroundTap) this.opts.onBackgroundTap();
        });
    }

    setData(tasksById) {
        this.tasksById = tasksById || {};
        this._rebuildGroups();
        this.render();
    }

    applyFilter(matchPred, hidePred) {
        this.matchPred = matchPred || null;
        this.hidePred = hidePred || null;
        return this.render();
    }

    setTileSize(width, height) {
        this.container.style.setProperty('--tile-w', `${width}px`);
        this.container.style.setProperty('--tile-h', `${height}px`);
    }

    select(tid) {
        if (this.selectedId) {
            const prevGroup = this.groupByTaskId.get(this.selectedId);
            if (prevGroup) {
                const prev = this.grid.querySelector(`.cluster-card[data-cluster="${cssEsc(prevGroup)}"]`);
                if (prev) prev.classList.remove('selected');
            }
        }
        this.selectedId = tid;
        if (!tid) return;
        const groupKey = this.groupByTaskId.get(tid);
        if (!groupKey) return;
        const el = this.grid.querySelector(`.cluster-card[data-cluster="${cssEsc(groupKey)}"]`);
        if (el) {
            el.classList.add('selected');
            el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        }
    }

    clearSelection() { this.select(null); }

    destroy() { this.grid.innerHTML = ''; }

    render() {
        const cards = [];
        const visibleGroups = [];

        for (const group of this.groups.values()) {
            const visibleTasks = group.tasks.filter((t) => {
                if (this.hidePred && this.hidePred(t)) return false;
                if (this.matchPred && !this.matchPred(t)) return false;
                return true;
            });
            if (!visibleTasks.length) continue;
            visibleGroups.push({
                ...group,
                visibleTasks,
                representative: pickRepresentativeTask(visibleTasks),
            });
        }

        visibleGroups.sort((a, b) => {
            const cmp = compareByReadinessThenTaskq(a.representative, b.representative);
            if (cmp !== 0) return cmp;
            if (a.cluster !== b.cluster) return a.cluster.localeCompare(b.cluster);
            return a.key.localeCompare(b.key);
        });

        visibleGroups.forEach((group, idx) => {
            cards.push(renderClusterCard(group, idx));
        });

        this.grid.innerHTML = cards.join('');
        if (this.selectedId) this.select(this.selectedId);
        return visibleGroups.length;
    }

    _rebuildGroups() {
        this.groups = new Map();
        this.groupByTaskId = new Map();

        for (const task of Object.values(this.tasksById)) {
            const key = task.cluster ? `cluster:${task.cluster}` : `task:${task.id}`;
            const label = task.cluster || task.id;
            if (!this.groups.has(key)) {
                this.groups.set(key, {
                    key,
                    cluster: label,
                    isSynthetic: !task.cluster,
                    tasks: [],
                });
            }
            this.groups.get(key).tasks.push(task);
            this.groupByTaskId.set(task.id, key);
        }

        const reverse = buildReverseDeps(this.tasksById);

        for (const group of this.groups.values()) {
            group.tasks.sort(compareByReadinessThenTaskq);
            group.representativeAll = pickRepresentativeTask(group.tasks);
            group.rooms = [...new Set(group.tasks.map(t => t.room).filter(Boolean))].sort();
            group.counts = summarizeTasks(group.tasks);
            group.upstream = summarizeClusterLinks(group.tasks, this.tasksById, this.groupByTaskId, this.groups, 'upstream');
            group.downstream = summarizeClusterLinks(group.tasks, this.tasksById, this.groupByTaskId, this.groups, 'downstream', reverse);
        }
    }
}

function buildReverseDeps(tasksById) {
    const reverse = new Map();
    for (const task of Object.values(tasksById)) {
        for (const dep of (task.depends || [])) {
            if (!reverse.has(dep)) reverse.set(dep, []);
            reverse.get(dep).push(task.id);
        }
    }
    return reverse;
}

function summarizeTasks(tasks) {
    return {
        total: tasks.length,
        open: tasks.filter(t => !DONE_STATUSES.has(t.status)).length,
        ready: tasks.filter(t => t.readiness === 'ready').length,
        inProgress: tasks.filter(t => t.status === 'in-progress').length,
        blocked: tasks.filter(t => t.readiness === 'blocked' || t.readiness === 'blocked-by-deps').length,
        done: tasks.filter(t => DONE_STATUSES.has(t.status)).length,
    };
}

function summarizeClusterLinks(tasks, tasksById, groupByTaskId, groups, dir, reverse) {
    const counts = new Map();

    for (const task of tasks) {
        const related = dir === 'upstream'
            ? (task.depends || [])
            : (reverse.get(task.id) || []);
        for (const relId of related) {
            const other = tasksById[relId];
            if (!other) continue;
            const otherGroupKey = groupByTaskId.get(relId);
            const myGroupKey = groupByTaskId.get(task.id);
            if (!otherGroupKey || otherGroupKey === myGroupKey) continue;
            const bucket = counts.get(otherGroupKey) || { count: 0 };
            bucket.count += 1;
            counts.set(otherGroupKey, bucket);
        }
    }

    return [...counts.entries()]
        .map(([groupKey, info]) => {
            const group = groups.get(groupKey);
            return {
                key: groupKey,
                label: group?.cluster || groupKey,
                count: info.count,
                representativeId: group?.representativeAll?.id || '',
            };
        })
        .sort((a, b) => {
            if (a.count !== b.count) return b.count - a.count;
            return a.label.localeCompare(b.label);
        });
}

function renderClusterCard(group, idx) {
    const counts = group.counts;
    const rooms = group.rooms.length ? group.rooms.slice(0, 2).join(' · ') : 'unassigned';
    const moreRooms = group.rooms.length > 2 ? ` +${group.rooms.length - 2}` : '';
    const visibleSorted = [...group.visibleTasks].sort(compareByReadinessThenTaskq);
    const rep = group.representative || visibleSorted[0];
    const shownCount = visibleSorted.length;
    const row = (idx % 2) + 1;
    const cls = `cluster-card ${row === 1 ? 'timeline-top' : 'timeline-bottom'}`;
    const style = `grid-column:${idx + 1};grid-row:${row};`;

    const chips = [];
    if (group.isSynthetic) chips.push('<span class="chip">singleton</span>');
    if (counts.ready) chips.push(`<span class="chip ready">${counts.ready} ready</span>`);
    if (counts.inProgress) chips.push(`<span class="chip active">${counts.inProgress} active</span>`);
    if (counts.blocked) chips.push(`<span class="chip">${counts.blocked} blocked</span>`);
    if (shownCount !== counts.total) chips.push(`<span class="chip">${shownCount}/${counts.total} shown</span>`);

    const memberRows = visibleSorted.slice(0, 4).map((task) => {
        const color = STATUS_COLOR[task.status] || '#6b7076';
        return `<button class="cluster-task-row" data-tid="${esc(task.id)}" title="${esc(task.id)} · ${esc(task.status)}">
          <span class="dot" style="background:${color}"></span>
          <span class="tid">${esc(task.id)}</span>
          <span class="title">${esc(task.title || '')}</span>
        </button>`;
    }).join('');

    const moreTasks = visibleSorted.length > 4
        ? `<div class="cluster-more">+${visibleSorted.length - 4} more matching tasks</div>`
        : '';

    const upstream = renderLinkRow('needs', group.upstream);
    const downstream = renderLinkRow('unlocks', group.downstream);

    return `<div class="${cls}" style="${style}" data-cluster="${esc(group.key)}" data-tid="${esc(rep?.id || '')}">
      <div class="cluster-index">cluster ${idx + 1}</div>
      <div class="cluster-head">
        <div class="cluster-title">${esc(group.cluster)}</div>
        <div class="cluster-sub">${esc(rooms)}${esc(moreRooms)} · ${counts.open}/${counts.total} open</div>
      </div>
      <div class="cluster-chips">${chips.join('')}</div>
      <div class="cluster-best">top: <button class="cluster-best-link" data-tid="${esc(rep?.id || '')}">${esc(rep?.id || '')}</button>${rep?.title ? ` · ${esc(ellip(rep.title, 44))}` : ''}</div>
      <div class="cluster-members">${memberRows || '<div class="cluster-more">No matching tasks</div>'}${moreTasks}</div>
      <div class="cluster-links">${upstream}${downstream}</div>
    </div>`;
}

function renderLinkRow(label, links) {
    if (!links.length) {
        return `<div class="cluster-link-row"><span class="lbl">${esc(label)}</span><span class="cluster-link-empty">none</span></div>`;
    }
    const chips = links.slice(0, 4).map((link) =>
        `<button class="cluster-link-chip" data-tid="${esc(link.representativeId)}" title="${esc(link.label)}">${esc(link.label)} <span class="n">×${link.count}</span></button>`
    ).join('');
    const more = links.length > 4
        ? `<span class="cluster-link-empty">+${links.length - 4} more</span>`
        : '';
    return `<div class="cluster-link-row"><span class="lbl">${esc(label)}</span>${chips}${more}</div>`;
}

function ellip(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function cssEsc(s) { return String(s || '').replace(/"/g, '\\"'); }
