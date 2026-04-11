import { getDominantZone } from './world.js';
import { STAT_NAMES }     from './player.js';

// ═════════════════���═════════════════════════════════════════════
//  UI.JS — HUD, messages de dérive d'identité, minimap, zone
// ═════════════════════════════════════════��═════════════════════

// ── Refs DOM (toutes au niveau module — jamais dans les loops) ─
const $zoneName  = document.getElementById('zone-name');
const $driftMsg  = document.getElementById('drift-msg');
const $hpFill    = document.getElementById('hp-fill');
const $staFill   = document.getElementById('sta-fill');
const $minimap   = document.getElementById('minimap-canvas');
const $clock     = document.getElementById('clock');
const $loading   = document.getElementById('loading');
const $loadFill  = document.getElementById('loading-bar-fill');

const _mmCtx = $minimap ? $minimap.getContext('2d') : null;
$minimap.width  = 160;
$minimap.height = 160;

// ── Timers ──────────────────────���──────────────────────────────
let _zoneTimer   = 0;
let _driftTimer  = 0;
let _lastZone    = '';
let _mmFrame     = 0;   // throttle minimap

// ── Chargement ────────────────────────��───────────────────────
const $loadHint = document.getElementById('loading-hint');

export function setLoadProgress(pct) {
    if ($loadFill) $loadFill.style.width = pct + '%';
    if (pct >= 100 && $loading) {
        setTimeout(() => { $loading.style.opacity = '0'; }, 300);
        setTimeout(() => { $loading.style.display = 'none'; }, 1500);
    }
}

export function setLoadHint(text, visible = true) {
    if (!$loadHint) return;
    if (text !== undefined) $loadHint.textContent = text;
    $loadHint.style.opacity = visible ? '1' : '0';
}

// ── Zone name ────────────────────���─────────────────────────────
export function showZoneName(name) {
    if (!$zoneName || name === _lastZone) return;
    _lastZone = name;
    $zoneName.classList.remove('visible');
    setTimeout(() => {
        $zoneName.textContent = name;
        $zoneName.classList.add('visible');
        _zoneTimer = 4.0;
    }, 400);
}

// ── Barres de vie / endurance ─────────��───────────────────────
export function updateBars(player) {
    if ($hpFill)  $hpFill.style.width  = (player.hp  / player.maxHp)      * 100 + '%';
    if ($staFill) $staFill.style.width = (player.stamina / player.maxStamina) * 100 + '%';
}

// ── Messages de dérive d'identité ────────────────────────────
// Textes narratifs par stat + direction de dérive
const DRIFT_MESSAGES = {
    force: {
        up:   ["Tes mouvements gagnent en certitude.", "Le poids de tes armes semble moindre."],
        down: ["Tes mains cherchent le pommeau d'une épée qui n'est plus là.", "Quelque chose se ramollit en toi. Pas tes muscles. Pas encore."],
    },
    endurance: {
        up:   ["Tu endures davantage sans t'en apercevoir."],
        down: ["Tu t'essouffle là où tu ne le devrais pas."],
    },
    agilite: {
        up:   ["Tes pieds cherchent les prises différemment qu'avant.", "Tu te déplaces autrement. Plus économe."],
        down: ["L'équipement pèse. Tu le sens dans les virages."],
    },
    intelligence: {
        up:   ["Tu commences à peser tes observations avant de parler.", "Les connexions s'établissent plus vite."],
        down: ["Tu agis sans réfléchir. C'est plus rapide. Pas nécessairement mieux."],
    },
    eloquence: {
        up:   ["Tu trouves les mots plus naturellement.", "Les gens semblent t'écouter davantage."],
        down: ["Les mots sonnent creux. Même pour toi."],
    },
    perception: {
        up:   ["Tu remarques ce que les autres ignorent.", "Quelque chose s'est affiné dans ta façon de regarder."],
        down: ["Tu passes à côté de choses. Tu le sais. Tu continues quand même."],
    },
    volonte: {
        up:   ["Quelque chose s'est endurci. Pas tes muscles. Autre chose.", "Tu résistes mieux à ce qui te sollicite."],
        down: ["Tu vacilles là où tu tenais bon avant."],
    },
    ombre: {
        up:   ["Tu apprends à occuper moins d'espace.", "Tu passes inaperçu plus facilement. Tu n'es pas sûr que c'est bien."],
        down: ["Tu agis à visage découvert. Certains le remarquent."],
    },
};

export function showDriftMessage(statName, delta) {
    if (!$driftMsg) return;
    const msgs = DRIFT_MESSAGES[statName];
    if (!msgs) return;

    const pool = delta >= 0 ? msgs.up : msgs.down;
    if (!pool || pool.length === 0) return;

    const text = pool[Math.floor(Math.random() * pool.length)];

    $driftMsg.classList.remove('visible');
    clearTimeout(_driftMsg._hideTimeout);

    setTimeout(() => {
        $driftMsg.textContent = text;
        $driftMsg.classList.add('visible');
        _driftMsg._hideTimeout = setTimeout(() => {
            $driftMsg.classList.remove('visible');
        }, 5000);
    }, 300);
}

// ── Minimap + Rose des vents ──────────────────────────────────
const MM_RADIUS = 80;   // unités monde couvertes par la minimap
const MM_CX = 80, MM_CY = 80, MM_R = 62;   // rayon réduit → place pour les labels

// Rose des vents : 4 cardinaux + 4 inter-cardinaux
const _CARDINALS = [
    { a: 0,              t: 'N',  c: '#ff4444', bold: true  },
    { a: Math.PI / 4,    t: 'NE', c: '#888',    bold: false },
    { a: Math.PI / 2,    t: 'E',  c: '#bbb',    bold: false },
    { a: 3*Math.PI / 4,  t: 'SE', c: '#888',    bold: false },
    { a: Math.PI,        t: 'S',  c: '#bbb',    bold: false },
    { a: -3*Math.PI / 4, t: 'SO', c: '#888',    bold: false },
    { a: -Math.PI / 2,   t: 'O',  c: '#bbb',    bold: false },
    { a: -Math.PI / 4,   t: 'NO', c: '#888',    bold: false },
];

export function updateMinimap(playerX, playerZ, playerYaw, zones) {
    if (!_mmCtx) return;
    if (++_mmFrame % 3 !== 0) return;

    const ctx = _mmCtx;
    ctx.clearRect(0, 0, 140, 140);

    // ── Fond circulaire (clip) ─────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(MM_CX, MM_CY, MM_R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.70)';
    ctx.fill();

    // ── Monde (zones biomes) ───────────────────────────────────
    ctx.translate(MM_CX, MM_CY);
    ctx.rotate(-playerYaw);

    const scale = MM_R / MM_RADIUS;
    for (const zone of zones) {
        const x0 = (zone.xMin - playerX) * scale;
        const z0 = (zone.zMin - playerZ) * scale;
        const w  = (zone.xMax - zone.xMin) * scale;
        const h  = (zone.zMax - zone.zMin) * scale;
        ctx.fillStyle = '#' + zone.groundCol.toString(16).padStart(6, '0') + '88';
        ctx.fillRect(x0, z0, w, h);
    }

    // ── Marqueur Nord intérieur (petite pointe rouge) ──────────
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -(MM_R - 4));
    ctx.lineTo(-3, -(MM_R - 12));
    ctx.lineTo(3,  -(MM_R - 12));
    ctx.closePath();
    ctx.fillStyle = '#ff4444';
    ctx.fill();

    // ── Triangle joueur (contre-rotation pour rester debout) ───
    ctx.rotate(playerYaw);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur  = 3;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(-4, 5);
    ctx.lineTo(4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();  // fin du clip

    // ── Graduations sur le bord (style cadran de compas) ───────
    for (let i = 0; i < 32; i++) {
        const a    = i * Math.PI / 16;
        const main = i % 4 === 0;
        const r1   = MM_R + 1;
        const r2   = MM_R + (main ? 6 : 3);
        ctx.strokeStyle = main
            ? 'rgba(200,170,130,0.6)'
            : 'rgba(200,170,130,0.25)';
        ctx.lineWidth = main ? 1.5 : 0.8;
        ctx.beginPath();
        ctx.moveTo(MM_CX + Math.sin(a) * r1, MM_CY - Math.cos(a) * r1);
        ctx.lineTo(MM_CX + Math.sin(a) * r2, MM_CY - Math.cos(a) * r2);
        ctx.stroke();
    }

    // ── Labels cardinaux (tournent avec le monde) ──────────────
    const LR = MM_R + 12;  // rayon texte (hors cercle)
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    for (const { a, t, c, bold } of _CARDINALS) {
        const sa = a - playerYaw;           // angle écran
        const lx = MM_CX + Math.sin(sa) * LR;
        const ly = MM_CY - Math.cos(sa) * LR;
        // Ne dessiner que si dans le canvas
        if (lx < 2 || lx > 138 || ly < 2 || ly > 138) continue;
        ctx.font      = (bold ? 'bold ' : '') + (bold ? '10px' : '8px') + ' sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(t, lx + 1, ly + 1);   // ombre
        ctx.fillStyle = c;
        ctx.fillText(t, lx, ly);
    }

    // ── Bord circulaire extérieur ──────────────────────────────
    ctx.beginPath();
    ctx.arc(MM_CX, MM_CY, MM_R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(180,160,130,0.5)';
    ctx.lineWidth   = 1;
    ctx.stroke();
}

// ── GPS Debug ─────────────────────────────────────────────────
const _$gps = (() => {
    const el = document.createElement('div');
    el.style.cssText = [
        'position:fixed', 'bottom:28px', 'left:28px',
        'color:rgba(200,184,154,0.85)', 'font:11px/1.7 monospace',
        'letter-spacing:1px', 'pointer-events:none',
        'background:rgba(0,0,0,0.40)', 'padding:4px 10px',
        'border-radius:4px', 'border:1px solid rgba(180,160,130,0.18)',
        'text-shadow:0 0 6px rgba(0,0,0,0.9)',
    ].join(';');
    document.body.appendChild(el);
    return el;
})();

export function updateGPS(x, y, z, yawDeg) {
    _$gps.textContent =
        `X ${x.toFixed(1).padStart(8)}  ` +
        `Y ${y.toFixed(1).padStart(6)}  ` +
        `Z ${z.toFixed(1).padStart(8)}  ` +
        `↑ ${((yawDeg % 360 + 360) % 360).toFixed(1)}°`;
}

// ── update général — appelé par game.js chaque frame ─────────
export function update(delta, player, camYaw, zones, dayNight) {
    // Zone
    const zone = getDominantZone(player.position.x, player.position.z);
    if (zone) showZoneName(zone.name);

    // Timer zone
    if (_zoneTimer > 0) {
        _zoneTimer -= delta;
        if (_zoneTimer <= 0 && $zoneName) $zoneName.classList.remove('visible');
    }

    // Barres
    updateBars(player);

    // Minimap
    updateMinimap(player.position.x, player.position.z, camYaw, zones);

    // GPS debug
    updateGPS(player.position.x, player.position.y, player.position.z,
              camYaw * 180 / Math.PI);

    // Minimap visible
    if ($minimap) $minimap.classList.add('visible');

    // Horloge
    if ($clock && dayNight) $clock.textContent = dayNight.getTimeString();
}
