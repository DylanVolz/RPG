/**
 * src/asset-check.js — Détection des packs Quaternius manquants
 *
 * Injecter avec <script src="src/asset-check.js"></script>
 * Probe HEAD sur un fichier représentatif par pack.
 * Affiche un panneau discret listant les packs absents + liens.
 */
(function () {
    'use strict';

    // ── Définition des packs ────────────────────────────────────────
    const PACKS = [
        {
            id      : 'ual-standard',
            name    : 'Universal Animation Library',
            desc    : 'Animations de base — locomotion, combat, interactions',
            tier    : 'free',
            tierLbl : 'Gratuit',
            url     : 'https://quaternius.com/packs/ultimateanimationlibrary.html',
            probe   : 'assets/characters/animations/UAL1_Standard.glb',
        },
        {
            id      : 'ual2-standard',
            name    : 'Universal Animation Library 2',
            desc    : 'Parkour, escalade, animations avancées',
            tier    : 'free',
            tierLbl : 'Gratuit',
            url     : 'https://quaternius.com/packs/ultimateanimationlibrary.html',
            probe   : 'assets/characters/animations/UAL2_Standard.glb',
        },
        {
            id      : 'ual-source',
            name    : 'Animation Library — Source',
            desc    : 'Versions haute résolution avec fichiers .blend',
            tier    : 'patreon',
            tierLbl : 'Patreon · Source',
            url     : 'https://www.patreon.com/quaternius',
            probe   : 'assets/characters/animations/UAL1_Source.glb',
            optional: true,
        },
        {
            id      : 'char-outfits',
            name    : 'Modular Character Outfits - Fantasy',
            desc    : 'Corps, tenues, cheveux, barbes modulaires',
            tier    : 'patreon',
            tierLbl : 'Patreon · Source',
            url     : 'https://www.patreon.com/quaternius',
            probe   : 'assets/characters/bodies/Superhero_Male_FullBody.gltf',
        },
        {
            id      : 'village',
            name    : 'Medieval Village MegaKit',
            desc    : 'Bâtiments, murs, meubles, props médiévaux',
            tier    : 'free',
            tierLbl : 'Gratuit',
            url     : 'https://quaternius.com/packs/medievalvillagemegakit.html',
            probe   : 'assets/environment/village/Balcony_Cross_Corner.gltf',
        },
        {
            id      : 'nature',
            name    : 'Nature Pack',
            desc    : 'Arbres, buissons, rochers, végétation',
            tier    : 'free',
            tierLbl : 'Gratuit',
            url     : 'https://quaternius.com/packs/ultimatenature.html',
            probe   : 'assets/environment/nature/BirchTree_1.gltf',
        },
        {
            id      : 'props',
            name    : 'Fantasy Props MegaKit',
            desc    : 'Armes, outils, décorations fantasy',
            tier    : 'free',
            tierLbl : 'Gratuit',
            url     : 'https://quaternius.com/packs/fantasypropsmegakit.html',
            probe   : 'assets/environment/props/Sword_Bronze.gltf',
        },
    ];

    // ── Styles ──────────────────────────────────────────────────────
    const css = `
        #_ac-widget {
            position: fixed;
            bottom: 60px;
            right: 18px;
            z-index: 99998;
            font-family: 'Georgia', serif;
            max-width: 300px;
        }
        #_ac-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(8,6,4,0.92);
            border: 1px solid rgba(200,120,60,0.4);
            color: #d4884b;
            font-size: 9px;
            letter-spacing: 2px;
            text-transform: uppercase;
            padding: 6px 12px;
            cursor: pointer;
            transition: border-color 0.2s;
            width: 100%;
            text-align: left;
        }
        #_ac-toggle:hover { border-color: rgba(200,120,60,0.7); }
        #_ac-toggle._open { border-bottom-color: transparent; }
        #_ac-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            background: rgba(200,120,60,0.25);
            border-radius: 50%;
            font-size: 9px;
            flex-shrink: 0;
        }
        #_ac-panel {
            display: none;
            background: rgba(8,6,4,0.97);
            border: 1px solid rgba(200,120,60,0.4);
            border-top: none;
            padding: 10px 0 6px;
        }
        #_ac-panel._open { display: block; }
        ._ac-header {
            font-size: 8px;
            letter-spacing: 3px;
            text-transform: uppercase;
            color: rgba(200,184,154,0.3);
            padding: 0 12px 8px;
            border-bottom: 1px solid rgba(200,184,154,0.07);
            margin-bottom: 6px;
        }
        ._ac-pack {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 6px 12px;
            transition: background 0.1s;
        }
        ._ac-pack:hover { background: rgba(200,184,154,0.04); }
        ._ac-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            flex-shrink: 0;
            margin-top: 4px;
        }
        ._ac-dot.free    { background: #6ab04c; }
        ._ac-dot.patreon { background: #f96854; }
        ._ac-dot.opt     { background: #888; }
        ._ac-info { flex: 1; min-width: 0; }
        ._ac-name {
            font-size: 10px;
            color: #c8b89a;
            margin-bottom: 2px;
            line-height: 1.3;
        }
        ._ac-desc {
            font-size: 9px;
            color: rgba(200,184,154,0.35);
            font-style: italic;
            line-height: 1.4;
            margin-bottom: 3px;
        }
        ._ac-link {
            font-size: 8px;
            letter-spacing: 1px;
            text-transform: uppercase;
            text-decoration: none;
            padding: 2px 6px;
            border: 1px solid;
            display: inline-block;
            transition: all 0.15s;
        }
        ._ac-link.free    { color: #6ab04c; border-color: rgba(106,176,76,0.35); }
        ._ac-link.free:hover { background: rgba(106,176,76,0.1); }
        ._ac-link.patreon { color: #f96854; border-color: rgba(249,104,84,0.35); }
        ._ac-link.patreon:hover { background: rgba(249,104,84,0.1); }
        ._ac-footer {
            font-size: 8px;
            letter-spacing: 1.5px;
            color: rgba(200,184,154,0.18);
            text-align: center;
            padding: 8px 12px 0;
            border-top: 1px solid rgba(200,184,154,0.07);
            margin-top: 6px;
        }
        ._ac-footer a {
            color: rgba(200,184,154,0.35);
            text-decoration: none;
        }
        ._ac-footer a:hover { color: rgba(200,184,154,0.7); }
    `;

    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // ── Probe HEAD ──────────────────────────────────────────────────
    async function probe(url) {
        try {
            const r = await fetch(url, { method: 'HEAD' });
            return r.ok;
        } catch {
            return false;
        }
    }

    async function run() {
        const results = await Promise.all(PACKS.map(async p => ({
            pack   : p,
            present: await probe(p.probe),
        })));

        const missing = results.filter(r => !r.present).map(r => r.pack);
        if (missing.length === 0) return; // tout est présent, rien à afficher

        // ── Widget DOM ───────────────────────────────────────────────
        const widget = document.createElement('div');
        widget.id = '_ac-widget';

        const toggle = document.createElement('div');
        toggle.id = '_ac-toggle';
        toggle.innerHTML =
            `<span id="_ac-badge">${missing.length}</span>` +
            `<span>Pack${missing.length > 1 ? 's' : ''} manquant${missing.length > 1 ? 's' : ''}</span>`;

        const panel = document.createElement('div');
        panel.id = '_ac-panel';

        const header = document.createElement('div');
        header.className = '_ac-header';
        header.textContent = 'Assets Quaternius requis';
        panel.appendChild(header);

        for (const pack of missing) {
            const cls   = pack.optional ? 'opt' : pack.tier;
            const row   = document.createElement('div');
            row.className = '_ac-pack';
            row.innerHTML = `
                <div class="_ac-dot ${cls}"></div>
                <div class="_ac-info">
                    <div class="_ac-name">${pack.name}</div>
                    <div class="_ac-desc">${pack.desc}</div>
                    <a class="_ac-link ${pack.tier}" href="${pack.url}" target="_blank" rel="noopener">
                        ${pack.tierLbl} ↗
                    </a>
                </div>
            `;
            panel.appendChild(row);
        }

        const footer = document.createElement('div');
        footer.className = '_ac-footer';
        footer.innerHTML =
            `Assets 3D par <a href="https://quaternius.com" target="_blank" rel="noopener">quaternius.com</a>` +
            ` — libres de droits`;
        panel.appendChild(footer);

        toggle.addEventListener('click', e => {
            e.stopPropagation();
            const open = panel.classList.toggle('_open');
            toggle.classList.toggle('_open', open);
        });
        document.addEventListener('click', () => {
            panel.classList.remove('_open');
            toggle.classList.remove('_open');
        });
        panel.addEventListener('click', e => e.stopPropagation());

        widget.appendChild(panel);
        widget.appendChild(toggle);

        const inject = () => document.body.appendChild(widget);
        document.body ? inject() : document.addEventListener('DOMContentLoaded', inject);
    }

    // Lancer après chargement de la page pour ne pas bloquer le rendu
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
