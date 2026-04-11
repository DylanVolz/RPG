// ═══════════════════════════════════════════════════════════════
//  CHAR-CREATION.JS — Écran de création de personnage
//
//  Overlay fullscreen avec aperçu 3D temps réel.
//  Utilise CharacterController pour l'assemblage (hair, couleurs, os).
//
//  Usage :
//    import { showCharCreation } from './src/char-creation.js';
//
//    // Premier lancement — obligatoire
//    if (!localStorage.getItem('darkrpg_character_v1')) {
//        await showCharCreation();
//    }
//
//    // Depuis le menu pause — bouton "Edit Character"
//    await showCharCreation({ allowSkip: true });
// ═══════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { OrbitControls }      from 'three/addons/controls/OrbitControls.js';
import { CharacterController } from './character.js';

// ─── Chemins assets ──────────────────────────────────────────────
const P_BODY   = {
    M: 'assets/characters/bodies/Superhero_Male_FullBody.gltf',
    F: 'assets/characters/bodies/Superhero_Female_FullBody.gltf',
};
const P_OUTFIT = 'assets/characters/outfits/';
const P_HAIR   = 'assets/characters/hair/';

// UAL — premier fichier qui charge est utilisé pour toute la session
const UAL_CANDIDATES = [
    'assets/characters/animations/UAL2_Source.glb',
    'assets/characters/animations/UAL2_Standard.glb',
    'assets/characters/animations/UAL1_Source.glb',
    'assets/characters/animations/UAL1_Standard.glb',
];

// ─── Options de personnalisation ─────────────────────────────────
const OUTFITS = {
    M: [
        { val:'Male_Ranger',       label:'Ranger' },
        { val:'Male_Peasant',      label:'Peasant' },
        { val:'Male_Knight',       label:'Knight' },
        { val:'Male_Knight_Cloth', label:'Knight Cloth' },
        { val:'Male_Noble',        label:'Noble' },
        { val:'Male_Wizard',       label:'Wizard' },
    ],
    F: [
        { val:'Female_Ranger',       label:'Ranger' },
        { val:'Female_Peasant',      label:'Peasant' },
        { val:'Female_Knight',       label:'Knight' },
        { val:'Female_Knight_Cloth', label:'Knight Cloth' },
        { val:'Female_Noble',        label:'Noble' },
        { val:'Female_Wizard',       label:'Wizard' },
    ],
};
const HAIRS = [
    { val:'',                  label:'None' },
    { val:'Hair_Long',         label:'Long' },
    { val:'Hair_SimpleParted', label:'Parted' },
    { val:'Hair_Buzzed',       label:'Buzzed ♂' },
    { val:'Hair_BuzzedFemale', label:'Buzzed ♀' },
    { val:'Hair_Buns',         label:'Buns' },
];
const BEARDS = [
    { val:'',           label:'None' },
    { val:'Hair_Beard', label:'Beard' },
];

// ClipMap — assez de clips pour que le fallback de CharacterController trouve l'idle
const CLIP_MAP = {
    idle       : 'Idle_Loop',
    walk       : 'Walk_Loop',
    run        : 'Sprint_Loop',
    jump       : 'Jump_Start',
    fall       : 'Jump_Loop',
    crouch_idle: 'Crouch_Idle_Loop',
    crouch_walk: 'Crouch_Fwd_Loop',
};

// PlayerState statique pour la preview (position, état)
const PREVIEW_PS = {
    position   : new THREE.Vector3(0, 0, 0),
    rotationY  : 0,
    isMoving   : false,
    isSprinting: false,
    isCrouching: false,
    isGrounded : true,
    vy         : 0,
};

// ─── Cache UAL (module-level) ─────────────────────────────────────
let _ualUrlCache = null;
let _ualUrlPromise = null;

async function resolveUALUrl() {
    if (_ualUrlCache) return _ualUrlCache;
    if (_ualUrlPromise) return _ualUrlPromise;
    _ualUrlPromise = (async () => {
        for (const url of UAL_CANDIDATES) {
            try {
                const r = await fetch(url, { method:'HEAD' });
                if (r.ok) { _ualUrlCache = url; return url; }
            } catch { /* essayer le suivant */ }
        }
        console.warn('[CharCreation] Aucun fichier UAL trouvé — preview sans animation');
        return null;
    })();
    return _ualUrlPromise;
}

// ─── CSS ──────────────────────────────────────────────────────────
const CSS = `
#cc-overlay {
    position:fixed; inset:0; z-index:9999;
    background:#080a0c; display:flex; align-items:stretch;
    font-family:'Georgia',serif; color:#c8b89a;
    opacity:0; transition:opacity 0.6s ease;
}
#cc-overlay.cc-visible { opacity:1; }

/* ── Panneau gauche ── */
#cc-panel {
    width:300px; flex-shrink:0;
    background:rgba(4,5,7,0.8);
    border-right:1px solid rgba(200,184,154,0.08);
    display:flex; flex-direction:column; overflow:hidden;
}
#cc-panel-inner {
    flex:1; overflow-y:auto; padding:30px 18px 12px;
    scrollbar-width:thin; scrollbar-color:#1e1a14 transparent;
}
#cc-panel-inner::-webkit-scrollbar { width:3px; }
#cc-panel-inner::-webkit-scrollbar-thumb { background:#1e1a14; }

#cc-title {
    font-size:8px; letter-spacing:5px; text-transform:uppercase;
    color:rgba(200,184,154,0.3); margin-bottom:30px;
}
.cc-section { margin-bottom:20px; }
.cc-label {
    display:block; font-size:8px; letter-spacing:3px;
    text-transform:uppercase; color:rgba(200,184,154,0.3); margin-bottom:7px;
}

/* Name */
#cc-name {
    width:100%; box-sizing:border-box;
    background:rgba(200,184,154,0.04); border:1px solid rgba(200,184,154,0.15);
    color:#c8b89a; padding:9px 12px; font-family:'Georgia',serif;
    font-size:13px; letter-spacing:1px; outline:none;
}
#cc-name:focus { border-color:rgba(200,184,154,0.4); }
#cc-name::placeholder { color:rgba(200,184,154,0.18); font-style:italic; }

/* Toggle M/F */
.cc-toggle { display:flex; gap:3px; }
.cc-toggle-btn {
    flex:1; padding:8px 0; font-size:10px; letter-spacing:1px; text-align:center;
    cursor:pointer; background:rgba(200,184,154,0.04); border:1px solid rgba(200,184,154,0.12);
    color:rgba(200,184,154,0.35); transition:all 0.12s; user-select:none;
}
.cc-toggle-btn:hover { background:rgba(200,184,154,0.09); color:rgba(200,184,154,0.7); }
.cc-toggle-btn.cc-active {
    background:rgba(200,184,154,0.14); border-color:rgba(200,184,154,0.4); color:#c8b89a;
}

/* Options grille */
.cc-grid { display:flex; flex-direction:column; gap:2px; }
.cc-opt {
    padding:7px 11px; font-size:10px; letter-spacing:1px; cursor:pointer;
    background:rgba(200,184,154,0.03); border:1px solid rgba(200,184,154,0.08);
    color:rgba(200,184,154,0.4); transition:all 0.1s; user-select:none;
}
.cc-opt:hover { background:rgba(200,184,154,0.09); color:rgba(200,184,154,0.75); }
.cc-opt.cc-active {
    background:rgba(200,184,154,0.14); border-color:rgba(200,184,154,0.38); color:#c8b89a;
}

/* Couleurs */
.cc-colors { display:flex; flex-direction:column; gap:7px; }
.cc-color-row { display:flex; align-items:center; gap:8px; }
.cc-color-row span { font-size:10px; letter-spacing:1px; color:rgba(200,184,154,0.4); flex:1; }
.cc-color-row input[type=color] {
    width:32px; height:22px; border:1px solid rgba(200,184,154,0.18);
    background:none; cursor:pointer; padding:1px; flex-shrink:0;
}
.cc-color-reset {
    font-size:8px; letter-spacing:1px; color:rgba(200,184,154,0.25);
    cursor:pointer; padding:2px 6px; border:1px solid rgba(200,184,154,0.12);
    background:none; transition:all 0.1s; flex-shrink:0;
}
.cc-color-reset:hover { color:rgba(200,184,154,0.65); border-color:rgba(200,184,154,0.3); }

/* Footer */
#cc-footer { padding:14px 18px; border-top:1px solid rgba(200,184,154,0.07); }
#cc-confirm {
    width:100%; padding:12px 0; font-family:'Georgia',serif;
    font-size:10px; letter-spacing:3px; text-transform:uppercase;
    background:rgba(200,184,154,0.09); border:1px solid rgba(200,184,154,0.32);
    color:#c8b89a; cursor:pointer; transition:all 0.2s;
}
#cc-confirm:hover {
    background:rgba(200,184,154,0.18); border-color:#c8b89a; letter-spacing:4px;
}
#cc-skip {
    display:block; text-align:center; margin-top:9px;
    font-size:8px; letter-spacing:2px; color:rgba(200,184,154,0.2);
    cursor:pointer; text-transform:uppercase; transition:color 0.15s;
}
#cc-skip:hover { color:rgba(200,184,154,0.55); }

/* ── Preview ── */
#cc-preview { flex:1; position:relative; overflow:hidden; }
#cc-canvas   { width:100%; height:100%; display:block; }
/* Gradient bas — fondu vers le sol */
#cc-preview::after {
    content:''; position:absolute; bottom:0; left:0; right:0; height:120px;
    background:linear-gradient(to top, rgba(8,10,12,0.5) 0%, transparent 100%);
    pointer-events:none;
}
#cc-hint {
    position:absolute; bottom:14px; left:50%; transform:translateX(-50%);
    font-size:8px; letter-spacing:2px; color:rgba(200,184,154,0.22);
    text-transform:uppercase; pointer-events:none; white-space:nowrap;
    z-index:1;
}
/* Indicateur scroll panel */
#cc-panel-inner::after {
    content:''; display:block; height:20px;
}
#cc-loading {
    position:absolute; inset:0; display:flex; align-items:center;
    justify-content:center; flex-direction:column; gap:10px;
    background:rgba(8,10,12,0.75); transition:opacity 0.35s;
}
#cc-loading.cc-hidden { opacity:0; pointer-events:none; }
#cc-loading-text {
    font-size:8px; letter-spacing:3px; color:rgba(200,184,154,0.35); text-transform:uppercase;
}
#cc-loading-bar-wrap { width:100px; height:1px; background:rgba(200,184,154,0.08); }
#cc-loading-bar { height:1px; background:rgba(200,184,154,0.45); width:0%; transition:width 0.25s ease; }
`;

function injectCSS() {
    if (document.getElementById('cc-style')) return;
    const s = document.createElement('style');
    s.id = 'cc-style';
    s.textContent = CSS;
    document.head.appendChild(s);
}

// ─── HTML ────────────────────────────────────────────────────────
function buildHTML(allowSkip) {
    const el = document.createElement('div');
    el.id = 'cc-overlay';
    el.innerHTML = `
    <div id="cc-panel">
      <div id="cc-panel-inner">
        <div id="cc-title">Character Creation</div>

        <div class="cc-section">
          <span class="cc-label">Name</span>
          <input id="cc-name" type="text" maxlength="24"
                 placeholder="Enter your name..." autocomplete="off">
        </div>

        <div class="cc-section">
          <span class="cc-label">Body</span>
          <div class="cc-toggle">
            <div class="cc-toggle-btn" data-body="M">♂ Male</div>
            <div class="cc-toggle-btn" data-body="F">♀ Female</div>
          </div>
        </div>

        <div class="cc-section">
          <span class="cc-label">Outfit</span>
          <div id="cc-outfits" class="cc-grid"></div>
        </div>

        <div class="cc-section">
          <span class="cc-label">Hair</span>
          <div id="cc-hairs" class="cc-grid"></div>
        </div>

        <div class="cc-section" id="cc-beard-section">
          <span class="cc-label">Beard</span>
          <div id="cc-beards" class="cc-grid"></div>
        </div>

        <div class="cc-section">
          <span class="cc-label">Colors</span>
          <div class="cc-colors">
            <div class="cc-color-row">
              <span>Hair</span>
              <input type="color" id="cc-hair-color" value="#3d2b1f">
              <button class="cc-color-reset" data-reset="hair">Reset</button>
            </div>
            <div class="cc-color-row">
              <span>Eyes</span>
              <input type="color" id="cc-eye-color" value="#2e6e9e">
              <button class="cc-color-reset" data-reset="eye">Reset</button>
            </div>
            <div class="cc-color-row">
              <span>Skin</span>
              <input type="color" id="cc-skin-color" value="#c68642">
              <button class="cc-color-reset" data-reset="skin">Reset</button>
            </div>
          </div>
        </div>
      </div>

      <div id="cc-footer">
        <button id="cc-confirm">Enter the World</button>
        ${allowSkip ? '<span id="cc-skip">Continue with current character</span>' : ''}
      </div>
    </div>

    <div id="cc-preview">
      <canvas id="cc-canvas"></canvas>
      <div id="cc-hint">Drag to rotate · Scroll to zoom</div>
      <div id="cc-loading">
        <div id="cc-loading-text">Initializing...</div>
        <div id="cc-loading-bar-wrap"><div id="cc-loading-bar"></div></div>
      </div>
    </div>`;
    return el;
}

// ─── Scène Three.js de preview ────────────────────────────────────
function createPreviewScene(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace    = THREE.SRGBColorSpace;
    renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080a0c);
    scene.fog = new THREE.Fog(0x080a0c, 10, 22);

    // Sol — cercle discret sous le personnage
    const grid = new THREE.GridHelper(8, 16, 0x161210, 0x0d0b09);
    scene.add(grid);

    // Halo sol — disque lumineux sous les pieds
    const haloGeo = new THREE.CircleGeometry(0.6, 32);
    const haloMat = new THREE.MeshBasicMaterial({
        color:0x2a2010, transparent:true, opacity:0.6, depthWrite:false
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.001;
    scene.add(halo);

    // Éclairage — plus généreux
    scene.add(new THREE.AmbientLight(0xc8b89a, 0.75));
    const key = new THREE.DirectionalLight(0xfff4e0, 1.6);
    key.position.set(2.5, 5, 3); scene.add(key);
    const fill = new THREE.DirectionalLight(0x334466, 0.5);
    fill.position.set(-3, 2, -1); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe8cc, 0.9);
    rim.position.set(0, 4, -5); scene.add(rim);
    // Backlight chaud pour la profondeur
    const back = new THREE.DirectionalLight(0x553322, 0.4);
    back.position.set(0, 1, -3); scene.add(back);

    // Caméra — recule et monte pour voir le personnage entier
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(0, 1.05, 4.2);

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.85, 0);
    controls.enableDamping    = true;
    controls.dampingFactor    = 0.07;
    controls.minDistance      = 1.5;
    controls.maxDistance      = 7.0;
    controls.minPolarAngle    = Math.PI * 0.1;
    controls.maxPolarAngle    = Math.PI * 0.85;
    controls.autoRotate       = true;
    controls.autoRotateSpeed  = 0.6;
    controls.update();

    return { renderer, scene, camera, controls };
}

// ─── Point d'entrée public ────────────────────────────────────────
/**
 * Affiche l'écran de création de personnage.
 *
 * @param {object}  opts
 * @param {boolean} opts.allowSkip — affiche "Continue with current character"
 * @returns {Promise<void>} — résout quand le joueur confirme ou passe
 */
export function showCharCreation({ allowSkip = false } = {}) {
    return new Promise(resolve => {
        injectCSS();
        const overlay = buildHTML(allowSkip);
        document.body.appendChild(overlay);

        // ── État initial (reprend la config existante si dispo) ──
        const state = {
            name     : 'Hero',
            body     : 'M',
            outfit   : 'Male_Ranger',
            hair     : '',
            beard    : '',
            hairColor: null,
            eyeColor : null,
            skinColor: null,
        };
        try {
            const saved = JSON.parse(localStorage.getItem('darkrpg_character_v1') || 'null');
            if (saved) Object.assign(state, {
                name     : saved.name      || state.name,
                body     : saved.body      || state.body,
                outfit   : saved.outfit    || state.outfit,
                hair     : saved.hair      ?? state.hair,
                beard    : saved.beard     ?? state.beard,
                hairColor: saved.hairColor || null,
                eyeColor : saved.eyeColor  || null,
                skinColor: saved.skinColor || null,
            });
        } catch { /* pas de config */ }

        // ── Preview Three.js ─────────────────────────────────────
        const canvas  = overlay.querySelector('#cc-canvas');
        const preview = createPreviewScene(canvas);
        let ctrl   = null;   // CharacterController courant
        let loadId = 0;      // anti-race-condition

        // ── Loading UI ────────────────────────────────────────────
        const loadEl  = overlay.querySelector('#cc-loading');
        const loadTxt = overlay.querySelector('#cc-loading-text');
        const loadBar = overlay.querySelector('#cc-loading-bar');
        function setLoading(on, msg = '') {
            loadEl.classList.toggle('cc-hidden', !on);
            if (msg) loadTxt.textContent = msg;
            if (!on) loadBar.style.width = '100%';
        }
        function setProgress(p) { loadBar.style.width = (p * 100) + '%'; }

        // ── Chargement / rechargement du personnage ───────────────
        async function reloadCharacter() {
            const myId = ++loadId;
            setLoading(true, 'Loading...');
            setProgress(0.1);

            // Supprimer l'ancien
            if (ctrl?._root) {
                preview.scene.remove(ctrl._root);
                ctrl = null;
            }

            setProgress(0.3);
            const ualUrl = await resolveUALUrl();
            if (myId !== loadId) return;

            setProgress(0.6);
            const newCtrl = new CharacterController(preview.scene);
            try {
                await newCtrl.loadRetargeted(
                    P_OUTFIT + state.outfit + '.gltf',
                    ualUrl ? [ualUrl] : [],
                    CLIP_MAP,
                    {
                        targetHeight: 1.75,
                        baseBodyUrl : P_BODY[state.body],
                        hairUrl     : state.hair  ? P_HAIR + state.hair  + '.gltf' : null,
                        beardUrl    : state.beard ? P_HAIR + state.beard + '.gltf' : null,
                        hairColor   : state.hairColor,
                        eyeColor    : state.eyeColor,
                    }
                );
            } catch (err) {
                console.warn('[CharCreation] Chargement partiel :', err);
            }

            if (myId !== loadId) {
                // Chargement annulé — nettoyer
                if (newCtrl._root) preview.scene.remove(newCtrl._root);
                return;
            }

            ctrl = newCtrl;
            preview.controls.target.set(0, 0.85, 0);
            preview.controls.update();
            setLoading(false);
        }

        // ── Boucle de rendu ───────────────────────────────────────
        let rafId = 0;
        let lastT = 0;
        function animate(t = 0) {
            rafId = requestAnimationFrame(animate);
            const dt = Math.min((t - lastT) / 1000, 0.05);
            lastT = t;
            preview.controls.update();
            if (ctrl?.isLoaded) ctrl.update(dt, PREVIEW_PS);
            // Resize dynamique
            const w = canvas.clientWidth, h = canvas.clientHeight;
            if (preview.renderer.domElement.width !== w ||
                preview.renderer.domElement.height !== h) {
                preview.renderer.setSize(w, h, false);
                preview.camera.aspect = w / h;
                preview.camera.updateProjectionMatrix();
            }
            preview.renderer.render(preview.scene, preview.camera);
        }
        animate();

        // ── Grilles d'options ─────────────────────────────────────
        function fillGrid(containerId, items, getActive, onSelect) {
            const grid = overlay.querySelector('#' + containerId);
            grid.innerHTML = '';
            for (const item of items) {
                const d = document.createElement('div');
                d.className = 'cc-opt' + (getActive() === item.val ? ' cc-active' : '');
                d.textContent = item.label;
                d.addEventListener('click', () => {
                    if (getActive() === item.val) return;
                    onSelect(item.val);
                    grid.querySelectorAll('.cc-opt')
                        .forEach(x => x.classList.toggle('cc-active', x === d));
                });
                grid.appendChild(d);
            }
        }
        function fillOutfits() {
            fillGrid('cc-outfits', OUTFITS[state.body],
                () => state.outfit,
                val => { state.outfit = val; reloadCharacter(); });
        }
        function fillHairs() {
            fillGrid('cc-hairs', HAIRS,
                () => state.hair,
                val => { state.hair = val; reloadCharacter(); });
        }
        function fillBeards() {
            fillGrid('cc-beards', BEARDS,
                () => state.beard,
                val => { state.beard = val; reloadCharacter(); });
            overlay.querySelector('#cc-beard-section').style.display =
                state.body === 'F' ? 'none' : '';
        }
        fillOutfits(); fillHairs(); fillBeards();

        // ── Synchro inputs ────────────────────────────────────────
        const nameInput = overlay.querySelector('#cc-name');
        nameInput.value = state.name;
        nameInput.addEventListener('input', () => {
            state.name = nameInput.value.trim() || 'Hero';
        });

        // Body M/F
        overlay.querySelectorAll('[data-body]').forEach(btn => {
            btn.classList.toggle('cc-active', btn.dataset.body === state.body);
            btn.addEventListener('click', () => {
                if (btn.dataset.body === state.body) return;
                state.body = btn.dataset.body;
                // Conserver la classe d'outfit, changer le préfixe genre
                const base = state.outfit.replace(/^(Male|Female)_/, '');
                const list = OUTFITS[state.body];
                const match = list.find(o => o.val === state.body + '_' + base);
                state.outfit = match ? match.val : list[0].val;
                overlay.querySelectorAll('[data-body]').forEach(b =>
                    b.classList.toggle('cc-active', b.dataset.body === state.body));
                fillOutfits(); fillBeards();
                reloadCharacter();
            });
        });

        // Couleurs live (hair/eye sans reload — appliqué sur ctrl existant)
        function applyColorsLive() {
            if (!ctrl?.isLoaded) return;
            if (state.hairColor) ctrl._applyHairColor?.(state.hairColor);
            if (state.eyeColor)  ctrl._applyEyeColor?.(state.eyeColor);
        }
        overlay.querySelector('#cc-hair-color').addEventListener('input', e => {
            state.hairColor = e.target.value; applyColorsLive();
        });
        overlay.querySelector('#cc-eye-color').addEventListener('input', e => {
            state.eyeColor = e.target.value; applyColorsLive();
        });
        overlay.querySelector('#cc-skin-color').addEventListener('input', e => {
            state.skinColor = e.target.value;
            reloadCharacter(); // skin = shader → necessite reload
        });

        // Couleurs — reset
        overlay.querySelectorAll('[data-reset]').forEach(btn => {
            btn.addEventListener('click', () => {
                switch (btn.dataset.reset) {
                    case 'hair':
                        state.hairColor = null;
                        overlay.querySelector('#cc-hair-color').value = '#3d2b1f';
                        applyColorsLive(); break;
                    case 'eye':
                        state.eyeColor = null;
                        overlay.querySelector('#cc-eye-color').value = '#2e6e9e';
                        applyColorsLive(); break;
                    case 'skin':
                        state.skinColor = null;
                        overlay.querySelector('#cc-skin-color').value = '#c68642';
                        reloadCharacter(); break;
                }
            });
        });

        // Synchro couleurs initiales depuis l'état chargé
        if (state.hairColor) overlay.querySelector('#cc-hair-color').value = state.hairColor;
        if (state.eyeColor)  overlay.querySelector('#cc-eye-color').value  = state.eyeColor;
        if (state.skinColor) overlay.querySelector('#cc-skin-color').value = state.skinColor;

        // ── Fermeture ─────────────────────────────────────────────
        function closeOverlay() {
            cancelAnimationFrame(rafId);
            overlay.classList.remove('cc-visible');
            setTimeout(() => {
                preview.renderer.dispose();
                overlay.remove();
                resolve();
            }, 600);
        }

        function confirmAndClose() {
            localStorage.setItem('darkrpg_character_v1', JSON.stringify({
                name     : nameInput.value.trim() || 'Hero',
                body     : state.body,
                outfit   : state.outfit,
                hair     : state.hair,
                beard    : state.beard,
                hairColor: state.hairColor,
                eyeColor : state.eyeColor,
                skinColor: state.skinColor,
            }));
            closeOverlay();
        }

        overlay.querySelector('#cc-confirm').addEventListener('click', confirmAndClose);
        overlay.querySelector('#cc-skip')?.addEventListener('click', closeOverlay);

        // ── Lancement ─────────────────────────────────────────────
        requestAnimationFrame(() => {
            overlay.classList.add('cc-visible');
            reloadCharacter();
            // Pré-charger l'URL UAL en arrière-plan dès l'ouverture
            resolveUALUrl();
        });
    });
}
