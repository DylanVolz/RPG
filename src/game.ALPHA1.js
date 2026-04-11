import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }     from 'three/addons/postprocessing/OutputPass.js';

import { buildWorld, updateChunks, processBuildQueue, updateWater, updateFog,
         getDominantZone, ZONE_DEFS, START_X, START_Z } from './world.js';
import { Player }           from './player.js';
import { CameraController, CAM_FIRST, CAM_THIRD } from './camera.js';
import { initGods, setSilenced, onStatDrift,
         GOD_QUARRELS, godSpeak }                  from './gods.js';
import { ColorGradeShader } from './shaders.js';
import { DayNightCycle }   from './daynight.js';
import { initAudio, resumeAudio, setZoneAmbience,
         playStep, playLand }                      from './audio.js';
import { setLoadProgress, setLoadHint, update as uiUpdate,
         showDriftMessage, showZoneName }          from './ui.js';
import { InventorySystem }                        from './inventory.js';
import { buildTown, getTownNPCs, getTavernTrapdoors } from './town.js';
import { updateTorches }                            from './builder.js';
import { BuildMode }                               from './build_mode.js';

// ═══════════════════════════════════════════════════════════════
//  SCÈNE
// ═══════════════════════════════════════════════════════════════
const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 6000);

const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.0));
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.8;
renderer.shadowMap.enabled        = false;
renderer.localClippingEnabled     = true;
document.body.appendChild(renderer.domElement);

// ── Post-processing ──────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth * 0.5, innerHeight * 0.5),
    0.22, 0.3, 0.28
);
composer.addPass(bloom);

const gradePass = new ShaderPass(ColorGradeShader);
composer.addPass(gradePass);
composer.addPass(new OutputPass());

// ─────────────────────────────────────────────────────────────
//  LOADING MANAGER — manager dédié aux assets critiques (ville)
//  Ne pas utiliser DefaultLoadingManager : il capture aussi les
//  48 objets BuildMode rechargés et tous les assets NPC/perso,
//  ce qui fausse la barre et allonge le chargement perçu.
// ─────────────────────────────────────────────────────────────
let _assetsLoaded = false;   // true quand le manager dédié a tiré onLoad
let _userClicked  = false;   // true quand l'utilisateur a cliqué pour jouer
let _audioInit    = false;

export const gameLoadManager = new THREE.LoadingManager(
    // onLoad
    () => {
        _assetsLoaded = true;
        setLoadProgress(92);
        setLoadHint('— Cliquez pour jouer —', true);
        if (_userClicked) _startGame();
    },
    // onProgress
    (url, loaded, total) => {
        const pct = Math.min(90, 5 + Math.round((loaded / total) * 85));
        setLoadProgress(pct);
    },
    // onError
    (url) => { console.warn('[Loader] Échec :', url); }
);

setLoadProgress(5);
setLoadHint('Chargement du monde…', false);

// ─────────────────────────────────────────────────────────────
//  MONDE
// ─────────────────────────────────────────────────────────────
buildWorld(scene);
buildTown(scene, START_X, START_Z, gameLoadManager);

// ─────────────────────────────────────────────────────────────
//  CYCLE JOUR/NUIT
// ─────────────────────────────────────────────────────────────
const dayNight = new DayNightCycle(scene, renderer);

// ─────────────────────────────────────────────────────────────
//  JOUEUR
// ─────────────────────────────────────────────────────────────
const player = new Player(scene, START_X, START_Z);

// Callback dérive → UI + dieux
player.onDriftMessage = (statName, delta) => {
    showDriftMessage(statName, delta);
    onStatDrift(statName, delta, player.stats);
};

// ─────────────────────────────────────────────────────────────
//  CAMÉRA
// ─────────────────────────────────────────────────────────────
const camCtrl = new CameraController(camera, renderer.domElement);
camCtrl.yaw   = Math.PI;   // commence derrière le joueur (face nord)

// ── Éditeur de monde (Build Mode) — après camCtrl ─────────────
const buildMode = new BuildMode(scene, camera, renderer.domElement, camCtrl);

// ─────────────────────────────────────────────────────────────
//  AUDIO + DIEUX
// ─────────────────────────────────────────────────────────────
initGods();

// ─────────────────────────────────────────────────────────────
//  INVENTAIRE  (lazy — créé après le premier clic)
// ─────────────────────────────────────────────────────────────
let inventory = null;

// ─────────────────────────────────────────────────────────────
//  MODE COMBAT / SÉLECTION
// ─────────────────────────────────────────────────────────────
const $modeInd = document.getElementById('mode-indicator');
let _combatMode = false;
function _toggleCombatMode() {
    _combatMode = !_combatMode;
    $modeInd.textContent = _combatMode ? 'Combat' : 'Sélection';
    $modeInd.classList.toggle('combat', _combatMode);
}

// ─────────────────────────────────────────────────────────────
//  INPUT
// ─────────────────────────────────────────────────────────────
const keys = new Set();

function _updateModeIndicator() {
    const isFPS    = camCtrl.mode === CAM_FIRST;
    const locked   = camCtrl.cursorLockActive;
    const modeName = isFPS
        ? (locked ? 'FPS'          : 'FPS — curseur libre')
        : (locked ? '3e personne'  : '3e personne — curseur libre');
    document.getElementById('mode-indicator').textContent = modeName;
}

document.addEventListener('keydown', e => {
    keys.add(e.code);

    // ── Touches MODE JEU — bloquées en mode édition ───────────
    if (!buildMode.active) {
        switch(e.code) {
            case 'KeyV':
                camCtrl.toggleMode(player.position);
                player.setMeshVisible(camCtrl.mode !== CAM_FIRST);
                _updateModeIndicator();
                break;
            case 'Space':
                e.preventDefault();
                player.jump();
                break;
            case 'KeyC':
                player.toggleCrouch();
                break;
            case 'ControlLeft':
            case 'ControlRight':
                if (document.fullscreenElement) player.setCrouchHold(true);
                break;
            case 'KeyQ': camCtrl.setLean(-1); break;
            case 'KeyE': camCtrl.setLean(1);  break;
            case 'KeyF':
                if (_nearTrapdoor) _startTeleport(_nearTrapdoor);
                break;
            case 'Tab':
                e.preventDefault();
                camCtrl.toggleCursorLock();
                _updateModeIndicator();
                break;
            case 'KeyI':
                if (!inventory) break;
                if (inventory.isOpen) { inventory.close(); camCtrl.captureCursor(); }
                else                  { inventory.open();  camCtrl.releaseCursor(); }
                break;
            case 'Escape':
                if (inventory?.isOpen) { inventory.close(); camCtrl.captureCursor(); break; }
                _togglePause();
                break;
        }
    } else {
        // ── Touches MODE ÉDITION — Tab ne doit pas locker la caméra ──
        if (e.code === 'Tab') e.preventDefault();
        if (e.code === 'Escape') { buildMode.toggle(); } // Escape = retour jeu
    }
});

document.addEventListener('keyup', e => {
    keys.delete(e.code);
    if (!buildMode.active) {
        if (e.code === 'KeyQ' || e.code === 'KeyE') camCtrl.setLean(0);
        if (e.code === 'ControlLeft' || e.code === 'ControlRight') player.setCrouchHold(false);
    }
});

// Clic gauche — mode sélection : interagir / mode combat : attaque
renderer.domElement.addEventListener('click', e => {
    if (e.button !== 0 || inventory?.isOpen || _paused) return;
    if (_combatMode) {
        // TODO : déclencher attaque
    } else if (inventory?.isOpen) {
        // clic géré par l'inventaire
    } else {
        // TODO : interaction avec l'objet pointé
    }
});

// ── Prévenir le menu contextuel sur clic droit (orbite cam) ──
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

// ─────────────────────────────────────────────────────────────
//  PAUSE
// ─────────────────────────────────────────────────────────────
const $pauseOverlay  = document.getElementById('pause-overlay');
const $btnResume     = document.getElementById('btn-resume');
const $btnSave       = document.getElementById('btn-save');
const $btnFullscreen = document.getElementById('btn-fullscreen');
let   _paused        = false;

// ── Fullscreen + keyboard.lock ────────────────────────────────
let _intentionalFsExit = false;

function _syncFsButton() {
    if ($btnFullscreen)
        $btnFullscreen.textContent = document.fullscreenElement ? 'MODE FENÊTRÉ' : 'PLEIN ÉCRAN';
}

function enterFullscreen() {
    const req = document.documentElement.requestFullscreen
             ?? document.documentElement.webkitRequestFullscreen;
    if (!req) return;
    req.call(document.documentElement).then(() => {
        if (navigator.keyboard?.lock) {
            navigator.keyboard.lock(['Escape']).catch(() => {});
        }
        _syncFsButton();
    }).catch(() => {});
}

function exitFullscreen() {
    _intentionalFsExit = true;
    if (navigator.keyboard?.unlock) navigator.keyboard.unlock();
    (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
}

// Filet de sécurité : si fullscreen quitte sans qu'on le demande (F11, etc.)
document.addEventListener('fullscreenchange', () => {
    _syncFsButton();
    if (!document.fullscreenElement && !_intentionalFsExit && _audioInit) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
    _intentionalFsExit = false;
});

function _openPause() {
    _paused = true;
    $pauseOverlay.classList.add('visible');
    camCtrl.releaseCursor();
    // Sync slider avec l'heure courante
    const $sl = document.getElementById('time-slider');
    const $td = document.getElementById('time-display');
    if ($sl && dayNight) {
        const h = dayNight.dayTime * 24;
        $sl.value = h;
        const hh = Math.floor(h).toString().padStart(2,'0');
        const mm = Math.floor((h % 1) * 60).toString().padStart(2,'0');
        if ($td) $td.textContent = `${hh}:${mm}`;
    }
}

function _closePause() {
    _paused = false;
    $pauseOverlay.classList.remove('visible');
    if (!_intentionalFsExit) enterFullscreen();
    camCtrl.captureCursor();
}

function _togglePause() {
    if (_paused) _closePause(); else _openPause();
}

$btnResume?.addEventListener('click', _closePause);

// ── Slider heure du jour ──────────────────────────────────────
const $timeSlider  = document.getElementById('time-slider');
const $timeDisplay = document.getElementById('time-display');
if ($timeSlider) {
    $timeSlider.addEventListener('input', () => {
        const h = parseFloat($timeSlider.value);
        dayNight.setHour(h);
        const hh = Math.floor(h).toString().padStart(2, '0');
        const mm = Math.floor((h % 1) * 60).toString().padStart(2, '0');
        if ($timeDisplay) $timeDisplay.textContent = `${hh}:${mm}`;
    });
}
$btnFullscreen?.addEventListener('click', () => {
    if (document.fullscreenElement) exitFullscreen();
    else enterFullscreen();
});

$btnSave?.addEventListener('click', () => {
    _saveGame();
    $btnSave.textContent = 'SAUVEGARDÉ';
    setTimeout(() => { $btnSave.textContent = 'SAUVEGARDER'; }, 2000);
});

// ─────────────────────────────────────────────────────────────
//  SAUVEGARDE
// ─────────────────────────────────────────────────────────────
const SAVE_KEY = 'darkrpg_save_v1';

function _saveGame() {
    const data = {
        pos:   [player.position.x, player.position.y, player.position.z],
        stats: { ...player.stats },
        hp:    player.hp,
        stamina: player.stamina,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function _loadGame() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.pos) {
            player.position.set(data.pos[0], data.pos[1], data.pos[2]);
            player.mesh.position.copy(player.position);
            // Laisser la physique recalculer le sol — évite le snap au terrain
            // quand le joueur était en intérieur (cave, étage)
            player.isGrounded = false;
            player._vy        = 0;
        }
        if (data.stats) Object.assign(player.stats, data.stats);
        if (data.hp)     player.hp      = data.hp;
        if (data.stamina) player.stamina = data.stamina;
    } catch(e) { console.warn('Impossible de charger la sauvegarde:', e); }
}

// Auto-save sur refresh / fermeture
window.addEventListener('beforeunload', _saveGame);

// ─────────────────────────────────────────────────────────────
//  REDIMENSIONNEMENT
// ─────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
});

// ─────────────────────────────────────────────────────────────
//  TRAPPES — téléportation cave ↔ extérieur
// ─────────────────────────────────────────────────────────────

// Prompt "appuyer sur F" affiché près d'une trappe
const _$tpPrompt = (() => {
    const el = document.createElement('div');
    el.style.cssText = [
        'position:fixed', 'bottom:90px', 'left:50%', 'transform:translateX(-50%)',
        'color:#e8d5a0', 'font:13px/1.6 monospace', 'letter-spacing:0.08em',
        'background:rgba(0,0,0,0.68)', 'padding:5px 20px', 'border-radius:4px',
        'border:1px solid rgba(200,170,100,0.28)', 'pointer-events:none',
        'opacity:0', 'transition:opacity 0.18s',
    ].join(';');
    document.body.appendChild(el);
    return el;
})();

let _nearTrapdoor = null;   // trapdoor object si à portée, sinon null
let _tpState      = null;   // { phase:'in'|'out', t, dest } pendant la transition

// ─────────────────────────────────────────────────────────────
//  DEBUG HOVER — affiche le nom de l'objet pointé (centre écran)
// ─────────────────────────────────────────────────────────────
const _$hover = (() => {
    const el = document.createElement('div');
    el.style.cssText = [
        'position:fixed', 'top:12px', 'left:12px',
        'color:#b0ffb0', 'font:11px/1.5 monospace', 'letter-spacing:0.05em',
        'background:rgba(0,0,0,0.55)', 'padding:3px 10px', 'border-radius:3px',
        'pointer-events:none', 'white-space:pre',
    ].join(';');
    document.body.appendChild(el);
    return el;
})();

const _hoverRay = new THREE.Raycaster();
_hoverRay.far = 40;   // portée max : 40m

let _hoverTargets    = [];   // liste mise en cache des meshes nommés
let _hoverCacheFrame = -999; // frame du dernier rebuild

/** Reconstruit la liste des meshes nommés (hors terrain). Coûteux — appel rare. */
function _rebuildHoverTargets() {
    _hoverTargets = [];
    scene.traverse(o => {
        if (o.isMesh && o.name && o.name !== '' && !o.userData.isTerrain)
            _hoverTargets.push(o);
    });
}

/** Remonte la hiérarchie pour trouver le premier nom significatif. */
function _pickName(obj) {
    let o = obj;
    const parts = [];
    while (o && o !== scene) {
        if (o.name && o.name !== '') parts.push(o.name);
        o = o.parent;
    }
    return parts.length ? parts.join(' › ') : '(sans nom)';
}

function _startTeleport(trap) {
    if (_tpState) return;   // transition déjà en cours
    _tpState = { phase: 'in', t: 0.35, dest: trap };
}

// ─────────────────────────────────────────────────────────────
//  VARIABLES DE BOUCLE  — aucune allocation dans animate()
// ─────────────────────────────────────────────────────────────
const _clock        = new THREE.Clock();
let   _lastZoneId   = '';
let   _inUnderworld = false;
let   _stepAccum    = 0;
let   _frameCount   = 0;

// ─────────────────────────────────────────────────────────────
//  DÉMARRAGE — séparé du clic pour pouvoir différer si assets pas prêts
// ─────────────────────────────────────────────────────────────
function _startGame() {
    if (_audioInit) return;   // déjà démarré (sécurité double-appel)
    _audioInit = true;
    try { initAudio(); }      catch(e) { console.error('initAudio:', e); }
    try { resumeAudio(); }    catch(e) {}
    try { enterFullscreen(); } catch(e) { console.error('enterFullscreen:', e); }
    _loadGame();
    setLoadProgress(100);   // ferme l'écran de chargement
    setTimeout(() => { inventory = new InventorySystem(player); }, 1600);
    setTimeout(() => { godSpeak('ylene', "Tu es là. Pour combien de temps ?", 7000); }, 3000);
}

// Premier clic — démarre le jeu si les assets sont prêts, sinon attend onLoad
document.addEventListener('click', () => {
    _userClicked = true;
    if (_assetsLoaded) {
        _startGame();
    } else {
        // Assets pas encore prêts — afficher un retour visuel
        setLoadHint('Chargement en cours…', true);
    }
}, { once: true });

// ─────────────────────────────────────────────────────────────
//  BOUCLE PRINCIPALE
// ─────────────────────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(_clock.getDelta(), 0.05);  // cap à 50ms
    _frameCount++;

    if (_paused) return;

    // ── Téléportation trappe (fondu noir) ────────────────────
    if (_tpState) {
        _tpState.t -= delta;
        if (_tpState.phase === 'in') {
            // Assombrir progressivement
            gradePass.uniforms.uDarkness.value = Math.min(1, 1 - _tpState.t / 0.35);
            if (_tpState.t <= 0) {
                // Écran noir : téléporter le joueur
                const d = _tpState.dest;
                player.position.set(d.destX, d.destY, d.destZ);
                player._vy       = 0;
                player.isGrounded = false;
                gradePass.uniforms.uDarkness.value = 1;
                _tpState = { phase: 'out', t: 0.45, dest: d };
            }
        } else {
            // Réouvrir progressivement
            gradePass.uniforms.uDarkness.value = Math.max(0, _tpState.t / 0.45);
            if (_tpState.t <= 0) {
                gradePass.uniforms.uDarkness.value = 0;
                _tpState = null;
            }
        }
    }

    // ── Cycle jour/nuit ───────────────────────────────────────
    dayNight.update(delta, camera);

    // camYaw accessible partout dans la frame (uiUpdate en a besoin)
    let camYaw = camCtrl.getCameraYaw();

    // Les scans monde (suppressions/transforms sauvegardés) tournent toujours,
    // même hors mode édition — buildMode.update() retourne tôt si !active.
    buildMode.update(delta, keys);

    if (buildMode.active) {
        // ── MODE ÉDITION : caméra libre, joueur figé ─────────
        // (update déjà appelé ci-dessus)
    } else {
        // ── MODE JEU : mouvement joueur + caméra attachée ────
        player._forceCamYaw = camCtrl.getCharacterYaw();
        player.update(delta, keys, camYaw, camCtrl.mode);

        const targetEyeH = player.isCrouching ? 0.75 : 1.75;
        camCtrl.eyeHeight += (targetEyeH - camCtrl.eyeHeight) * Math.min(1, delta * 14);
        camCtrl.update(delta, player.position, player.mesh);
        camYaw = camCtrl.getCameraYaw(); // re-lire après update
    }

    // ── Chunks terrain ────────────────────────────────────────
    updateChunks(player.position.x, player.position.z);
    processBuildQueue(player.position.x, player.position.z, 3);

    // ── Eau ──────────────────────────────────────────────────
    updateWater(player.position.x, player.position.z);

    // ── Brouillard adaptatif ─────────────────────────────────
    if (_frameCount % 6 === 0) {
        updateFog(scene, player.position.x, player.position.z);
    }

    // ── Zone courante ─────────────────────────────────────────
    if (_frameCount % 30 === 0) {
        const zone = getDominantZone(player.position.x, player.position.z);
        if (zone && zone.id !== _lastZoneId) {
            _lastZoneId = zone.id;
            if (_audioInit) setZoneAmbience(zone.id);
        }

        // Détection Entrailles (y très bas = sous-sol profond)
        const nowUnder = player.position.y < -8;
        if (nowUnder !== _inUnderworld) {
            _inUnderworld = nowUnder;
            setSilenced(nowUnder);
            if (nowUnder) {
                GOD_QUARRELS.entering_underworld();
                gradePass.uniforms.uDarkness.value = 0.0;
            } else {
                GOD_QUARRELS.exiting_underworld();
            }
        }

        // Assombrissement progressif dans les Entrailles
        // (ignoré pendant une transition trappe pour ne pas écraser le fondu)
        if (_inUnderworld && !_tpState) {
            const depth = Math.abs(player.position.y + 8) / 100;
            gradePass.uniforms.uDarkness.value = Math.min(0.8, depth);
            bloom.strength = 0.1 + depth * 0.3;
        } else if (!_tpState) {
            gradePass.uniforms.uDarkness.value *= 0.95;
            bloom.strength = 0.22;
        }
    }

    // ── Sons de pas ──────────────────────────────────────────
    const moving = keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD');
    if (moving && player.isGrounded && _audioInit) {
        const zone = getDominantZone(player.position.x, player.position.z);
        const surf = zone?.id === 'stonemark' || zone?.id === 'gorges_pierre' ? 'stone'
                   : zone?.id === 'kaldrath'  || zone?.id === 'grande_foret'  ? 'snow'
                   : 'dirt';
        playStep(surf, delta);
    }

    // ── Inventaire (animation 3D interne) ────────────────────
    inventory?.tick(delta);
    updateTorches(delta);
    for (const npc of getTownNPCs()) npc.update(delta);
    // buildMode.update() déjà appelé en haut de la boucle (dans le bloc if/else)

    // ── Auto-save position (toutes les 600 frames ≈ 10s) ────────
    if (_frameCount % 600 === 1) _saveGame();

    // ── Debug hover — objet pointé ───────────────────────────────
    // Rebuild cache toutes les 300 frames (~5s) pour capturer les nouveaux objets
    if (_frameCount - _hoverCacheFrame > 300) {
        _rebuildHoverTargets();
        _hoverCacheFrame = _frameCount;
    }
    // Raycast toutes les 20 frames (~3x/s) contre la liste en cache
    if (_frameCount % 20 === 0 && _hoverTargets.length) {
        _hoverRay.setFromCamera({ x: 0, y: 0 }, camera);
        const hits = _hoverRay.intersectObjects(_hoverTargets, false);
        if (hits.length) {
            const h = hits[0];
            _$hover.textContent = `${_pickName(h.object)}  (${h.distance.toFixed(1)}m)`;
        } else {
            _$hover.textContent = '';
        }
    }

    // ── Proximité trappes (toutes les 12 frames) ─────────────
    if (_frameCount % 12 === 0 && !_tpState) {
        const px = player.position.x, py = player.position.y, pz = player.position.z;
        let found = null;
        for (const t of getTavernTrapdoors()) {
            const dx = px - t.x, dz = pz - t.z;
            const xzDist = Math.sqrt(dx * dx + dz * dz);
            if (xzDist < t.radius && Math.abs(py - t.playerY) < 2.5) {
                found = t; break;
            }
        }
        if (found !== _nearTrapdoor) {
            _nearTrapdoor = found;
            _$tpPrompt.textContent = found ? found.label : '';
            _$tpPrompt.style.opacity = found ? '1' : '0';
        }
    }

    // ── UI ───────────────────────────────────────────────────
    uiUpdate(delta, player, camYaw, ZONE_DEFS, dayNight);

    // ── Rendu ─────────────────────────────────────────────────
    composer.render();
}

animate();
