import * as THREE from 'three';
import { getHeight } from '../world.js';
import { addFloor, addCeiling, addWall, addRamp } from '../collision.js';
import { torch, light } from '../builder.js';

// ═══════════════════════════════════════════════════════════════
//  tower_house.js — "La Maison Tordue"  (V2)
//
//  Architecture (de bas en haut) :
//
//  1) Socle maçonné massif — brique irrégulière, fenêtres petites
//     Volume A : 4m × 8m  (étroit, porteur)
//     Volume B : 4m × 6m  (annexe avant-gauche, 1m plus loin au S)
//
//  2) Grand encorbellement structurel (yE)
//     Grosses poutres horizontales (BW=0.28, ext=1.2m)
//     Consoles diagonales très visibles (angle 50°)
//     ovhLong + ovhCorner décoratifs par-dessus
//
//  3) Corps supérieur en colombage
//     Vol A : 2 étages (yE + yE2) — grand pignon S dominant
//     Vol B : 1 étage (yE)        — pignon secondaire avant
//
//  4) Deux hautes cheminées en pierre (à partir du sol)
//
//  5) Tour-flèche ouverte (gauche-arrière) — 4 poteaux + câbles
//
//  Grilles :
//    Vol A (4m×8m) : xgA=[cx, cx+2]       zgA=[cz-3, cz-1, cz+1, cz+3]
//    Vol B (4m×6m) : xgB=[cx-4, cx-2]     zgB=[cz-1, cz+1, cz+3]
//
//  → Grand pignon S de Vol A  (4m large, très raide) : pièce centrale
//  → Pignon S de Vol B        (4m, 1 niveau plus bas) : en avant-gauche
//  → Junction des toitures à l'intérieur du volume
// ═══════════════════════════════════════════════════════════════

const KIT   = 'assets/environment/village/';
const PROPS = 'assets/environment/props/';
const WH    = 3.12;

// ── Matériaux procéduraux ────────────────────────────────────
const mBeam   = new THREE.MeshLambertMaterial({ color: 0x1e0d04 });
const mBrace  = new THREE.MeshLambertMaterial({ color: 0x28140a });
const mIron   = new THREE.MeshLambertMaterial({ color: 0x0e0a10 });
const mFoundA = new THREE.MeshLambertMaterial({ color: 0x524232 });
const mFoundB = new THREE.MeshLambertMaterial({ color: 0x483c2c });

// ── Helpers glTF ─────────────────────────────────────────────
function _p(sc, model, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
    if (!model) return null;
    const o = model.clone(true);
    o.position.set(x, y, z);
    if (ry !== 0) o.rotation.y = ry;
    if (sx !== 1 || sy !== 1 || sz !== 1) o.scale.set(sx, sy, sz);
    sc.add(o);
    return o;
}

function _noZFight(obj) {
    if (!obj) return obj;
    obj.traverse(c => {
        if (!c.isMesh) return;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        const cl = mats.map(m => {
            const mc = m.clone();
            mc.polygonOffset = true; mc.polygonOffsetFactor = -1; mc.polygonOffsetUnits = -4;
            return mc;
        });
        c.material = Array.isArray(c.material) ? cl : cl[0];
    });
    return obj;
}

function _patchGlass(obj) {
    const patch = new THREE.MeshBasicMaterial({
        color: 0x8aa8b8, transparent: true, opacity: 0.25,
        side: THREE.DoubleSide, depthWrite: false,
    });
    obj.traverse(child => {
        if (!child.isMesh) return;
        if (Array.isArray(child.material))
            child.material = child.material.map(m => m?.name === 'MI_WindowGlass' ? patch : m);
        else if (child.material?.name === 'MI_WindowGlass')
            child.material = patch;
    });
}

function _tintRoof(obj, hex = 0x7a2200) {
    if (!obj) return obj;
    obj.traverse(c => {
        if (!c.isMesh) return;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(mat => { if (mat.color) mat.color.setHex(hex); });
    });
    return obj;
}

// ── Terrain ───────────────────────────────────────────────────
function _fp(cx, cz, w, d) {
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
        const h = getHeight(cx - w * .5 + (i / 4) * w, cz - d * .5 + (j / 4) * d);
        if (h < minY) minY = h; if (h > maxY) maxY = h;
    }
    return { minY, maxY, buildY: maxY + 0.12 };
}

// ════════════════════════════════════════════════════════════════
//  EXPORT
// ════════════════════════════════════════════════════════════════
export function buildTowerHouse(scene, loader, cx, cz) {
    const fp = _fp(cx, cz, 12, 14);
    const yG  = fp.buildY;
    const yE  = yG + WH;        // plancher encorbellement
    const yE2 = yG + WH * 2;    // comble Vol A
    const yRA = yG + WH * 3;    // faîtage Vol A (dominant)
    const yRB = yG + WH * 2;    // faîtage Vol B (= yE2)

    // ── Volumes ──────────────────────────────────────────────────
    // Vol A — tour principale, droite, haute
    const aX = cx + 1, aZ = cz;
    const aHW = 2, aHD = 4;    // 4m E-W × 8m N-S
    const xgA = [cx, cx + 2];
    const zgA = [cz - 3, cz - 1, cz + 1, cz + 3];

    // Vol B — annexe avant-gauche, plus basse
    const bX = cx - 3, bZ = cz + 2;
    const bHW = 2, bHD = 3;    // 4m E-W × 6m N-S
    const xgB = [cx - 4, cx - 2];
    const zgB = [cz - 1, cz + 1, cz + 3];

    const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;

    // ── Fondations ───────────────────────────────────────────────
    _buildFoundations(scene, aX, aZ, aHW, aHD, bX, bZ, bHW, bHD, fp);

    // ── Collision ─────────────────────────────────────────────────
    _buildCollision(aX, aZ, aHW, aHD, bX, bZ, bHW, bHD, yG, yE, yE2, yRA, yRB);

    // ── Éléments procéduraux (synchrones) ────────────────────────
    _buildMassiveJettying(scene, aX, aZ, aHW, aHD, yE);
    _buildSpire(scene, cx - 5.5, cz - 3.5, yG, yRA, aX - aHW, yRA - 0.4);
    _buildLights(scene, aX, aZ, aHW, aHD, bX, bZ, bHD, yG, yE, yE2);

    // ── Chargement glTF ───────────────────────────────────────────
    const urls = {
        // Brique (RdC)
        wBrick:     KIT + 'Wall_UnevenBrick_Straight.gltf',
        wBrickWin:  KIT + 'Wall_UnevenBrick_Window_Wide_Round.gltf',
        wBrickDoor: KIT + 'Wall_UnevenBrick_Door_Round.gltf',
        crnBrick:   KIT + 'Corner_Exterior_Brick.gltf',
        crnBrickW:  KIT + 'Corner_ExteriorWide_Brick.gltf',
        // Colombage (étages)
        wPlast:     KIT + 'Wall_Plaster_Straight.gltf',
        wPlastWin:  KIT + 'Wall_Plaster_Window_Wide_Round.gltf',
        wPlastGrid: KIT + 'Wall_Plaster_WoodGrid.gltf',
        crnWood:    KIT + 'Corner_Exterior_Wood.gltf',
        crnWoodW:   KIT + 'Corner_ExteriorWide_Wood.gltf',
        // Encorbellement décoratif
        ovhLong:    KIT + 'Overhang_UnevenBrick_Long.gltf',
        ovhCorner:  KIT + 'Overhang_UnevenBrick_Corner.gltf',
        // Sols
        flBrick:    KIT + 'Floor_Brick.gltf',
        flWood:     KIT + 'Floor_WoodDark.gltf',
        // Toitures
        roofA:      KIT + 'Roof_RoundTiles_4x8.gltf',
        roofB:      KIT + 'Roof_RoundTiles_4x6.gltf',
        frontA:     KIT + 'Roof_Front_Brick4.gltf',
        frontB:     KIT + 'Roof_Front_Brick4.gltf',
        // Cheminées (démarrent au sol)
        chimney:    KIT + 'Prop_Chimney.gltf',
        chimney2:   KIT + 'Prop_Chimney2.gltf',
        // Props
        lantern:    PROPS + 'Lantern_Wall.gltf',
        barrel:     PROPS + 'Barrel.gltf',
        chest:      PROPS + 'Chest_Wood.gltf',
    };

    const m = {};
    let rem = Object.keys(urls).length;
    const done = () => {
        if (--rem > 0) return;
        _assemble(scene, m, cx, cz, aX, aZ, aHW, aHD, bX, bZ, bHW, bHD,
                  xgA, zgA, xgB, zgB, yG, yE, yE2, yRA, yRB, S, N, E, W);
        console.log('[TowerHouse] La Maison Tordue V2 ✓');
    };
    for (const [key, url] of Object.entries(urls)) {
        loader.load(url,
            gltf => { _patchGlass(gltf.scene); m[key] = gltf.scene; done(); },
            undefined, () => done()
        );
    }
}

// ════════════════════════════════════════════════════════════════
//  FONDATIONS
// ════════════════════════════════════════════════════════════════
function _buildFoundations(scene, aX, aZ, aHW, aHD, bX, bZ, bHW, bHD, fp) {
    const h = Math.max(0.5, fp.buildY - fp.minY + 0.5);
    const mA = new THREE.Mesh(
        new THREE.BoxGeometry(aHW * 2 + 0.5, h, aHD * 2 + 0.5), mFoundA);
    mA.position.set(aX, fp.minY - 0.4 + h * 0.5, aZ);
    scene.add(mA);
    const mB = new THREE.Mesh(
        new THREE.BoxGeometry(bHW * 2 + 0.5, h * 0.85, bHD * 2 + 0.5), mFoundB);
    mB.position.set(bX, fp.minY - 0.4 + h * 0.85 * 0.5, bZ);
    scene.add(mB);
}

// ════════════════════════════════════════════════════════════════
//  COLLISION
// ════════════════════════════════════════════════════════════════
function _buildCollision(aX, aZ, aHW, aHD, bX, bZ, bHW, bHD, yG, yE, yE2, yRA, yRB) {
    const th = 0.4;

    // Vol A — 3 niveaux
    addFloor(aX, aZ, aHW*2, aHD*2, yG);
    addFloor(aX, aZ, aHW*2, aHD*2, yE);
    addFloor(aX, aZ, aHW*2, aHD*2, yE2);
    addCeiling(aX, aZ, aHW*2, aHD*2, yRA);
    for (const [y0, y1] of [[yG, yE], [yE, yE2], [yE2, yRA]]) {
        addWall(aX,       aZ+aHD, aHW*2, th, y0, y1);
        addWall(aX,       aZ-aHD, aHW*2, th, y0, y1);
        addWall(aX+aHW,   aZ,     th, aHD*2, y0, y1);
        addWall(aX-aHW,   aZ,     th, aHD*2, y0, y1);
    }

    // Vol B — 2 niveaux
    addFloor(bX, bZ, bHW*2, bHD*2, yG);
    addFloor(bX, bZ, bHW*2, bHD*2, yE);
    addCeiling(bX, bZ, bHW*2, bHD*2, yRB);
    for (const [y0, y1] of [[yG, yE], [yE, yRB]]) {
        addWall(bX,       bZ+bHD, bHW*2, th, y0, y1);
        addWall(bX,       bZ-bHD, bHW*2, th, y0, y1);
        addWall(bX+bHW,   bZ,     th, bHD*2, y0, y1);
        addWall(bX-bHW,   bZ,     th, bHD*2, y0, y1);
    }
}

// ════════════════════════════════════════════════════════════════
//  ENCORBELLEMENT MASSIF
//  Grosses poutres portantes + consoles diagonales très visibles
//  C'est la rupture visuelle principale entre RdC et étages
// ════════════════════════════════════════════════════════════════
function _buildMassiveJettying(scene, aX, aZ, aHW, aHD, yE) {
    const BW = 0.26, BH = 0.30;   // section poutre — grosse !
    const EXT = 1.15;              // dépassement vers l'extérieur
    const BR_L = 1.05;             // longueur console diagonale
    const BR_ANG = Math.PI * 0.32; // ~58° — angle raide

    // ── Face S — 3 poutres sur 4m ─────────────────────────────
    const sBeamZ = aZ + aHD + EXT - BW * 0.5;
    for (const x of [aX - aHW, aX, aX + aHW]) {
        // Poutre horizontale principale
        const b = new THREE.Mesh(
            new THREE.BoxGeometry(BW, BH, EXT * 2), mBeam);
        b.position.set(x, yE - BH * 0.55, aZ + aHD + EXT * 0.5);
        scene.add(b);
        // Console diagonale
        const c = new THREE.Mesh(
            new THREE.BoxGeometry(BW * 0.75, BR_L, BW * 0.75), mBrace);
        c.rotation.x = BR_ANG;
        c.position.set(x, yE - BH * 0.4 - BR_L * Math.cos(BR_ANG) * 0.45,
                       aZ + aHD - BR_L * Math.sin(BR_ANG) * 0.45);
        scene.add(c);
    }
    // Linteau horizontal (fascia beam) au bout des poutres
    const fascia = new THREE.Mesh(
        new THREE.BoxGeometry(aHW * 2 + BW, BH * 0.55, BW * 0.6), mBeam);
    fascia.position.set(aX, yE - BH * 0.35, aZ + aHD + EXT * 0.95);
    scene.add(fascia);
    // Sablière (poutre plate au niveau du mur)
    const sill = new THREE.Mesh(
        new THREE.BoxGeometry(aHW * 2 + BW * 2, BH * 0.38, BW * 0.45), mBeam);
    sill.position.set(aX, yE - BH * 0.25, aZ + aHD - BW * 0.1);
    scene.add(sill);

    // ── Face N ────────────────────────────────────────────────
    for (const x of [aX - aHW, aX, aX + aHW]) {
        const b = new THREE.Mesh(
            new THREE.BoxGeometry(BW, BH, EXT * 2), mBeam);
        b.position.set(x, yE - BH * 0.55, aZ - aHD - EXT * 0.5);
        scene.add(b);
        const c = new THREE.Mesh(
            new THREE.BoxGeometry(BW * 0.75, BR_L, BW * 0.75), mBrace);
        c.rotation.x = -BR_ANG;
        c.position.set(x, yE - BH * 0.4 - BR_L * Math.cos(BR_ANG) * 0.45,
                       aZ - aHD + BR_L * Math.sin(BR_ANG) * 0.45);
        scene.add(c);
    }

    // ── Face E ────────────────────────────────────────────────
    for (const z of [aZ - aHD * 0.6, aZ, aZ + aHD * 0.6]) {
        const b = new THREE.Mesh(
            new THREE.BoxGeometry(EXT * 2, BH, BW), mBeam);
        b.position.set(aX + aHW + EXT * 0.5, yE - BH * 0.55, z);
        scene.add(b);
        const c = new THREE.Mesh(
            new THREE.BoxGeometry(BR_L, BW * 0.75, BW * 0.75), mBrace);
        c.rotation.z = -BR_ANG;
        c.position.set(aX + aHW - BR_L * Math.sin(BR_ANG) * 0.45,
                       yE - BH * 0.4 - BR_L * Math.cos(BR_ANG) * 0.45, z);
        scene.add(c);
    }

    // ── Face W (côté tour) — poutres courtes ───────────────────
    for (const z of [aZ - aHD * 0.5, aZ + aHD * 0.5]) {
        const b = new THREE.Mesh(
            new THREE.BoxGeometry(EXT * 0.8, BH * 0.8, BW), mBeam);
        b.position.set(aX - aHW - EXT * 0.3, yE - BH * 0.5, z);
        scene.add(b);
    }
}

// ════════════════════════════════════════════════════════════════
//  TOUR-FLÈCHE OUVERTE (gauche-arrière)
// ════════════════════════════════════════════════════════════════
function _buildSpire(scene, tx, tz, yG, yRA, wallX, cableY) {
    const tH  = yRA - yG + WH * 1.1;  // plus haute que le faîtage
    const tw  = 0.5;                   // demi-largeur

    // 4 poteaux d'angle
    const corners = [[-tw,-tw],[tw,-tw],[-tw,tw],[tw,tw]];
    for (const [dx, dz] of corners) {
        const p = new THREE.Mesh(
            new THREE.CylinderGeometry(0.038, 0.058, tH, 5), mBeam);
        p.position.set(tx + dx, yG + tH * 0.5, tz + dz);
        scene.add(p);
    }

    // Traverses horizontales (6 niveaux)
    for (let li = 0; li <= 6; li++) {
        const y = yG + (li / 6) * tH;
        for (const dx of [-tw, tw]) {
            const b = new THREE.Mesh(
                new THREE.BoxGeometry(0.042, 0.042, tw*2), mBeam);
            b.position.set(tx+dx, y, tz); scene.add(b);
        }
        for (const dz of [-tw, tw]) {
            const b = new THREE.Mesh(
                new THREE.BoxGeometry(tw*2, 0.042, 0.042), mBeam);
            b.position.set(tx, y, tz+dz); scene.add(b);
        }
    }

    // Diagonales sur 4 faces
    for (let li = 0; li < 6; li++) {
        const y0 = yG + (li / 6) * tH;
        const y1 = yG + ((li+1) / 6) * tH;
        const mY = (y0 + y1) * 0.5;
        const sH = y1 - y0, sW = tw * 2;
        const dL = Math.hypot(sH, sW);
        const da = Math.atan2(sW, sH);
        const alt = li % 2 === 0;

        [[0.04, 0, mBeam, 'z'], [0, 0.04, mBeam, 'x']].forEach(([bx, bz, mat, axis]) => {
            const geo = new THREE.BoxGeometry(
                axis==='x' ? dL : 0.038, axis==='x' ? 0.038 : dL, 0.038);
            const d1 = new THREE.Mesh(geo, mat);
            const d2 = new THREE.Mesh(geo, mat);
            if (axis === 'z') {
                d1.position.set(tx-tw, mY, tz); d1.rotation.z = alt ? -da : da;
                d2.position.set(tx+tw, mY, tz); d2.rotation.z = alt ? da : -da;
            } else {
                d1.position.set(tx, mY, tz-tw); d1.rotation.x = alt ? da : -da;
                d2.position.set(tx, mY, tz+tw); d2.rotation.x = alt ? -da : da;
            }
            scene.add(d1); scene.add(d2);
        });
    }

    // Flèche au sommet
    const spire = new THREE.Mesh(
        new THREE.ConeGeometry(tw * 0.5, WH * 0.65, 4), mBeam);
    spire.rotation.y = Math.PI / 4;
    spire.position.set(tx, yG + tH + WH * 0.32, tz);
    scene.add(spire);

    // Girouette
    const gH = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.04), mIron);
    gH.position.set(tx, yG + tH + WH * 0.68, tz); scene.add(gH);
    const gV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.04), mIron);
    gV.position.set(tx + 0.4, yG + tH + WH * 0.73, tz); scene.add(gV);

    // Câbles tendus vers le toit principal (3 câbles)
    const topY = yG + tH + WH * 0.04;
    for (const [tx2, ty2, tz2] of [
        [wallX, cableY,       tz + 2 ],
        [wallX, cableY - 0.5, tz     ],
        [wallX, cableY - 1.0, tz - 2 ],
    ]) {
        const pts = [
            new THREE.Vector3(tx, topY, tz),
            new THREE.Vector3(tx2, ty2, tz2),
        ];
        const cable = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0x090909 })
        );
        scene.add(cable);
    }
}

// ════════════════════════════════════════════════════════════════
//  LUMIÈRES
// ════════════════════════════════════════════════════════════════
function _buildLights(scene, aX, aZ, aHW, aHD, bX, bZ, bHD, yG, yE, yE2) {
    torch(scene, bX - 0.5,      yG + 2.1, bZ + bHD + 0.1, 'S');
    torch(scene, bX + 1.5,      yG + 2.1, bZ + bHD + 0.1, 'S');
    torch(scene, aX + aHW + 0.1,yG + 2.1, aZ + 1.5,       'E');
    light(scene, aX, yG + WH * 0.65, aZ,       4, 11);
    light(scene, aX, yE + WH * 0.65, aZ,       3, 9);
    light(scene, aX, yE2 + WH * 0.5, aZ,       2.5, 7);
    light(scene, bX, yG + WH * 0.65, bZ,       3, 9);
}

// ════════════════════════════════════════════════════════════════
//  ASSEMBLAGE glTF
// ════════════════════════════════════════════════════════════════
function _assemble(scene, m, cx, cz,
    aX, aZ, aHW, aHD, bX, bZ, bHW, bHD,
    xgA, zgA, xgB, zgB,
    yG, yE, yE2, yRA, yRB,
    S, N, E, W
) {
    // ────────────────────────────────────────────────────────────
    //  VOLUME A — RdC (brique irrégulière, socle porteur)
    // ────────────────────────────────────────────────────────────
    // Face S : [fenêtre | porte]  (2 panneaux 4m → porte centrée à droite)
    xgA.forEach((x, i) => _p(scene, m[i === 0 ? 'wBrickWin' : 'wBrickDoor'], x, yG, aZ+aHD, S));
    // Face N : [brique | brique]
    xgA.forEach(x => _p(scene, m.wBrick, x, yG, aZ-aHD, N));
    // Face E : [fenêtre | brique | brique | fenêtre]
    const rdcAE = ['wBrickWin','wBrick','wBrick','wBrickWin'];
    zgA.forEach((z, i) => _p(scene, m[rdcAE[i]], aX+aHW, yG, z, E));
    // Face W : [brique | brique | fenêtre | brique]
    const rdcAW = ['wBrick','wBrick','wBrickWin','wBrick'];
    zgA.forEach((z, i) => _p(scene, m[rdcAW[i]], aX-aHW, yG, z, W));
    // Coins RdC A
    for (const [x, z, ry] of [
        [aX-aHW, aZ+aHD, S],[aX+aHW, aZ+aHD, E],
        [aX-aHW, aZ-aHD, W],[aX+aHW, aZ-aHD, N],
    ]) _noZFight(_p(scene, m.crnBrickW, x, yG, z, ry));

    // ────────────────────────────────────────────────────────────
    //  VOLUME A — Étage 1 (colombage + encorbellement)
    // ────────────────────────────────────────────────────────────
    const e1AS = ['wPlastGrid','wPlastWin'];
    const e1AN = ['wPlastWin', 'wPlastGrid'];
    const e1AE = ['wPlastWin','wPlastGrid','wPlastWin','wPlast'];
    const e1AW = ['wPlast','wPlastGrid','wPlastWin','wPlast'];

    xgA.forEach((x,i) => _p(scene, m[e1AS[i]], x, yE, aZ+aHD, S));
    xgA.forEach((x,i) => _p(scene, m[e1AN[i]], x, yE, aZ-aHD, N));
    zgA.forEach((z,i) => _p(scene, m[e1AE[i]], aX+aHW, yE, z, E));
    zgA.forEach((z,i) => _p(scene, m[e1AW[i]], aX-aHW, yE, z, W));

    // ovhLong décoratif sur toutes les faces (par-dessus les poutres)
    for (const x of xgA) _noZFight(_p(scene, m.ovhLong, x,       yE, aZ+aHD, S));
    for (const x of xgA) _noZFight(_p(scene, m.ovhLong, x,       yE, aZ-aHD, N));
    for (const z of zgA) _noZFight(_p(scene, m.ovhLong, aX+aHW, yE, z,      E));
    for (const z of zgA) _noZFight(_p(scene, m.ovhLong, aX-aHW, yE, z,      W));
    _noZFight(_p(scene, m.ovhCorner, aX-aHW, yE, aZ+aHD, S));
    _noZFight(_p(scene, m.ovhCorner, aX+aHW, yE, aZ+aHD, E));
    _noZFight(_p(scene, m.ovhCorner, aX-aHW, yE, aZ-aHD, W));
    _noZFight(_p(scene, m.ovhCorner, aX+aHW, yE, aZ-aHD, N));

    // Coins étage 1 A
    for (const [x, z, ry] of [
        [aX-aHW, aZ+aHD, S],[aX+aHW, aZ+aHD, E],
        [aX-aHW, aZ-aHD, W],[aX+aHW, aZ-aHD, N],
    ]) _noZFight(_p(scene, m.crnWoodW, x, yE, z, ry));

    // ────────────────────────────────────────────────────────────
    //  VOLUME A — Étage 2 / comble (colombage haut)
    // ────────────────────────────────────────────────────────────
    const e2AS = ['wPlastGrid','wPlastWin'];
    const e2AN = ['wPlastWin', 'wPlastGrid'];
    const e2AE = ['wPlast','wPlastWin','wPlastGrid','wPlast'];
    const e2AW = ['wPlastGrid','wPlast','wPlastWin','wPlast'];

    xgA.forEach((x,i) => _p(scene, m[e2AS[i]], x, yE2, aZ+aHD, S));
    xgA.forEach((x,i) => _p(scene, m[e2AN[i]], x, yE2, aZ-aHD, N));
    zgA.forEach((z,i) => _p(scene, m[e2AE[i]], aX+aHW, yE2, z, E));
    zgA.forEach((z,i) => _p(scene, m[e2AW[i]], aX-aHW, yE2, z, W));

    for (const [x, z, ry] of [
        [aX-aHW, aZ+aHD, S],[aX+aHW, aZ+aHD, E],
        [aX-aHW, aZ-aHD, W],[aX+aHW, aZ-aHD, N],
    ]) _noZFight(_p(scene, m.crnWood, x, yE2, z, ry));

    // ────────────────────────────────────────────────────────────
    //  VOLUME B — RdC
    // ────────────────────────────────────────────────────────────
    // Face S : [brique | porte]
    xgB.forEach((x,i) => _p(scene, m[i===0 ? 'wBrickWin' : 'wBrickDoor'], x, yG, bZ+bHD, S));
    xgB.forEach(x => _p(scene, m.wBrick, x, yG, bZ-bHD, N));
    const rdcBEW = ['wBrick','wBrickWin','wBrick'];
    zgB.forEach((z,i) => _p(scene, m[rdcBEW[i]], bX+bHW, yG, z, E));
    zgB.forEach((z,i) => _p(scene, m[rdcBEW[i]], bX-bHW, yG, z, W));

    for (const [x, z, ry] of [
        [bX-bHW, bZ+bHD, S],[bX+bHW, bZ+bHD, E],
        [bX-bHW, bZ-bHD, W],[bX+bHW, bZ-bHD, N],
    ]) _noZFight(_p(scene, m.crnBrick, x, yG, z, ry));

    // ────────────────────────────────────────────────────────────
    //  VOLUME B — Étage (colombage, encorbellement S uniquement)
    // ────────────────────────────────────────────────────────────
    xgB.forEach((x,i) => _p(scene, m[i===0 ? 'wPlastGrid' : 'wPlastWin'], x, yE, bZ+bHD, S));
    xgB.forEach(x => _p(scene, m.wPlastGrid, x, yE, bZ-bHD, N));
    const e1BEW = ['wPlastWin','wPlastGrid','wPlastWin'];
    zgB.forEach((z,i) => _p(scene, m[e1BEW[i]], bX+bHW, yE, z, E));
    zgB.forEach((z,i) => _p(scene, m[e1BEW[i]], bX-bHW, yE, z, W));

    // Encorbellement face S de B
    for (const x of xgB) _noZFight(_p(scene, m.ovhLong, x, yE, bZ+bHD, S));
    _noZFight(_p(scene, m.ovhCorner, bX-bHW, yE, bZ+bHD, S));
    _noZFight(_p(scene, m.ovhCorner, bX+bHW, yE, bZ+bHD, E));

    for (const [x, z, ry] of [
        [bX-bHW, bZ+bHD, S],[bX+bHW, bZ+bHD, E],
        [bX-bHW, bZ-bHD, W],[bX+bHW, bZ-bHD, N],
    ]) _noZFight(_p(scene, m.crnWood, x, yE, z, ry));

    // ────────────────────────────────────────────────────────────
    //  SOLS
    // ────────────────────────────────────────────────────────────
    for (const x of xgA) for (const z of zgA) {
        _p(scene, m.flBrick, x, yG, z);
        _p(scene, m.flWood,  x, yE, z);
        _p(scene, m.flWood,  x, yE2, z);
    }
    for (const x of xgB) for (const z of zgB) {
        _p(scene, m.flBrick, x, yG, z);
        _p(scene, m.flWood,  x, yE, z);
    }

    // ────────────────────────────────────────────────────────────
    //  TOITURES
    // ────────────────────────────────────────────────────────────
    // Vol A — 4m × 8m, grand pignon S dominant
    _tintRoof(_p(scene, m.roofA, aX, yRA, aZ, 0));
    _tintRoof(_noZFight(_p(scene, m.frontA, aX, yRA, aZ+aHD, S)));
    _tintRoof(_noZFight(_p(scene, m.frontA, aX, yRA, aZ-aHD, N)));

    // Vol B — 4m × 6m, pignon avant-gauche
    _tintRoof(_p(scene, m.roofB, bX, yRB, bZ, 0));
    _tintRoof(_noZFight(_p(scene, m.frontB, bX, yRB, bZ+bHD, S)));
    _tintRoof(_noZFight(_p(scene, m.frontB, bX, yRB, bZ-bHD, N)));

    // ────────────────────────────────────────────────────────────
    //  DEUX HAUTES CHEMINÉES (démarrent au sol)
    // ────────────────────────────────────────────────────────────
    _p(scene, m.chimney,  aX - 1.2, yG, aZ - 2.5);   // arrière gauche
    _p(scene, m.chimney2, aX + 0.8, yG, aZ + 2.0);   // avant droite

    // ────────────────────────────────────────────────────────────
    //  DÉCOR EXTÉRIEUR
    // ────────────────────────────────────────────────────────────
    _p(scene, m.lantern, bX - 1.95, yG + 2.3, bZ+bHD+0.06, S);
    _p(scene, m.lantern, bX + 1.85, yG + 2.3, bZ+bHD+0.06, S);
    _p(scene, m.lantern, aX + aHW + 0.06, yG + 2.3, aZ + 1.5, E);
    _p(scene, m.barrel, bX - 0.8, yG, bZ+bHD+1.1);
    _p(scene, m.barrel, bX - 1.6, yG, bZ+bHD+1.2, Math.PI*0.3);
    _p(scene, m.chest,  aX + 1.5, yG, aZ + 3.8, W);
}
