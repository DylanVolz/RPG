/**
 * src/task-graph.js — Cytoscape-powered swimlane DAG for the Task Viewer.
 *
 * Layout model:
 *   - Each `room` becomes a compound parent node (visual swimlane).
 *   - Task nodes are children of their room compound.
 *   - `depends_on` triples become edges (source depends_on target ⇒ arrow
 *     points from source to target, "needs X to complete").
 *   - Dagre lays out left→right; swimlanes stack vertically.
 *
 * Scales to the current 633 tasks / 1215 edges without stuttering on a
 * modern laptop. Cycles are tolerated (dagre handles them with back-edges).
 */

// Register the dagre layout plugin with cytoscape. The UMD bundle of
// cytoscape-dagre used to auto-register on load but newer versions require
// an explicit cytoscape.use() call. Safe to call unconditionally —
// cytoscape.use() is idempotent on already-registered extensions.
if (typeof window !== 'undefined' && window.cytoscape && window.cytoscapeDagre) {
    try { window.cytoscape.use(window.cytoscapeDagre); } catch (e) { /* already registered */ }
}

const DONE_STATUSES = new Set([
    'completed', 'completed-by-ai', 'deprecated', 'superseded', 'skipped',
]);

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

const SHAPE_BY_TYPE = {
    implementation: 'round-rectangle',
    research:       'hexagon',
    design:         'diamond',
    walkthrough:    'rhomboid',
    asset:          'ellipse',
    infrastructure: 'triangle',
};

/**
 * Build the Cytoscape instance. Returns a small controller object:
 *   { cy, setData(tasks), applyFilter(fn), select(id), fit(), destroy() }
 */
export function createTaskGraph(container, opts = {}) {
    const cy = cytoscape({
        container,
        wheelSensitivity: 0.25,
        minZoom: 0.1,
        maxZoom: 3.0,
        style: graphStyle(),
        layout: { name: 'preset' }, // real layout set after data load
    });

    // Wire interaction handlers — actual callbacks come from main.js
    cy.on('tap', 'node[?task]', (evt) => {
        if (opts.onNodeTap) opts.onNodeTap(evt.target.id(), evt);
    });
    cy.on('tap', 'edge', (evt) => {
        if (opts.onEdgeTap) opts.onEdgeTap(evt.target.data('source'), evt.target.data('target'), evt);
    });
    // Clicking the blank background clears selection / cancels modes.
    cy.on('tap', (evt) => {
        if (evt.target === cy) {
            if (opts.onBackgroundTap) opts.onBackgroundTap();
        }
    });

    let currentTasks = {};

    function setData(tasksById) {
        currentTasks = tasksById;
        const els = buildElements(tasksById);
        cy.elements().remove();
        cy.add(els);
        runLayout();
    }

    function runLayout() {
        try {
            cy.layout({
                name: 'dagre',
                rankDir: 'LR',      // left to right
                rankSep: 80,        // column gap
                nodeSep: 24,        // intra-rank gap
                edgeSep: 12,
                animate: false,
                fit: true,
                padding: 40,
                // Dagre handles cycles by introducing dummy nodes / reversed edges.
            }).run();
        } catch (e) {
            console.error('[task-graph] dagre layout threw, falling back to breadthfirst:', e);
            try {
                cy.layout({ name: 'breadthfirst', directed: true, padding: 40 }).run();
            } catch (e2) {
                console.error('[task-graph] breadthfirst also failed, using grid:', e2);
                cy.layout({ name: 'grid', padding: 40 }).run();
            }
        }
    }

    function applyFilter(matchPred, hidePred) {
        cy.batch(() => {
            cy.nodes('[?task]').forEach(n => {
                const t = currentTasks[n.id()];
                const hide  = t && hidePred ? hidePred(t) : false;
                const match = t ? matchPred(t) : false;
                n.toggleClass('hidden', hide);
                n.toggleClass('dim', !hide && !match);
            });
            cy.edges().forEach(e => {
                const s = currentTasks[e.source().id()];
                const t = currentTasks[e.target().id()];
                const srcHidden = s && hidePred && hidePred(s);
                const tgtHidden = t && hidePred && hidePred(t);
                const bothHidden = srcHidden && tgtHidden;
                const bothDim = s && t && !matchPred(s) && !matchPred(t) && !bothHidden;
                e.toggleClass('hidden', bothHidden);
                e.toggleClass('dim', bothDim);
            });
        });
    }

    function select(id) {
        cy.elements('.selected').removeClass('selected');
        const n = cy.getElementById(id);
        if (!n.empty()) {
            n.addClass('selected');
            // Highlight direct neighbours so dep context pops.
            n.connectedEdges().addClass('selected-edge');
        }
    }

    function clearSelection() {
        cy.elements('.selected, .selected-edge, .cycle-target, .valid-target, .add-source')
          .removeClass('selected selected-edge cycle-target valid-target add-source');
    }

    // For dep-add mode: highlight eligible / cycle-creating targets.
    function setAddDepSource(sourceId) {
        clearSelection();
        if (!sourceId) return;
        cy.getElementById(sourceId).addClass('add-source');
    }
    function markTargetCandidates(sourceId, wouldCycleIds) {
        cy.batch(() => {
            cy.nodes('[?task]').forEach(n => {
                if (n.id() === sourceId) return;
                if (wouldCycleIds.has(n.id()))       n.addClass('cycle-target');
                else                                  n.addClass('valid-target');
            });
        });
    }

    function addEdge(source, target) {
        cy.add({ data: { id: `${source}->${target}`, source, target } });
    }
    function removeEdge(source, target) {
        cy.getElementById(`${source}->${target}`).remove();
    }

    function fit() { cy.fit(undefined, 40); }
    function destroy() { cy.destroy(); }

    return {
        cy, setData, applyFilter, select, clearSelection,
        setAddDepSource, markTargetCandidates,
        addEdge, removeEdge, fit, destroy,
    };
}

// ── Element construction ────────────────────────────────────────────
function buildElements(tasksById) {
    const nodes = [];
    const edges = [];
    const rooms = new Map();

    for (const [tid, t] of Object.entries(tasksById)) {
        const room = t.room || '(unassigned)';
        if (!rooms.has(room)) rooms.set(room, 0);
        rooms.set(room, rooms.get(room) + 1);
    }

    // Compound parent per room — the swimlane.
    for (const room of rooms.keys()) {
        nodes.push({
            data: { id: `__room:${room}`, label: room, kind: 'room' },
            classes: 'swimlane',
            selectable: false,
            grabbable: false,
        });
    }

    for (const [tid, t] of Object.entries(tasksById)) {
        const room = t.room || '(unassigned)';
        const done = DONE_STATUSES.has(t.status);
        const shape = SHAPE_BY_TYPE[t.type] || 'round-rectangle';
        const isWalkType   = t.type === 'walkthrough';
        const isWalkVerify = t.verifiable_by === 'walkthrough';
        nodes.push({
            data: {
                id:       tid,
                parent:   `__room:${room}`,
                task:     true,
                label:    tid,
                title:    t.title || '',
                status:   t.status,
                type:     t.type,
                cluster:  t.cluster || '',
                phase:    t.phase || '',
                priority: t.priority || '',
                is_mvp:   !!t.is_mvp,
                fill:     STATUS_COLOR[t.status] || '#6b7076',
                shape,
                done,
                walkType:   isWalkType,
                walkVerify: isWalkVerify,
            },
            classes: [
                t.status,
                done ? 'done' : '',
                t.is_mvp ? 'mvp' : '',
                t.priority ? ('prio-' + String(t.priority).toLowerCase()) : '',
                isWalkType   ? 'walk-type'   : '',
                isWalkVerify ? 'walk-verify' : '',
            ].filter(Boolean).join(' '),
        });
    }

    let droppedEdges = 0;
    for (const [tid, t] of Object.entries(tasksById)) {
        for (const dep of (t.depends || [])) {
            // Skip edges whose target isn't in the rendered task set —
            // Cytoscape throws "Cannot set properties of undefined" on
            // orphan edges. Dep targets can be non-T-ID entities (ADRs,
            // external refs) or tasks whose has_status triple has been
            // fully invalidated.
            if (!tasksById[dep]) { droppedEdges++; continue; }
            edges.push({
                data: {
                    id:     `${tid}->${dep}`,
                    source: tid,
                    target: dep,
                    depDone: DONE_STATUSES.has(tasksById[dep].status),
                },
            });
        }
    }
    if (droppedEdges > 0) {
        console.warn(`[task-graph] dropped ${droppedEdges} edges to unknown targets`);
    }

    return [...nodes, ...edges];
}

// ── Styling ─────────────────────────────────────────────────────────
function graphStyle() {
    return [
        // Compound "swimlane" parent (one per room).
        {
            selector: 'node.swimlane',
            style: {
                'background-color':    'rgba(200,184,154,0.02)',
                'background-opacity':  1,
                'border-color':        'rgba(200,184,154,0.22)',
                'border-width':        1,
                'label':               'data(label)',
                'color':               '#c8b89a',
                'font-size':           10,
                'font-weight':         'bold',
                'text-valign':         'top',
                'text-halign':         'left',
                'text-margin-x':       10,
                'text-margin-y':       -2,
                'padding':             16,
                'shape':               'round-rectangle',
                'text-transform':      'uppercase',
                'letter-spacing':      2,
                'compound-sizing-wrt-labels': 'include',
            },
        },

        // Task nodes.
        {
            selector: 'node[?task]',
            style: {
                'background-color':    'data(fill)',
                'border-color':        'rgba(255,255,255,0.2)',
                'border-width':        1,
                'shape':               'data(shape)',
                'width':               44,
                'height':               22,
                'label':               'data(label)',
                'color':               '#ffffff',
                'font-size':           9,
                'text-valign':         'center',
                'text-halign':         'center',
                'text-outline-color':  '#000000',
                'text-outline-width':  1,
            },
        },
        { selector: 'node[?task].done', style: { 'opacity': 0.55 } },
        {
            selector: 'node[?task].mvp',
            style: { 'border-color': '#d4a84b', 'border-width': 2 },
        },
        // Walkthrough type: teal outer ring + larger-than-usual so shape reads.
        {
            selector: 'node[?task].walk-type',
            style: {
                'border-color':  '#7ccfd4',
                'border-width':   3,
                'overlay-color': '#7ccfd4', 'overlay-opacity': 0.08,
            },
        },
        // verifiable_by=walkthrough (but not itself a walkthrough task):
        // a subtle dashed teal border — says "testing story uses a walkthrough".
        {
            selector: 'node[?task].walk-verify:not(.walk-type)',
            style: {
                'border-color':  'rgba(124, 207, 212, 0.6)',
                'border-width':   2,
                'border-style':   'dashed',
            },
        },
        {
            selector: 'node[?task].selected',
            style: {
                'border-color': '#ffd76e', 'border-width': 3,
                'overlay-color': '#d4a84b', 'overlay-opacity': 0.15,
            },
        },

        // Edges: depends_on (source → target).
        {
            selector: 'edge',
            style: {
                'curve-style':         'bezier',
                'width':               1,
                'line-color':          'rgba(200,184,154,0.25)',
                'target-arrow-color':  'rgba(200,184,154,0.5)',
                'target-arrow-shape':  'triangle',
                'arrow-scale':         0.8,
            },
        },
        // Dep whose upstream (target) is not yet done → dashed, the bottleneck.
        {
            selector: 'edge[!depDone]',
            style: { 'line-style': 'dashed', 'line-color': 'rgba(204, 92, 92, 0.35)' },
        },
        {
            selector: 'edge.selected-edge',
            style: { 'line-color': '#ffd76e', 'target-arrow-color': '#ffd76e', 'width': 2 },
        },

        // Filter dim + full hide.
        { selector: 'node.dim, edge.dim',       style: { 'opacity': 0.15 } },
        { selector: 'node.hidden, edge.hidden', style: { 'display': 'none' } },

        // Dep-add mode markers.
        {
            selector: 'node.add-source',
            style: { 'border-color': '#d4a84b', 'border-width': 3,
                     'overlay-color': '#d4a84b', 'overlay-opacity': 0.2 },
        },
        {
            selector: 'node.valid-target',
            style: { 'background-blacken': -0.3, 'border-color': '#5c9c54', 'border-width': 2 },
        },
        {
            selector: 'node.cycle-target',
            style: { 'opacity': 0.3, 'border-color': '#cc5c5c' },
        },
    ];
}

export { DONE_STATUSES };
