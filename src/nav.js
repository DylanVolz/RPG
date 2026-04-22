/**
 * src/nav.js — Widget de navigation flottant
 *
 * Deux modes :
 *  • Accès direct (URL directe) : bouton ≡ flottant, navigation normale.
 *  • Dans le shell SPA (iframe)  : invisible — la barre d'onglets du shell gère tout.
 *    Les clics de navigation envoient un postMessage au shell parent.
 */
(function () {
    'use strict';

    const IN_FRAME = window !== window.top;

    // ── Fonction de navigation ───────────────────────────────────────────────
    // Quand on est dans le shell, on demande au parent de changer d'onglet.
    // Quand on est en accès direct, on navigue normalement.
    function navigate(toolId) {
        if (IN_FRAME) {
            window.top.postMessage({ type: 'tge-navigate', to: toolId }, '*');
        } else {
            const file = toolId === '' ? 'index.html' : toolId + '.html';
            window.location.href = file;
        }
    }

    // ── En iframe : le shell gère la navigation, on ne s'injecte pas ─────────
    if (IN_FRAME) return;

    // ── Accès direct : bouton ≡ flottant ─────────────────────────────────────
    const TOOLS = [
        { label: 'Accueil',         id: '',                  icon: '⌂',  cat: null },
        { label: 'Task Viewer',     id: 'task-viewer',       icon: '✓',  cat: 'Planning' },
        { label: 'Audio',           id: 'audio-browser',     icon: '♪',  cat: 'Environnement' },
        { label: 'Gameplay Test',   id: 'gameplay-test',     icon: '⚔',  cat: 'Gameplay' },
        { label: 'Char Builder',    id: 'char-builder',      icon: '◈',  cat: 'Personnage' },
{ label: 'Char Preview',    id: 'character-preview', icon: '◎',  cat: null },
        { label: 'Anim Inspector',  id: 'anim-inspect',      icon: '▶',  cat: null },
        { label: 'Asset Browser',   id: 'asset-browser',     icon: '❖',  cat: 'Environnement' },
        { label: 'Survival Tools',  id: 'survival-tools-browser', icon: '⚒', cat: 'Environnement' },
        { label: 'Vehicle Kit',     id: 'vehicle-kit-browser', icon: '🚚', cat: 'Environnement' },
        { label: 'Survival Kit',    id: 'survival-kit-browser', icon: '🧰', cat: 'Environnement' },
        { label: 'Construction Kit',id: 'construction-kit-browser', icon: '🏗', cat: 'Environnement' },
        { label: 'Nature Pack',     id: 'nature-pack-browser', icon: '🌳', cat: 'Environnement' },
        { label: 'Farm',            id: 'farm-browser',      icon: '🌾', cat: 'Environnement' },
        { label: 'Forest Village',  id: 'forest-village-browser', icon: '🏘', cat: 'Environnement' },
        { label: 'Food',            id: 'survival-food-browser', icon: '🥫', cat: 'Environnement' },
        { label: 'Medical',         id: 'medical-kit-browser', icon: '💊', cat: 'Environnement' },
        { label: 'Weapons',         id: 'weapons-kit-browser', icon: '🔫', cat: 'Environnement' },
        { label: 'Shooting Range',  id: 'shooting-range-browser', icon: '🎯', cat: 'Environnement' },
        { label: 'Melee Weapons',   id: 'melee-weapons-browser', icon: '🗡', cat: 'Environnement' },
        { label: 'Subway',          id: 'subway-browser',    icon: '🚇', cat: 'Environnement' },
        { label: 'Workshop',        id: 'workshop-browser',  icon: '🔧', cat: 'Environnement' },
        { label: 'World Builder',   id: 'world-builder',     icon: '⬡',  cat: 'Éditeur' },
        { label: 'Grip Editor',     id: 'grip-editor',       icon: '✦',  cat: null },
    ];

    const currentFile = window.location.pathname.split('/').pop() || 'index.html';
    const currentId   = currentFile === 'index.html' ? '' : currentFile.replace(/\.html$/, '');

    // ── Styles ───────────────────────────────────────────────────────────────
    const css = `
        #_nav-widget {
            position: fixed; bottom: 18px; right: 18px;
            z-index: 99999; font-family: 'Georgia', serif; user-select: none;
        }
        #_nav-toggle {
            width: 34px; height: 34px;
            background: rgba(8,6,4,0.90);
            border: 1px solid rgba(200,184,154,0.22);
            color: #c8b89a; font-size: 17px; line-height: 1;
            cursor: pointer; display: flex; align-items: center;
            justify-content: center; transition: border-color 0.2s, color 0.2s;
            padding: 0; outline: none;
        }
        #_nav-toggle:hover { border-color: rgba(200,184,154,0.55); color: #e8d8b4; }
        #_nav-toggle._open { border-color: rgba(200,184,154,0.45); color: #d4a84b; }
        #_nav-menu {
            position: absolute; bottom: 42px; right: 0;
            background: rgba(8,6,4,0.97); border: 1px solid rgba(200,184,154,0.18);
            min-width: 200px; padding: 6px 0; display: none;
            box-shadow: 0 -8px 32px rgba(0,0,0,0.8);
        }
        #_nav-menu._open { display: block; }
        #_nav-menu ._nav-cat {
            font-size: 8px; letter-spacing: 3.5px; text-transform: uppercase;
            color: rgba(200,184,154,0.25); padding: 8px 14px 4px;
        }
        #_nav-menu ._nav-cat:first-child { padding-top: 4px; }
        #_nav-menu ._nav-item {
            display: flex; align-items: center; gap: 9px;
            padding: 7px 14px; color: #b8a88a;
            font-size: 11px; letter-spacing: 1.2px;
            transition: background 0.12s, color 0.12s;
            border-left: 2px solid transparent; cursor: pointer;
        }
        #_nav-menu ._nav-item:hover { background: rgba(200,184,154,0.07); color: #e0d0b0; }
        #_nav-menu ._nav-item._current { color: #d4a84b; border-left-color: rgba(212,168,75,0.6); cursor: default; }
        #_nav-menu ._nav-item._current ._nicon { opacity: 0.9; }
        #_nav-menu ._nicon { opacity: 0.55; font-size: 13px; width: 14px; text-align: center; flex-shrink: 0; }
        #_nav-menu ._nav-sep { height: 1px; background: rgba(200,184,154,0.08); margin: 5px 0; }
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // ── Widget DOM ───────────────────────────────────────────────────────────
    const widget = document.createElement('div');
    widget.id = '_nav-widget';

    const toggle = document.createElement('button');
    toggle.id = '_nav-toggle';
    toggle.innerHTML = '&#8801;';
    toggle.title = 'Navigation outils';

    const menu = document.createElement('div');
    menu.id = '_nav-menu';

    let lastCat = undefined;
    TOOLS.forEach(t => {
        if (t.cat !== undefined && t.cat !== lastCat) {
            if (lastCat !== undefined) {
                const sep = document.createElement('div');
                sep.className = '_nav-sep';
                menu.appendChild(sep);
            }
            if (t.cat !== null) {
                const cat = document.createElement('div');
                cat.className = '_nav-cat';
                cat.textContent = t.cat;
                menu.appendChild(cat);
            }
            lastCat = t.cat;
        }

        const item = document.createElement('div');
        item.className = '_nav-item' + (t.id === currentId ? ' _current' : '');

        const icon = document.createElement('span');
        icon.className = '_nicon';
        icon.textContent = t.icon;
        item.appendChild(icon);
        item.appendChild(document.createTextNode(t.label));

        if (t.id !== currentId) {
            item.addEventListener('click', () => {
                menu.classList.remove('_open');
                toggle.classList.remove('_open');
                navigate(t.id);
            });
        }
        menu.appendChild(item);
    });

    // ── Toggle ───────────────────────────────────────────────────────────────
    toggle.addEventListener('click', e => {
        e.stopPropagation();
        const open = menu.classList.toggle('_open');
        toggle.classList.toggle('_open', open);
    });
    document.addEventListener('click', () => {
        menu.classList.remove('_open');
        toggle.classList.remove('_open');
    });
    menu.addEventListener('click', e => e.stopPropagation());

    widget.appendChild(menu);
    widget.appendChild(toggle);

    const inject = () => document.body.appendChild(widget);
    document.body ? inject() : document.addEventListener('DOMContentLoaded', inject);
})();
