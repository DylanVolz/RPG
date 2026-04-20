/**
 * src/meta-panel.js — Fetch + render per-model structural metadata
 * (node hierarchy, part groups, skin/animation flags, material list)
 * produced by `tools/extract_gltf_meta.py` and served at
 *   /manifest/<pack>/<model>.meta.json
 *
 * Usage from a browser HTML:
 *   import { MetaPanel } from './src/meta-panel.js';
 *   const mp = new MetaPanel(document.getElementById('meta-panel'));
 *   mp.show(packSlug, modelName);
 *   mp.hide();
 */

const SUMMARY_FIELDS = [
    ['node_count',      'nodes',      'Total named nodes in the scene graph.'],
    ['mesh_count',      'meshes',     'Mesh primitives bound to those nodes.'],
    ['material_count',  'materials',  'Distinct material slots referenced.'],
    ['skin_count',      'skins',      'GLTF "skins" (armatures). 0 = not rigged.'],
    ['animation_count', 'animations', 'Baked animation clips shipped with the GLTF.'],
];


function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}


function renderHierarchyNode(node) {
    const hasKids = node.children && node.children.length > 0;
    const marker = node.has_mesh ? '◆' : '○';
    if (!hasKids) {
        return `<div class="mp-node"><span class="mp-m">${marker}</span>${escapeHtml(node.name)}</div>`;
    }
    const kids = node.children.map(renderHierarchyNode).join('');
    return `<details class="mp-branch"><summary><span class="mp-m">${marker}</span>${escapeHtml(node.name)} <span class="mp-dim">(${node.children.length})</span></summary>${kids}</details>`;
}


export class MetaPanel {
    constructor(container) {
        this.el = container;
        this.el.classList.add('mp-root');
        this.el.innerHTML = `
            <div class="mp-body">
                <div class="mp-status">Select a model to inspect its structure.</div>
            </div>
        `;
        this._ensureStyles();
    }

    _ensureStyles() {
        if (document.getElementById('_mp-styles')) return;
        const s = document.createElement('style');
        s.id = '_mp-styles';
        s.textContent = `
            .mp-root { display:flex; flex-direction:column;
                       font-family:'Georgia', serif; color:#c8b89a;
                       font-size:11px; line-height:1.5; }
            .mp-body { overflow-y:auto; padding:12px 14px;
                       scrollbar-width:thin; scrollbar-color:#2a2418 transparent; }
            .mp-status { color:rgba(200,184,154,0.4); font-size:10px; letter-spacing:1px; }
            .mp-title { font-size:13px; color:#e8d8b4; margin-bottom:8px; letter-spacing:1px; }
            .mp-subtitle { font-size:9px; color:rgba(200,184,154,0.4); letter-spacing:2px;
                           text-transform:uppercase; margin-top:14px; margin-bottom:5px; }
            .mp-kv { display:grid; grid-template-columns:1fr auto; gap:2px 10px; margin-bottom:6px; }
            .mp-kv .mp-k { color:rgba(200,184,154,0.55); }
            .mp-kv .mp-v { color:#e8d8b4; font-variant-numeric: tabular-nums; text-align:right; }
            .mp-badge { display:inline-block; padding:2px 8px; border-radius:2px;
                        font-size:9px; letter-spacing:1px; margin-right:4px;
                        background:rgba(200,184,154,0.12); color:#d4a84b;
                        border:1px solid rgba(200,184,154,0.2); }
            .mp-badge.on  { background:rgba(110,180,120,0.15); color:#a8d4a8;
                            border-color:rgba(110,180,120,0.3); }
            .mp-badge.off { background:rgba(200,184,154,0.08); color:rgba(200,184,154,0.4);
                            border-color:rgba(200,184,154,0.15); }
            .mp-groups { display:flex; flex-direction:column; gap:3px; }
            .mp-grp { display:grid; grid-template-columns:1fr auto; gap:8px; }
            .mp-grp details { width:100%; }
            .mp-grp summary { cursor:pointer; padding:2px 0; list-style:none; }
            .mp-grp summary::-webkit-details-marker { display:none; }
            .mp-grp .mp-k { color:rgba(200,184,154,0.55); text-transform:capitalize; }
            .mp-grp .mp-v { color:#e8d8b4; font-variant-numeric: tabular-nums; }
            .mp-grp .mp-members {
                padding:4px 0 6px 14px; font-size:10px; color:rgba(200,184,154,0.55);
                border-left:1px solid rgba(200,184,154,0.12); margin-left:4px;
                display:flex; flex-direction:column; gap:1px;
            }
            .mp-materials {
                display:flex; flex-wrap:wrap; gap:4px;
            }
            .mp-mat {
                padding:2px 6px; background:rgba(200,184,154,0.06);
                border:1px solid rgba(200,184,154,0.15); font-size:9px;
                color:rgba(200,184,154,0.6); letter-spacing:0.5px;
            }
            .mp-tree { margin-top:4px; font-size:10px; line-height:1.5;
                       color:rgba(200,184,154,0.65); max-height:360px; overflow-y:auto;
                       scrollbar-width:thin; scrollbar-color:#2a2418 transparent; }
            .mp-tree details { margin-left:0; }
            .mp-tree details details { margin-left:14px; }
            .mp-tree summary { cursor:pointer; list-style:none; padding:1px 0; }
            .mp-tree summary::-webkit-details-marker { display:none; }
            .mp-tree summary:hover, .mp-node:hover { color:#e8d8b4; }
            .mp-node { padding:1px 0 1px 14px; }
            .mp-m { color:rgba(200,184,154,0.35); width:14px; display:inline-block; }
            .mp-dim { color:rgba(200,184,154,0.25); font-size:9px; }
            .mp-err { color:#d46a5c; font-size:10px; letter-spacing:1px; }
            .mp-tip { color:rgba(200,184,154,0.3); font-size:9px;
                      font-style:italic; margin-top:4px; line-height:1.4; }
        `;
        document.head.appendChild(s);
    }

    async show(packSlug, modelName) {
        const body = this.el.querySelector('.mp-body');
        body.innerHTML = `<div class="mp-status">Loading metadata...</div>`;
        const url = `/manifest/${encodeURIComponent(packSlug)}/${encodeURIComponent(modelName)}.meta.json`;
        let meta;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            meta = await res.json();
        } catch (err) {
            body.innerHTML = `<div class="mp-err">Metadata unavailable: ${escapeHtml(err.message)}</div>`;
            return;
        }
        body.innerHTML = this._renderMeta(meta);
    }

    hide() {
        const body = this.el.querySelector('.mp-body');
        body.innerHTML = `<div class="mp-status">Select a model to inspect its structure.</div>`;
    }

    _renderMeta(m) {
        const riggableBadge = m.riggable
            ? `<span class="mp-badge on">riggable</span>`
            : `<span class="mp-badge off">not modular</span>`;
        const animBadge = m.animation_count > 0
            ? `<span class="mp-badge on">animated</span>`
            : `<span class="mp-badge off">static</span>`;
        const skinBadge = m.skin_count > 0
            ? `<span class="mp-badge on">has armature</span>`
            : `<span class="mp-badge off">no armature</span>`;

        const kvRows = SUMMARY_FIELDS
            .map(([k, label]) => `<div class="mp-k" title="${escapeHtml(SUMMARY_FIELDS.find(f => f[0] === k)[2])}">${label}</div><div class="mp-v">${m[k]}</div>`)
            .join('');

        const boundsRow = m.bounds_m
            ? `<div class="mp-k">bounds (m)</div><div class="mp-v">${m.bounds_m.w.toFixed(2)} × ${m.bounds_m.h.toFixed(2)} × ${m.bounds_m.d.toFixed(2)}</div>`
            : '';

        const groupRows = Object.entries(m.group_counts || {})
            .map(([grp, n]) => {
                const members = (m.group_members[grp] || []).map(escapeHtml);
                return `<div class="mp-grp">
                    <details>
                        <summary><span class="mp-k">${escapeHtml(grp)}</span></summary>
                        <div class="mp-members">${members.map(nm => `<span>${nm}</span>`).join('')}</div>
                    </details>
                    <span class="mp-v">${n}</span>
                </div>`;
            })
            .join('');

        const materials = (m.materials || []).length
            ? (m.materials || []).map(n => `<span class="mp-mat">${escapeHtml(n)}</span>`).join('')
            : `<span class="mp-tip">no material slots</span>`;

        const hierarchy = (m.hierarchy || []).map(renderHierarchyNode).join('');

        const riggingTip = m.riggable
            ? `<div class="mp-tip">Import in Blender → each node becomes a selectable Object with its shipped name. Parent-to-bone gives a prop rig (per-part rotation/translation) without weight-painting. Wheels/doors/turrets can animate directly off their named nodes.</div>`
            : '';

        return `
            <div class="mp-title">${escapeHtml(m.name)}</div>
            <div>${riggableBadge}${animBadge}${skinBadge}</div>

            <div class="mp-subtitle">summary</div>
            <div class="mp-kv">${kvRows}${boundsRow}</div>

            <div class="mp-subtitle">part groups (${Object.keys(m.group_counts || {}).length})</div>
            <div class="mp-groups">${groupRows}</div>
            ${riggingTip}

            <div class="mp-subtitle">materials (${(m.materials || []).length})</div>
            <div class="mp-materials">${materials}</div>

            <div class="mp-subtitle">scene hierarchy</div>
            <div class="mp-tree">${hierarchy}</div>
        `;
    }
}
