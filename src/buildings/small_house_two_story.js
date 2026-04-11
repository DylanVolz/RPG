import * as THREE from 'three';
import { getHeight } from '../world.js';
import { addFloor, addCeiling, addWall, addRamp } from '../collision.js';
import { torch, light } from '../builder.js';

// ═══════════════════════════════════════════════════════════════
//  small_house_two_story.js
//  Modèle réutilisable : petite maison 2 étages + cave
//  Empreinte : 8m(X) × 10m(Z) — 4 panneaux × 5 panneaux de 2m
//  Superficie : ~80m²
//  Usage : buildSmallHouseTwoStory(scene, loader, cx, cz, by?)
// ═══════════════════════════════════════════════════════════════

const KIT   = 'assets/environment/village/';
const PROPS = 'assets/environment/props/';
const WH    = 3.12;   // hauteur d'un panneau mural

const mTWood = new THREE.MeshLambertMaterial({ color: 0x7a5028 });

function _p(sc, model, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
    if (!model) return null;
    const o = model.clone(true);
    o.position.set(x, y, z);
    if (ry !== 0) o.rotation.y = ry;
    if (sx !== 1 || sy !== 1 || sz !== 1) o.scale.set(sx, sy, sz);
    sc.add(o);
    return o;
}

// Applique polygonOffset sur tous les meshes d'un objet pour éliminer le Z-fighting
// factor/units négatifs = pousse vers le viewer (pièce de trim rendue devant la surface de base)
function _noZFight(obj, factor = -1, units = -4) {
    if (!obj) return;
    obj.traverse(c => {
        if (!c.isMesh) return;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        const cloned = mats.map(m => {
            const mc = m.clone();
            mc.polygonOffset       = true;
            mc.polygonOffsetFactor = factor;
            mc.polygonOffsetUnits  = units;
            return mc;
        });
        c.material = Array.isArray(c.material) ? cloned : cloned[0];
    });
}

/**
 * Construit une petite maison 2 étages + cave à la position (cx, cz).
 * @param {THREE.Scene} scene
 * @param {GLTFLoader}  loader
 * @param {number}      cx     — centre X
 * @param {number}      cz     — centre Z
 * @param {number}      [by]   — hauteur sol (défaut : getHeight(cx, cz))
 */
export function buildSmallHouseTwoStory(scene, loader, cx, cz, by) {
    if (by === undefined) by = getHeight(cx, cz);

    const TW = 8, TD = 10;
    const HW = 4, HD = 5;

    const yC = by - WH;
    const yG = by;
    const yE = by + WH;
    const yR = by + WH * 2;

    // ── Collision — sols ──────────────────────────────────────────
    addFloor  (cx, cz, TW, TD, yC + 0.02);
    addCeiling(cx, cz, TW, TD, yG + 0.02);
    addFloor  (cx, cz, TW, TD, yG + 0.02);
    addFloor  (cx, cz, TW, TD, yE + 0.02);

    // ── Collision — murs ──────────────────────────────────────────
    for (const [y0, y1] of [[yC, yG], [yG, yE], [yE, yR]]) {
        addWall(cx,       cz + HD, TW,  0.4, y0, y1);  // S
        addWall(cx,       cz - HD, TW,  0.4, y0, y1);  // N
        addWall(cx + HW,  cz,      0.4, TD,  y0, y1);  // E
        addWall(cx - HW,  cz,      0.4, TD,  y0, y1);  // W
    }

    // ── Collision — rampes d'escalier ─────────────────────────────
    addRamp(cx + 2.0, cz - 1.5, 1.5, 3.5, yC, yG, 'z');
    addRamp(cx - 2.0, cz - 1.5, 1.5, 3.5, yG, yE, 'z');

    // ── Chargement batch ──────────────────────────────────────────
    const toLoad = {
        wBrick:     KIT + 'Wall_UnevenBrick_Straight.gltf',
        wBrickWin:  KIT + 'Wall_UnevenBrick_Window_Wide_Round.gltf',
        wBrickDoor: KIT + 'Wall_UnevenBrick_Door_Round.gltf',
        crnBrick:   KIT + 'Corner_Exterior_Brick.gltf',
        wPlast:     KIT + 'Wall_Plaster_Straight.gltf',
        wPlastWin:  KIT + 'Wall_Plaster_Window_Wide_Round.gltf',
        wPlastGrid: KIT + 'Wall_Plaster_WoodGrid.gltf',
        crnWood:    KIT + 'Corner_Exterior_Wood.gltf',
        flBrick:    KIT + 'Floor_Brick.gltf',
        flRed:      KIT + 'Floor_RedBrick.gltf',
        flWood:     KIT + 'Floor_WoodDark.gltf',
        roof:       KIT + 'Roof_RoundTiles_8x10.gltf',
        roofFront:  KIT + 'Roof_Front_Brick8.gltf',
        chimney:    KIT + 'Prop_Chimney.gltf',
        stairInt:   KIT + 'Stair_Interior_Solid.gltf',
        barrel:     PROPS + 'Barrel.gltf',
        barrelH:    PROPS + 'Barrel_Holder.gltf',
        barrelA:    PROPS + 'Barrel_Apples.gltf',
        shelfArch:  PROPS + 'Shelf_Arch.gltf',
        shelf:      PROPS + 'Shelf_Simple.gltf',
        lantern:    PROPS + 'Lantern_Wall.gltf',
        bottles:    PROPS + 'SmallBottles_1.gltf',
        tableLg:    PROPS + 'Table_Large.gltf',
        chair:      PROPS + 'Chair_1.gltf',
        stool:      PROPS + 'Stool.gltf',
        bench:      PROPS + 'Bench.gltf',
        mug:        PROPS + 'Mug.gltf',
        cauldron:   PROPS + 'Cauldron.gltf',
        chandelier: PROPS + 'Chandelier.gltf',
        bed1:       PROPS + 'Bed_Twin1.gltf',
        bed2:       PROPS + 'Bed_Twin2.gltf',
        nightstand: PROPS + 'Nightstand_Shelf.gltf',
        chest:      PROPS + 'Chest_Wood.gltf',
        candle:     PROPS + 'CandleStick.gltf',
        bookcase:   PROPS + 'Bookcase_2.gltf',
    };

    const m = {};
    let remaining = Object.keys(toLoad).length;
    function _done() {
        remaining--;
        if (remaining === 0) _assemble(scene, m, cx, cz, yC, yG, yE, yR, by);
    }
    for (const [key, url] of Object.entries(toLoad)) {
        loader.load(url, gltf => { m[key] = gltf.scene; _done(); },
                    undefined, () => { _done(); });
    }
}

function _assemble(scene, m, cx, cz, yC, yG, yE, yR, by) {
    const HW = 4, HD = 5;
    const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;

    function row4(keys, y, face) {
        const [ry, zf] = face === 'S' ? [S, cz + HD] : [N, cz - HD];
        [cx-3, cx-1, cx+1, cx+3].forEach((x, i) => _p(scene, m[keys[i]], x, y, zf, ry));
    }
    function row5(keys, y, face) {
        const [ry, xf] = face === 'E' ? [E, cx + HW] : [W, cx - HW];
        [cz-4, cz-2, cz, cz+2, cz+4].forEach((z, i) => _p(scene, m[keys[i]], xf, y, z, ry));
    }

    // ── Murs cave ─────────────────────────────────────────────────
    row4(Array(4).fill('wBrick'), yC, 'S');
    row4(Array(4).fill('wBrick'), yC, 'N');
    row5(Array(5).fill('wBrick'), yC, 'E');
    row5(Array(5).fill('wBrick'), yC, 'W');

    // ── Murs RdC — porte face N ───────────────────────────────────
    row4(['wBrick','wBrickWin','wBrickWin','wBrick'],     yG, 'S');
    row4(['wBrickWin','wBrickDoor','wBrickWin','wBrick'], yG, 'N');
    row5(['wBrick','wBrickWin','wBrick','wBrickWin','wBrick'], yG, 'E');
    row5(['wBrick','wBrickWin','wBrick','wBrickWin','wBrick'], yG, 'W');

    // ── Murs étage ────────────────────────────────────────────────
    row4(['wPlast','wPlastWin','wPlast','wPlastWin'],         yE, 'S');
    row4(['wPlastGrid','wPlastWin','wPlastGrid','wPlastWin'], yE, 'N');
    row5(['wPlast','wPlastWin','wPlastGrid','wPlastWin','wPlast'], yE, 'E');
    row5(['wPlast','wPlastWin','wPlastGrid','wPlastWin','wPlast'], yE, 'W');

    // ── Coins ─────────────────────────────────────────────────────
    for (const [x, z, ry] of [
        [cx-HW, cz+HD, S], [cx+HW, cz+HD, E],
        [cx-HW, cz-HD, W], [cx+HW, cz-HD, N],
    ]) {
        _noZFight(_p(scene, m.crnBrick, x, yC, z, ry));
        _noZFight(_p(scene, m.crnBrick, x, yG, z, ry));
        _noZFight(_p(scene, m.crnWood,  x, yE, z, ry));
    }

    // ── Sols ──────────────────────────────────────────────────────
    const xGrid = [cx-3, cx-1, cx+1, cx+3];
    const zGrid = [cz-4, cz-2, cz, cz+2, cz+4];
    for (const x of xGrid) for (const z of zGrid) {
        _p(scene, m.flRed,   x, yC, z);
        _p(scene, m.flBrick, x, yG, z);
        _p(scene, m.flWood,  x, yE, z);
    }

    // ── Toiture ───────────────────────────────────────────────────
    _p(scene, m.roof, cx, yR, cz);
    _noZFight(_p(scene, m.roofFront, cx, yR, cz + HD, S));   // pignon SUD
    _noZFight(_p(scene, m.roofFront, cx, yR, cz - HD, N));   // pignon NORD
    _p(scene, m.chimney, cx - 3.2, yG, cz - 4.2);

    // ── Escaliers ─────────────────────────────────────────────────
    _p(scene, m.stairInt, cx + 2.0, yC, cz - 1.5, 0, 1, 1, 0.74);
    _p(scene, m.stairInt, cx - 2.0, yG, cz - 1.5, 0, 1, 1, 0.74);

    // ── Cave à vin ────────────────────────────────────────────────
    for (let i = 0; i < 3; i++) {
        _p(scene, m.barrel, cx - 3.2, yC, cz - 3.5 + i * 1.5);
        _p(scene, m.barrel, cx - 2.4, yC, cz - 3.5 + i * 1.5);
    }
    _p(scene, m.barrelA, cx + 0.6, yC, cz - 4.3);
    _p(scene, m.barrelA, cx - 0.6, yC, cz - 4.3);
    _p(scene, m.barrelH, cx - 0.2, yC, cz - 2.5);
    _p(scene, m.barrel,  cx - 0.2, yC + 0.46, cz - 2.5, 0, 0.72, 0.72, 0.72);
    for (let row = 0; row < 3; row++) {
        _p(scene, m.shelfArch, cx + 3.5, yC + 0.55 + row * 0.85, cz - 1.0, W);
        _p(scene, m.bottles,   cx + 3.3, yC + 0.65 + row * 0.85, cz - 1.0, W);
    }
    _p(scene, m.lantern, cx - 3.7, yC + 1.6, cz, E);
    _p(scene, m.lantern, cx + 3.7, yC + 1.6, cz - 2, W);
    light(scene, cx, yC + WH * 0.62, cz, 3.5, 9);

    // ── Rez-de-chaussée ───────────────────────────────────────────
    _p(scene, m.tableLg, cx - 1.5, yG, cz + 3.9);
    _p(scene, m.tableLg, cx + 1.5, yG, cz + 3.9);
    for (let i = -2; i <= 2; i++)
        _p(scene, m.stool, cx + i * 1.0, yG, cz + 2.8);
    _p(scene, m.cauldron, cx + 3.0, yG, cz + 4.2);
    _p(scene, m.tableLg, cx - 1.8, yG, cz - 2.2);
    _p(scene, m.chair,   cx - 1.8, yG, cz - 3.7, 0);
    _p(scene, m.chair,   cx - 1.8, yG, cz - 0.7, N);
    _p(scene, m.chair,   cx - 3.2, yG, cz - 2.2, E);
    _p(scene, m.tableLg, cx + 1.8, yG, cz - 2.2);
    _p(scene, m.chair,   cx + 1.8, yG, cz - 3.7, 0);
    _p(scene, m.chair,   cx + 1.8, yG, cz - 0.7, N);
    _p(scene, m.chair,   cx + 3.2, yG, cz - 2.2, W);
    _p(scene, m.chandelier, cx - 1.8, yG + WH - 0.05, cz - 2.2);
    _p(scene, m.chandelier, cx + 1.8, yG + WH - 0.05, cz - 2.2);
    light(scene, cx - 1.8, yG + WH * 0.75, cz - 2.2, 6, 12);
    light(scene, cx + 1.8, yG + WH * 0.75, cz - 2.2, 5, 11);

    // ── Étage ─────────────────────────────────────────────────────
    _p(scene, m.wPlast,    cx - 3, yE, cz, S);
    _p(scene, m.wPlastWin, cx - 1, yE, cz, S);
    _p(scene, m.wPlastWin, cx + 1, yE, cz, S);
    _p(scene, m.wPlast,    cx + 3, yE, cz, S);
    _p(scene, m.bed1, cx - 2.5, yE, cz - 3.5, E);
    _p(scene, m.bed1, cx + 2.5, yE, cz - 3.5, W);
    _p(scene, m.nightstand, cx - 1.0, yE, cz - 4.3);
    _p(scene, m.chest,      cx + 3.5, yE, cz - 1.0, W);
    _p(scene, m.bed2,       cx - 2.5, yE, cz + 2.5, E);
    _p(scene, m.chest,      cx + 3.5, yE, cz + 3.5, W);
    light(scene, cx - 2.0, yE + WH * 0.7, cz - 2.5, 3.5, 8);
    light(scene, cx + 2.0, yE + WH * 0.7, cz - 2.5, 3.0, 8);

    // ── Extérieur (face N) ────────────────────────────────────────
    const signArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), mTWood);
    signArm.rotation.z = Math.PI / 2;
    signArm.position.set(cx - 2.5, yG + WH * 0.72, cz - HD - 0.05);
    scene.add(signArm);
    const signBoard = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.46, 0.06),
        new THREE.MeshLambertMaterial({ color: 0x3a1c08 }));
    signBoard.position.set(cx - 3.1, yG + WH * 0.70, cz - HD - 0.05);
    scene.add(signBoard);
    _p(scene, m.barrel,  cx + 3.2, yG,       cz - HD - 1.5);
    _p(scene, m.barrelA, cx - 3.2, yG,       cz - HD - 1.3);
    light(scene, cx, yG + WH * 0.82, cz - HD - 0.8, 6, 14);
    torch(scene, cx - 1.5, yG + WH * 0.68, cz - HD + 0.08, 'N');
    torch(scene, cx + 1.5, yG + WH * 0.68, cz - HD + 0.08, 'N');

    console.log('[SmallHouseTwoStory] assemblée à', cx.toFixed(1), cz.toFixed(1), '✓');
}
