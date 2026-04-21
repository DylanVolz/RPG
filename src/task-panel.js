/**
 * src/task-panel.js — Detail panel for the selected task.
 *
 * Renders: title + badge stripe + all current triples + incoming refs +
 * status history + action buttons (status transitions + dep add/remove).
 * Defers the actual mutation to the callbacks passed in by main.js.
 */

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

const STATUS_TRANSITIONS = {
    // From → allowed next statuses (with button labels + danger flags).
    'not-started': [
        { to: 'in-progress', label: 'claim',      danger: false },
        { to: 'blocked',     label: 'block',      danger: false, needsReason: true },
        { to: 'future-maybe', label: 'future-maybe', danger: false, needsReason: true },
        { to: 'deprecated',  label: 'deprecate',  danger: true,  needsReason: true },
    ],
    'in-progress': [
        { to: 'completed',   label: 'complete',   danger: false },
        { to: 'blocked',     label: 'block',      danger: false, needsReason: true },
        { to: 'not-started', label: 'un-claim',   danger: false },
    ],
    'blocked': [
        { to: 'not-started', label: 'unblock',    danger: false },
        { to: 'in-progress', label: 'resume',     danger: false },
        { to: 'completed',   label: 'complete',   danger: false },
    ],
    'future-maybe': [
        { to: 'not-started', label: 'promote',    danger: false },
        { to: 'deprecated',  label: 'deprecate',  danger: true,  needsReason: true },
    ],
    'completed': [
        { to: 'not-started', label: 're-open',    danger: true,  needsReason: true },
    ],
    'completed-by-ai': [
        { to: 'not-started', label: 're-open',    danger: true,  needsReason: true },
    ],
};

const PRED_LABEL = {
    has_title:          'title',
    has_status:         'status',
    has_type:           'type',
    has_phase:          'phase',
    has_priority:       'priority',
    belongs_to:         'room',
    feature_cluster:    'cluster',
    produces:           'produces',
    verifiable_by:      'verifiable_by',
    is_mvp:             'mvp',
    mvp_order:          'mvp_order',
    blocked_reason:     'block reason',
    future_maybe_reason:'future reason',
    commit_sha:         'commit sha',
    supersedes:         'supersedes',
    superseded_by:      'superseded by',
};

// Predicates we render in the "all current triples" metadata section.
// Excludes has_status + has_title (shown in the header) and depends_on
// (has its own section).
const METADATA_PREDICATES = [
    'has_type', 'has_phase', 'belongs_to', 'feature_cluster', 'has_priority',
    'is_mvp', 'mvp_order', 'verifiable_by', 'produces',
    'blocked_reason', 'future_maybe_reason', 'commit_sha',
    'supersedes', 'superseded_by',
];

export class TaskPanel {
    constructor(container, callbacks) {
        this.container = container;
        this.cb        = callbacks || {};
        this.currentId = null;
    }

    showEmpty(msg) {
        this.currentId = null;
        this.container.innerHTML = `
            <p style="color:#8a7e68; font-style:italic;">${msg || 'Click a task to see details.'}</p>
        `;
    }

    showLoading(tid) {
        this.container.innerHTML = `
            <h2>Loading…</h2>
            <div class="tid">${esc(tid)}</div>
        `;
    }

    /**
     * detail shape from /api/tasks/T-XXXX:
     *   { id, current: {pred: [{object, valid_from}, ...], ...},
     *     incoming: [{subject, predicate}, ...],
     *     status_history: [{status, valid_from, valid_to}, ...] }
     */
    render(detail, allTasksById) {
        this.currentId = detail.id;
        const cur   = detail.current || {};
        const title = firstObj(cur.has_title) || '(untitled)';
        const status = firstObj(cur.has_status) || 'unknown';
        const statusColor = STATUS_COLOR[status] || '#6b7076';
        const type  = firstObj(cur.has_type) || '';
        const phase = firstObj(cur.has_phase) || '';
        const room  = firstObj(cur.belongs_to) || '';
        const cluster = firstObj(cur.feature_cluster) || '';

        const deps = (cur.depends_on || []).map(x => x.object);
        const incomingDeps = (detail.incoming || []).filter(r => r.predicate === 'depends_on');
        const otherIncoming = (detail.incoming || []).filter(r => r.predicate !== 'depends_on');

        const mdRows = METADATA_PREDICATES
            .map(p => ({ p, vs: cur[p] || [] }))
            .filter(x => x.vs.length)
            .map(x => `
                <div class="kv">
                  <span class="k">${esc(PRED_LABEL[x.p] || x.p)}</span>
                  <span class="v">${esc(x.vs.map(v => v.object).join(', '))}</span>
                </div>`).join('');

        const depChips = deps.length
            ? deps.map(d => {
                const t  = (allTasksById || {})[d];
                const ok = t && (t.status === 'completed' || t.status === 'completed-by-ai');
                const lbl = t ? `${d} — ${ellip(t.title, 36)}` : d;
                const color = ok ? '#5c9c54' : '#cc5c5c';
                return `
                  <span class="chip dep-link" data-nav="${esc(d)}" title="navigate to ${esc(d)}">
                    <span style="color:${color}; margin-right:4px;">●</span>${esc(lbl)}
                  </span>
                  <span class="chip remove" data-rmdep="${esc(d)}" title="remove dependency">×</span>
                `;
              }).join('')
            : '<span style="color:#8a7e68; font-size:11px;">(no dependencies)</span>';

        const incomingDepChips = incomingDeps.length
            ? incomingDeps.map(r => `
                  <span class="chip dep-link" data-nav="${esc(r.subject)}" title="navigate to ${esc(r.subject)}">
                    ${esc(r.subject)}
                  </span>`).join('')
            : '<span style="color:#8a7e68; font-size:11px;">(none)</span>';

        const otherIncomingChips = otherIncoming.length
            ? otherIncoming.map(r => `
                  <span class="chip" title="${esc(r.predicate)}">
                    ${esc(r.subject)} <span style="color:#8a7e68;">(${esc(r.predicate)})</span>
                  </span>`).join('')
            : '';

        const history = (detail.status_history || [])
            .map(h => `
              <div class="history-row">
                <span class="dot" style="background:${STATUS_COLOR[h.status] || '#6b7076'}"></span>
                <span>${esc(h.valid_from || '—')} → ${esc(h.valid_to || 'current')}</span>
                <span style="color:${STATUS_COLOR[h.status] || '#6b7076'};">${esc(h.status)}</span>
              </div>`).join('');

        const transitions = STATUS_TRANSITIONS[status] || [];
        const actionBtns = transitions.map(tr => `
            <button class="${tr.danger ? 'danger' : ''}"
                    data-transition="${esc(tr.to)}"
                    data-needs-reason="${tr.needsReason ? '1' : '0'}">
              ${esc(tr.label)}
            </button>`).join('');

        this.container.innerHTML = `
            <h2>${esc(title)}</h2>
            <div class="tid">${esc(detail.id)} · <span style="color:${statusColor}">${esc(status)}</span>${
                type ? ` · ${esc(type)}` : ''}${phase ? ` · phase ${esc(phase)}` : ''}${
                room ? ` · ${esc(room)}` : ''}${cluster ? ` · ${esc(cluster)}` : ''}</div>

            <section>
                <h3>Status actions</h3>
                <div class="actions">
                    ${actionBtns || '<span style="color:#8a7e68;">(no valid transitions from this status)</span>'}
                </div>
            </section>

            <section>
                <h3>Dependencies <span style="color:#8a7e68;">(this needs…)</span></h3>
                <div>${depChips}</div>
                <div class="actions" style="margin-top:6px;">
                    <button data-action="add-dep">+ add dependency…</button>
                </div>
            </section>

            <section>
                <h3>Used by <span style="color:#8a7e68;">(…depends on this)</span></h3>
                <div>${incomingDepChips}</div>
            </section>

            ${mdRows ? `<section><h3>Metadata</h3>${mdRows}</section>` : ''}

            ${otherIncomingChips ? `<section><h3>Incoming references</h3><div>${otherIncomingChips}</div></section>` : ''}

            <section>
                <h3>Status history</h3>
                ${history || '<span style="color:#8a7e68;">(no history)</span>'}
            </section>
        `;

        // Wire up interactions.
        this.container.querySelectorAll('[data-transition]').forEach(btn => {
            btn.addEventListener('click', () => {
                const to          = btn.getAttribute('data-transition');
                const needsReason = btn.getAttribute('data-needs-reason') === '1';
                this._onTransition(to, needsReason);
            });
        });
        this.container.querySelectorAll('[data-nav]').forEach(el => {
            el.addEventListener('click', () => {
                const target = el.getAttribute('data-nav');
                if (this.cb.onNavigate) this.cb.onNavigate(target);
            });
        });
        this.container.querySelectorAll('[data-rmdep]').forEach(el => {
            el.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const target = el.getAttribute('data-rmdep');
                if (confirm(`Remove dependency ${detail.id} → ${target}?`)) {
                    if (this.cb.onRemoveDep) this.cb.onRemoveDep(detail.id, target);
                }
            });
        });
        const addBtn = this.container.querySelector('[data-action="add-dep"]');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                if (this.cb.onEnterAddDepMode) this.cb.onEnterAddDepMode(detail.id);
            });
        }
    }

    _onTransition(toStatus, needsReason) {
        let reason;
        if (needsReason) {
            reason = prompt(`Reason for marking as "${toStatus}":`, '');
            if (reason === null) return; // cancelled
            reason = reason.trim();
            if (!reason) {
                if (!confirm(`Proceed with empty reason?`)) return;
                reason = '';
            }
        }
        if (this.cb.onStatusChange) {
            this.cb.onStatusChange(this.currentId, toStatus, reason);
        }
    }
}

// ── helpers ────────────────────────────────────────────────────────
function firstObj(vs) { return vs && vs.length ? vs[0].object : undefined; }
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function ellip(s, n) {
    const str = String(s || '');
    return str.length <= n ? str : str.slice(0, n - 1) + '…';
}
