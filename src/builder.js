import * as THREE from 'three';
import { addFloor, addCeiling, addWall, addRamp } from './collision.js';

// ═══════════════════════════════════════════════════════════════
//  BUILDER.JS — Norme de construction RPG
//
//  Échelle : 1 unité = 1 mètre
//  Réutilisable par tous les modules de structures.
//
//  ── Standards architecturaux ──────────────────────────────────
//  WT    = 0.60   épaisseur mur porteur (maçonnerie médiévale)
//  FH    = 0.30   épaisseur dalle
//  WH    = 4.50   hauteur libre standard (intérieur)
//  DW    = 1.80   largeur de porte
//  DH    = 2.10   hauteur de porte (linteau standard)
//  FRAME = 0.12   épaisseur encadrement (jambage/linteau/fenêtre)
//  CRAWL = 1.60   hauteur boyau (forçage accroupi)
//
//  ── Primitives ────────────────────────────────────────────────
//  mesh   — bloc visuel pur (pas de collision)
//  floor  — dalle sol
//  ceil   — dalle plafond
//  solid  — bloc solide (mur, pilier)
//  wallX  — mur parallèle à X
//  wallZ  — mur parallèle à Z
//  pillar — pilier carré
//
//  ── Ouvertures ────────────────────────────────────────────────
//  doorX  — porte dans un mur X (DH + encadrement)
//  doorZ  — porte dans un mur Z
//  archX  — arche décorative pleine hauteur mur X
//  archZ  — arche décorative pleine hauteur mur Z
//  winZ   — fenêtre dans un mur Z (avec encadrement)
//
//  ── Composites ────────────────────────────────────────────────
//  staircase — escalier (rampe physique + visuels Blondel)
//  room      — pièce complète (sol, plafond, 4 murs, ouvertures)
//  roofFlat  — toit plat avec acrotère et merlons médiévaux
//  roofGable — toit en pignon (faîtage + versants)
//
//  ── Animation ─────────────────────────────────────────────────
//  torch        — torche murale
//  light        — point de lumière scintillant
//  updateTorches — à appeler dans animate()
// ═══════════════════════════════════════════════════════════════

// ── Constantes de construction (normes du projet) ──────────────
export const WT    = 0.60;   // épaisseur mur porteur
export const FH    = 0.30;   // épaisseur dalle
export const WH    = 4.50;   // hauteur libre standard
export const DW    = 1.80;   // largeur de porte
export const DH    = 2.10;   // hauteur de porte (linteau)
export const FRAME = 0.12;   // épaisseur encadrement
export const CRAWL = 1.60;   // hauteur boyau

// ── État interne torches ───────────────────────────────────────
const _flames = [];
const _lights  = [];

// ═══════════════════════════════════════════════════════════════
//  PRIMITIVES
// ═══════════════════════════════════════════════════════════════

/** Bloc visuel pur — aucune collision. */
export function mesh(sc, cx, y, cz, w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, y + h * 0.5, cz);
    sc.add(m);
}

/** Dalle de sol — collision addFloor. */
export function floor(sc, cx, y, cz, w, d, mat) {
    mesh(sc, cx, y, cz, w, FH, d, mat);
    addFloor(cx, cz, w, d, y + FH);
}

/** Dalle de plafond — collision addCeiling. */
export function ceil(sc, cx, y, cz, w, d, mat) {
    mesh(sc, cx, y, cz, w, FH, d, mat);
    addCeiling(cx, cz, w, d, y);
}

/** Bloc solide (mur, pilier) — collision addWall. */
export function solid(sc, cx, y, cz, w, h, d, mat) {
    mesh(sc, cx, y, cz, w, h, d, mat);
    addWall(cx, cz, w, d, y, y + h);
}

/** Mur parallèle à X (face N ou S), centré en z=cz. */
export function wallX(sc, cz, y, cx, len, h, mat) {
    solid(sc, cx, y, cz, len, h, WT, mat);
}

/** Mur parallèle à Z (face E ou O), centré en x=cx. */
export function wallZ(sc, cx, y, cz, len, h, mat) {
    solid(sc, cx, y, cz, WT, h, len, mat);
}

/** Pilier carré. sz = côté, h = hauteur. */
export function pillar(sc, cx, y, cz, sz, h, mat) {
    solid(sc, cx, y, cz, sz, h, sz, mat);
}

// ═══════════════════════════════════════════════════════════════
//  OUVERTURES
// ═══════════════════════════════════════════════════════════════

/**
 * Porte dans un mur X (parallèle à X, face N ou S).
 *
 * Ouverture DW × DH, mur plein au-dessus du linteau.
 * Encadrement visible : 2 jambages + linteau (frameMat).
 *
 * @param {number} cz       — position Z du mur
 * @param {number} y        — base du sol
 * @param {number} x1, x2   — limites X du mur
 * @param {number} h        — hauteur totale du mur
 * @param {number} cx_door  — centre X de la porte
 * @param mat               — matériau du mur
 * @param frameMat          — matériau de l'encadrement (défaut = mat)
 */
export function doorX(sc, cz, y, x1, x2, h, cx_door, mat, frameMat = mat) {
    const dL = cx_door - DW * 0.5;
    const dR = cx_door + DW * 0.5;

    // Segments latéraux (pleine hauteur)
    if (dL > x1 + 0.02) solid(sc, (x1 + dL) * 0.5, y, cz, dL - x1,       h,      WT, mat);
    if (dR < x2 - 0.02) solid(sc, (dR + x2) * 0.5, y, cz, x2 - dR,       h,      WT, mat);
    // Linteau structural (de DH jusqu'en haut)
    if (DH < h - 0.02)  solid(sc, cx_door,          y + DH, cz, DW,       h - DH, WT, mat);

    // Encadrement — jambages (gauche + droite)
    mesh(sc, dL - FRAME * 0.5, y, cz, FRAME, DH + FRAME, WT + 0.06, frameMat);
    mesh(sc, dR + FRAME * 0.5, y, cz, FRAME, DH + FRAME, WT + 0.06, frameMat);
    // Encadrement — linteau horizontal
    mesh(sc, cx_door, y + DH, cz, DW + FRAME * 2, FRAME, WT + 0.06, frameMat);
}

/**
 * Porte dans un mur Z (parallèle à Z, face E ou O).
 *
 * Ouverture DW × DH, mur plein au-dessus du linteau.
 * Encadrement visible : 2 jambages + linteau (frameMat).
 *
 * @param {number} cx       — position X du mur
 * @param {number} y        — base du sol
 * @param {number} z1, z2   — limites Z du mur
 * @param {number} h        — hauteur totale du mur
 * @param {number} cz_door  — centre Z de la porte
 * @param mat               — matériau du mur
 * @param frameMat          — matériau de l'encadrement (défaut = mat)
 */
export function doorZ(sc, cx, y, z1, z2, h, cz_door, mat, frameMat = mat) {
    const dB = cz_door - DW * 0.5;
    const dF = cz_door + DW * 0.5;

    // Segments latéraux (pleine hauteur)
    if (dB > z1 + 0.02) solid(sc, cx, y, (z1 + dB) * 0.5, WT, h,      dB - z1, mat);
    if (dF < z2 - 0.02) solid(sc, cx, y, (dF + z2) * 0.5, WT, h,      z2 - dF, mat);
    // Linteau structural (de DH jusqu'en haut)
    if (DH < h - 0.02)  solid(sc, cx, y + DH, cz_door,    WT, h - DH, DW,      mat);

    // Encadrement — jambages (avant + arrière)
    mesh(sc, cx, y, dB - FRAME * 0.5, WT + 0.06, DH + FRAME, FRAME, frameMat);
    mesh(sc, cx, y, dF + FRAME * 0.5, WT + 0.06, DH + FRAME, FRAME, frameMat);
    // Encadrement — linteau horizontal
    mesh(sc, cx, y + DH, cz_door, WT + 0.06, FRAME, DW + FRAME * 2, frameMat);
}

/**
 * Arche décorative pleine hauteur dans un mur X.
 * Réservée aux passages monumentaux (cathédrale, sanctuaire).
 * Pour les portes courantes, utiliser doorX().
 */
export function archX(sc, cz, y, x1, x2, h, cx_door, mat) {
    const dL = cx_door - DW * 0.5, dR = cx_door + DW * 0.5;
    if (dL > x1 + 0.02) solid(sc, (x1 + dL) * 0.5, y, cz, dL - x1, h, WT, mat);
    if (dR < x2 - 0.02) solid(sc, (dR + x2) * 0.5, y, cz, x2 - dR, h, WT, mat);
}

/**
 * Arche décorative pleine hauteur dans un mur Z.
 * Réservée aux passages monumentaux.
 */
export function archZ(sc, cx, y, z1, z2, h, cz_door, mat) {
    const dB = cz_door - DW * 0.5, dF = cz_door + DW * 0.5;
    if (dB > z1 + 0.02) solid(sc, cx, y, (z1 + dB) * 0.5, WT, h, dB - z1, mat);
    if (dF < z2 - 0.02) solid(sc, cx, y, (dF + z2) * 0.5, WT, h, z2 - dF, mat);
}

/**
 * Fenêtres dans un mur Z (face E ou O) — supporte plusieurs fenêtres en une passe.
 *
 * Construit le mur complet avec les ouvertures, sans chevauchements.
 *
 * @param {number} cx       — position X du mur
 * @param {number} y        — base du sol
 * @param {number} z1, z2   — limites Z du mur
 * @param {number} h        — hauteur totale du mur
 * @param {Array}  windows  — [{pos, len, wb, wt}, ...]
 *                            pos  = centre Z de la fenêtre
 *                            len  = largeur
 *                            wb   = hauteur d'appui (allège, depuis y)
 *                            wt   = hauteur haut du vitrage (depuis y)
 * @param mat               — matériau du mur
 * @param frameMat          — matériau encadrement (défaut = mat)
 */
export function winZ(sc, cx, y, z1, z2, h, windows, mat, frameMat = mat) {
    // Trier les fenêtres par position Z croissante
    const wins = [...windows].sort((a, b) => a.pos - b.pos);

    let cursor = z1;

    for (const win of wins) {
        const wB = win.pos - win.len * 0.5;
        const wF = win.pos + win.len * 0.5;

        // Segment de mur plein avant la fenêtre
        if (wB > cursor + 0.02) {
            solid(sc, cx, y, (cursor + wB) * 0.5, WT, h, wB - cursor, mat);
        }

        // Allège (bas de la fenêtre)
        if (win.wb > 0.02) {
            solid(sc, cx, y, win.pos, WT, win.wb, win.len, mat);
        }
        // Tympan (haut de la fenêtre)
        if (win.wt < h - 0.02) {
            solid(sc, cx, y + win.wt, win.pos, WT, h - win.wt, win.len, mat);
        }

        // Encadrement — colonnettes latérales
        mesh(sc, cx, y + win.wb, wB - FRAME * 0.5, WT + 0.06, win.wt - win.wb + FRAME, FRAME, frameMat);
        mesh(sc, cx, y + win.wb, wF + FRAME * 0.5, WT + 0.06, win.wt - win.wb + FRAME, FRAME, frameMat);
        // Encadrement — linteau
        mesh(sc, cx, y + win.wt, win.pos, WT + 0.06, FRAME, win.len + FRAME * 2, frameMat);
        // Encadrement — appui de fenêtre (saillie légère)
        mesh(sc, cx, y + win.wb, win.pos, WT + 0.10, FRAME * 0.6, win.len + FRAME * 2, frameMat);

        cursor = wF;
    }

    // Segment de mur plein après la dernière fenêtre
    if (cursor < z2 - 0.02) {
        solid(sc, cx, y, (cursor + z2) * 0.5, WT, h, z2 - cursor, mat);
    }
}

// ── Torches ────────────────────────────────────────────────────

/**
 * Torche murale.
 * dir = direction de la flamme : 'N'(+Z) 'S'(-Z) 'E'(+X) 'W'(-X)
 */
export function torch(sc, cx, y, cz, dir) {
    const o = 0.28;
    const [dx, dz] = dir === 'E' ? [o, 0] : dir === 'W' ? [-o, 0] : dir === 'N' ? [0, o] : [0, -o];
    // Bras
    const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.38, 5),
        new THREE.MeshLambertMaterial({ color: 0x221008 })
    );
    arm.position.set(cx + dx * 0.5, y + 0.17, cz + dz * 0.5);
    arm.rotation.x = dz !== 0 ? -Math.sign(dz) * 0.42 : 0;
    arm.rotation.z = dx !== 0 ?  Math.sign(dx) * 0.42 : 0;
    sc.add(arm);
    // Coupelle
    const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085, 0.05, 0.09, 7),
        new THREE.MeshLambertMaterial({ color: 0x3a1a08 })
    );
    cup.position.set(cx + dx, y + 0.38, cz + dz);
    sc.add(cup);
    // Flamme
    const fmat = new THREE.MeshLambertMaterial({
        color: 0xff7700,
        emissive: new THREE.Color(0xff5500),
        emissiveIntensity: 3.0,
    });
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.085, 6, 5), fmat);
    fl.position.set(cx + dx, y + 0.53, cz + dz);
    sc.add(fl);
    _flames.push({ mesh: fl, mat: fmat, baseY: y + 0.53, phase: Math.random() * Math.PI * 2 });
}

/** Point de lumière animé (scintillement). */
export function light(sc, cx, y, cz, intensity = 5.5, dist = 12) {
    const l = new THREE.PointLight(0xffaa55, intensity, dist, 1.5);
    l.position.set(cx, y, cz);
    sc.add(l);
    _lights.push({ light: l, base: intensity, phase: Math.random() * Math.PI * 2 });
}

/** Animation torches — appeler dans la boucle principale. */
export function updateTorches() {
    const t = performance.now() * 0.001;
    for (const f of _flames) {
        const s = 1 + Math.sin(t * 8  + f.phase) * 0.13 + Math.sin(t * 17 + f.phase) * 0.06;
        f.mesh.scale.setScalar(s);
        f.mesh.position.y = f.baseY + Math.sin(t * 5 + f.phase) * 0.022;
        f.mat.emissiveIntensity = s * 2.8;
    }
    for (const l of _lights) {
        const s = 1 + Math.sin(t * 7  + l.phase) * 0.17 + Math.sin(t * 19 + l.phase) * 0.08;
        l.light.intensity = l.base * s;
    }
}

// ═══════════════════════════════════════════════════════════════
//  COMPOSITES
// ═══════════════════════════════════════════════════════════════

/**
 * Escalier avec physique rampe (caméra fluide) et visuels en blocs
 * de hauteur croissante (proportions Blondel : 2R + G = 64 cm).
 *
 * @param {THREE.Scene} sc
 * @param {number} ox         — centre X de l'escalier
 * @param {number} cz         — centre Z de l'escalier
 * @param {number} width      — largeur (axe X)
 * @param {number} length     — longueur totale en Z
 * @param {number} yZmin      — hauteur sol à l'extrémité z-min
 * @param {number} yZmax      — hauteur sol à l'extrémité z-max
 * @param mat                 — matériau marches
 * @param {boolean} withWalls — murs latéraux (défaut : true)
 */
export function staircase(sc, ox, cz, width, length, yZmin, yZmax, mat, withWalls = true) {
    const N      = 20;
    const run    = length / N;
    const yBot   = Math.min(yZmin, yZmax);
    const yTop   = Math.max(yZmin, yZmax);
    const rise   = (yTop - yBot) / N;
    const zStart = cz - length * 0.5;
    const highAtZmin = yZmin > yZmax;

    for (let i = 0; i < N; i++) {
        const blockH = (i + 1) * rise;
        const stepZ  = highAtZmin
            ? zStart + length - (i + 0.5) * run
            : zStart          + (i + 0.5) * run;
        const sm = new THREE.Mesh(new THREE.BoxGeometry(width, blockH, run), mat);
        sm.position.set(ox, yBot + blockH * 0.5, stepZ);
        sc.add(sm);
        // Nez de marche — arête légèrement saillante
        const nosing = new THREE.Mesh(
            new THREE.BoxGeometry(width, 0.03, 0.06),
            mat
        );
        const nosZ = highAtZmin
            ? stepZ + run * 0.5
            : stepZ - run * 0.5;
        nosing.position.set(ox, yBot + blockH + 0.015, nosZ);
        sc.add(nosing);
    }

    addRamp(ox, cz, width, length, yZmin, yZmax, 'z');

    if (withWalls) {
        const wallH = (yTop - yBot) + 1.2;
        wallZ(sc, ox - width * 0.5, yBot, cz, length, wallH, mat);
        wallZ(sc, ox + width * 0.5, yBot, cz, length, wallH, mat);
    }
}

/**
 * Pièce complète : sol, plafond, 4 murs avec ouvertures optionnelles.
 *
 * Les portes (doorN/S/E/W) utilisent la norme DH=2.10m avec encadrement.
 * Pour des arches décoratives pleine hauteur, construire manuellement
 * avec archX() / archZ().
 *
 * @param {number} cx, y, cz   — centre de la pièce, hauteur du sol
 * @param {number} w           — largeur (axe X)
 * @param {number} d           — profondeur (axe Z)
 * @param {object} opts
 *   matFloor   {Material}     — matériau sol (défaut = matWall)
 *   matCeil    {Material}     — matériau plafond (défaut = matWall)
 *   matWall    {Material}     — matériau murs (requis)
 *   matFrame   {Material}     — matériau encadrements (défaut = matWall)
 *   height     {number}       — hauteur intérieure (défaut = WH)
 *   doorN      {number|null}  — cx de la porte nord  (null = mur plein)
 *   doorS      {number|null}  — cx de la porte sud
 *   doorE      {number|null}  — cz de la porte est
 *   doorW      {number|null}  — cz de la porte ouest
 *   windowsE   {Array}        — [{pos, len, bottom, top}] fenêtres mur est
 *   windowsW   {Array}        — [{pos, len, bottom, top}] fenêtres mur ouest
 *   noFloor    {boolean}      — skip sol
 *   noCeil     {boolean}      — skip plafond
 *
 * Convention : N = z-min, S = z-max, E = x-max, W = x-min
 */
export function room(sc, cx, y, cz, w, d, {
    height   = WH,
    matFloor = null,
    matCeil  = null,
    matWall,
    matFrame = null,
    doorN    = null,
    doorS    = null,
    doorE    = null,
    doorW    = null,
    windowsE = [],
    windowsW = [],
    noFloor  = false,
    noCeil   = false,
} = {}) {
    const mF  = matFloor ?? matWall;
    const mC  = matCeil  ?? matWall;
    const mFr = matFrame ?? matWall;

    const x1 = cx - w * 0.5, x2 = cx + w * 0.5;
    const z1 = cz - d * 0.5, z2 = cz + d * 0.5;

    if (!noFloor) floor(sc, cx, y,          cz, w, d, mF);
    if (!noCeil)  ceil (sc, cx, y + height, cz, w, d, mC);

    // Mur Nord (z = z1)
    if (doorN !== null) doorX(sc, z1, y, x1, x2, height, doorN, matWall, mFr);
    else                wallX(sc, z1, y, cx, w,  height, matWall);

    // Mur Sud (z = z2)
    if (doorS !== null) doorX(sc, z2, y, x1, x2, height, doorS, matWall, mFr);
    else                wallX(sc, z2, y, cx, w,  height, matWall);

    // Mur Est (x = x2)
    if (doorE !== null) {
        doorZ(sc, x2, y, z1, z2, height, doorE, matWall, mFr);
    } else if (windowsE.length > 0) {
        winZ(sc, x2, y, z1, z2, height,
            windowsE.map(w => ({ pos: w.pos, len: w.len, wb: w.bottom, wt: w.top })),
            matWall, mFr);
    } else {
        wallZ(sc, x2, y, cz, d, height, matWall);
    }

    // Mur Ouest (x = x1)
    if (doorW !== null) {
        doorZ(sc, x1, y, z1, z2, height, doorW, matWall, mFr);
    } else if (windowsW.length > 0) {
        winZ(sc, x1, y, z1, z2, height,
            windowsW.map(w => ({ pos: w.pos, len: w.len, wb: w.bottom, wt: w.top })),
            matWall, mFr);
    } else {
        wallZ(sc, x1, y, cz, d, height, matWall);
    }
}

/**
 * Toit plat style médiéval : dalle + acrotère + rangée de merlons.
 *
 * Convient pour : tours, donjons, chemins de ronde.
 *
 * @param {number} cx, y, cz   — centre, hauteur du dessus du mur
 * @param {number} w           — largeur extérieure (axe X)
 * @param {number} d           — profondeur extérieure (axe Z)
 * @param mat                  — matériau (même que les murs)
 * @param {object} opts
 *   merlon    {number}        — hauteur des merlons (défaut 0.90)
 *   crenStep  {number}        — pas créneau (merlon + embrasure, défaut 1.20)
 */
export function roofFlat(sc, cx, y, cz, w, d, mat, {
    merlon   = 0.90,
    crenStep = 1.20,
} = {}) {
    // Dalle de toit
    floor(sc, cx, y, cz, w, d, mat);

    const acr = WT;          // épaisseur acrotère = épaisseur mur
    const halfW = w * 0.5, halfD = d * 0.5;

    // Acrotère (bandeau continu sur le pourtour)
    // — faces N/S
    mesh(sc, cx,          y + FH, cz - halfD, w,    acr * 0.5, acr, mat);
    mesh(sc, cx,          y + FH, cz + halfD, w,    acr * 0.5, acr, mat);
    // — faces E/O
    mesh(sc, cx - halfW,  y + FH, cz,         acr,  acr * 0.5, d,   mat);
    mesh(sc, cx + halfW,  y + FH, cz,         acr,  acr * 0.5, d,   mat);

    // Merlons — rangée sur les 4 faces
    const mH = merlon, mW = crenStep * 0.5, gap = crenStep;

    // Face N et S
    for (let x = cx - halfW + gap * 0.5; x < cx + halfW; x += gap) {
        mesh(sc, x, y + FH + acr * 0.5, cz - halfD, mW, mH, acr, mat);
        mesh(sc, x, y + FH + acr * 0.5, cz + halfD, mW, mH, acr, mat);
    }
    // Face E et O
    for (let z = cz - halfD + gap * 0.5; z < cz + halfD; z += gap) {
        mesh(sc, cx - halfW, y + FH + acr * 0.5, z, acr, mH, mW, mat);
        mesh(sc, cx + halfW, y + FH + acr * 0.5, z, acr, mH, mW, mat);
    }
}

/**
 * Toit en pignon (deux versants inclinés + pignons triangulaires).
 *
 * Le faîtage court parallèle à Z. Les versants descendent sur les faces E/O.
 * Les pignons ferment les faces N et S.
 *
 * @param {number} cx, y, cz   — centre, hauteur de la sablière (base du toit)
 * @param {number} w           — largeur (axe X) — direction de la pente
 * @param {number} d           — longueur (axe Z) — direction du faîtage
 * @param {number} rh          — hauteur du faîtage au-dessus de la sablière
 * @param mat                  — matériau
 * @param {number} overhang    — débord de toit (avant-toit, défaut 0.40)
 */
export function roofGable(sc, cx, y, cz, w, d, rh, mat, overhang = 0.40) {
    // Chaque versant = une boîte inclinée, modélisé comme prisme
    // On approche avec 2 BoxGeometry skewés via position + rotation
    const hw    = w * 0.5 + overhang;   // demi-largeur avec débord
    const hd    = d * 0.5 + overhang;   // demi-longueur avec débord
    const slope = Math.atan2(rh, w * 0.5);
    const sLen  = Math.sqrt(rh * rh + (w * 0.5) * (w * 0.5));  // longueur de versant

    // Versant OUEST (incliné vers x-min)
    const vW = new THREE.Mesh(new THREE.BoxGeometry(sLen + overhang, FH * 1.5, d + overhang * 2), mat);
    vW.position.set(cx - w * 0.25, y + rh * 0.5, cz);
    vW.rotation.z =  slope;
    sc.add(vW);

    // Versant EST (incliné vers x+max)
    const vE = new THREE.Mesh(new THREE.BoxGeometry(sLen + overhang, FH * 1.5, d + overhang * 2), mat);
    vE.position.set(cx + w * 0.25, y + rh * 0.5, cz);
    vE.rotation.z = -slope;
    sc.add(vE);

    // Pignons triangulaires N et S (visuels seulement)
    // Approché par 3 boîtes en gradins (N)
    _gableEnd(sc, cx, y, cz - d * 0.5, w, rh, mat);
    _gableEnd(sc, cx, y, cz + d * 0.5, w, rh, mat);

    // Faîtage
    mesh(sc, cx, y + rh, cz, 0.18, 0.18, d + overhang * 2, mat);
}

/** Pignon triangulaire en gradins (interne). */
function _gableEnd(sc, cx, y, cz, w, rh, mat) {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
        const t   = (i + 0.5) / steps;
        const bw  = w * (1 - t);
        const bh  = rh / steps;
        mesh(sc, cx, y + i * bh, cz, bw, bh, WT, mat);
    }
}
