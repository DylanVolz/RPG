import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getHeight, getTerrainSlope } from './world.js';
import { addFloor, addCeiling, addWall, addRamp } from './collision.js';
import { mesh, torch, light, FH } from './builder.js';
import { NPC } from './npc.js';
import { buildTowerHouse } from './buildings/tower_house.js';
import { buildTownHall   } from './buildings/town_hall.js';

// ═══════════════════════════════════════════════════════════════
//  TOWN.JS — Valcrest V6
//
//  Bâtiment principal : Taverne "Le Renard Boiteux"
//    • 8m × 10m  (HW=4, HD=5)
//    • 3 niveaux : Cave · RdC · Étage
//    • Style Tudor médiéval :
//        RdC   = brique irrégulière (Wall_UnevenBrick_*)
//        Étage = plâtre + pans de bois (Wall_Plaster_WoodGrid)
//        Toit  = tuiles rondes + lucarnes + 2 cheminées
//    • Encorbellements sur 4 faces (jettying médiéval)
//    • Balcon pleine largeur côté S
//    • Cave : cachot + cave à vin
//
//  Village de base :
//    • Place centrale + puits
//    • Palissade bois r≈58m
//    • Végétation filtrée par pente
//    • 4 NPCs
//
//  Architecture :
//    Toute la géométrie/collision est procédurale (addFloor/addWall/addRamp).
//    Les visuels sont des panneaux glTF du Medieval Village MegaKit.
//    Chaque panneau fait 2m × WH (3.12m) — on les assemble comme des LEGO.
//    _patchGlass() sur chaque loader → plus de crash shader MI_WindowGlass.
// ═══════════════════════════════════════════════════════════════

const KIT    = 'assets/environment/village/';
const PROPS  = 'assets/environment/props/';
const NATURE = 'assets/environment/nature/';

const OUTFITS   = 'assets/characters/outfits/';
const BASE_M    = 'assets/characters/bodies/Superhero_Male_FullBody.gltf';
const NPC_ANIMS = [
    'assets/characters/animations/UAL1_Standard.glb',
    'assets/characters/animations/UAL2_Standard.glb',
];
const NPC_CLIPS = { idle: 'Idle_Loop', walk: 'Walk_Loop' };

// Hauteur d'un panneau mural MegaKit (mesurée sur les modèles)
const WH = 3.12;

// ── Patch vitre — crash shader MI_WindowGlass ────────────────────
const _glassPatch = new THREE.MeshBasicMaterial({
    color: 0x99bbcc, transparent: true, opacity: 0.22,
    side: THREE.DoubleSide, depthWrite: false,
});
_glassPatch.name = 'MI_WindowGlass_patched';
function _patchGlass(obj) {
    obj.traverse(child => {
        if (!child.isMesh) return;
        if (Array.isArray(child.material))
            child.material = child.material.map(m => m?.name === 'MI_WindowGlass' ? _glassPatch : m);
        else if (child.material?.name === 'MI_WindowGlass')
            child.material = _glassPatch;
    });
}

/** Clone et place un modèle glTF. */
function _p(sc, model, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
    if (!model) return null;
    const o = model.clone(true);
    o.position.set(x, y, z);
    if (ry !== 0) o.rotation.y = ry;
    if (sx !== 1 || sy !== 1 || sz !== 1) o.scale.set(sx, sy, sz);
    sc.add(o);
    return o;
}

/** Teinte un objet glTF (utile pour corriger les tuiles blanches du kit). */
function _tintRoof(obj, hex = 0x8b2800) {
    if (!obj) return obj;
    obj.traverse(c => {
        if (!c.isMesh) return;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(mat => { if (mat.color) mat.color.setHex(hex); });
    });
    return obj;
}

/** Anti Z-fighting léger sur un objet glTF. */
function _noZFight(obj, factor = -1, units = -4) {
    if (!obj) return obj;
    obj.traverse(c => {
        if (!c.isMesh) return;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        c.material = mats.map(m => {
            const mc = m.clone();
            mc.polygonOffset = true; mc.polygonOffsetFactor = factor; mc.polygonOffsetUnits = units;
            return mc;
        });
        if (!Array.isArray(obj.material) && mats.length === 1) c.material = c.material[0];
    });
    return obj;
}

// ── PRNG déterministe ────────────────────────────────────────────
function _rng(seed) {
    let s = seed >>> 0;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

// ── Analyse empreinte ────────────────────────────────────────────
function _fp(cx, cz, w, d) {
    const N = 3; let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const h = getHeight(cx - w * 0.5 + (i / N) * w, cz - d * 0.5 + (j / N) * d);
        if (h < minY) minY = h; if (h > maxY) maxY = h;
    }
    return { minY, maxY, buildY: maxY + 0.1 };
}

/** Fondation en pierre sous un bâtiment. */
function _foundation(sc, cx, cz, w, d, fp) {
    const h = Math.max(0.3, fp.buildY - (fp.minY - 0.3));
    const mF = new THREE.MeshLambertMaterial({ color: 0x6a5a4a });
    const o = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h, d + 0.3), mF);
    o.position.set(cx, fp.minY - 0.3 + h * 0.5, cz);
    sc.add(o);
}

// ── Matériaux procéduraux ────────────────────────────────────────
const mGrass  = new THREE.MeshLambertMaterial({ color: 0x70b040 });
const mPath   = new THREE.MeshLambertMaterial({ color: 0xc0b090 });
const mSquare = new THREE.MeshLambertMaterial({ color: 0xb0a880 });
const mJoint  = new THREE.MeshLambertMaterial({ color: 0x888070 });
const mTimber = new THREE.MeshLambertMaterial({ color: 0x9a6030 });
const mStone  = new THREE.MeshLambertMaterial({ color: 0xa09880 });
const mIron   = new THREE.MeshLambertMaterial({ color: 0x2c2530 });
const mPale   = new THREE.MeshLambertMaterial({ color: 0x7a5c30 });

// ── État exporté ─────────────────────────────────────────────────
const _npcs = [];
export function getTownNPCs() { return _npcs; }
const _trapdoors = [];
export function getTavernTrapdoors() { return _trapdoors; }

// ══════════════════════════════════════════════════════════════════
//  EXPORT PRINCIPAL
// ══════════════════════════════════════════════════════════════════
export function buildTown(scene, ox, oz, manager = null) {
    _npcs.length = 0;
    _trapdoors.length = 0;

    const loader = new GLTFLoader(manager || undefined);
    const by = getHeight(ox, oz);

    // Centre taverne — au nord de la place (entrée face au spawn)
    const tx = ox, tz = oz - 28;

    // ── Parties synchrones ─────────────────────────────────────────
    _buildGround    (scene, ox, oz, by);
    _buildTaverneColl(scene, tx, tz);
    _buildPalisade  (scene, ox, oz);
    _spawnNPCs      (scene, ox, oz, tx, tz);

    // ── La Maison Tordue (côté est du village) ─────────────────────
    buildTowerHouse(scene, loader, ox + 36, oz - 18);

    // ── Mairie de Valcrest (sud de la place, entrée face nord) ─────
    buildTownHall(scene, loader, ox, oz + 22);

    // ── Décors glTF (asynchrones) ─────────────────────────────────
    const urls = {
        // ── Murs RdC & cave (brique irrégulière) ──────────────────
        wBrick:     KIT + 'Wall_UnevenBrick_Straight.gltf',
        wBrickWin:  KIT + 'Wall_UnevenBrick_Window_Wide_Round.gltf',
        wBrickDoor: KIT + 'Wall_UnevenBrick_Door_Round.gltf',
        crnBrick:   KIT + 'Corner_Exterior_Brick.gltf',
        crnBrickW:  KIT + 'Corner_ExteriorWide_Brick.gltf',
        // ── Murs étage (plâtre + pans de bois) ────────────────────
        wPlast:     KIT + 'Wall_Plaster_Straight.gltf',
        wPlastWin:  KIT + 'Wall_Plaster_Window_Wide_Round.gltf',
        wPlastGrid: KIT + 'Wall_Plaster_WoodGrid.gltf',
        crnWood:    KIT + 'Corner_Exterior_Wood.gltf',
        crnWoodW:   KIT + 'Corner_ExteriorWide_Wood.gltf',
        // ── Sols (dalles 2×2m) ─────────────────────────────────────
        flBrick:    KIT + 'Floor_Brick.gltf',
        flRed:      KIT + 'Floor_RedBrick.gltf',
        flWood:     KIT + 'Floor_WoodDark.gltf',
        // ── Toiture ───────────────────────────────────────────────
        roof:       KIT + 'Roof_RoundTiles_8x10.gltf',
        roofFront:  KIT + 'Roof_Front_Brick8.gltf',
        roofDormer: KIT + 'Roof_Dormer_RoundTile.gltf',
        chimney:    KIT + 'Prop_Chimney.gltf',
        chimney2:   KIT + 'Prop_Chimney2.gltf',
        // ── Balcon ────────────────────────────────────────────────
        balcStr:    KIT + 'Balcony_Simple_Straight.gltf',
        // ── Escaliers & gardes-corps ───────────────────────────────
        stairInt:   KIT + 'Stair_Interior_Solid.gltf',
        stairRail:  KIT + 'Stair_Interior_Rails.gltf',
        holeSt:     KIT + 'HoleCover_Straight.gltf',
        // ── Volets ────────────────────────────────────────────────
        shutWin:    KIT + 'WindowShutters_Wide_Round_Open.gltf',
        // ── Enseigne ──────────────────────────────────────────────
        banner1:    PROPS + 'Banner_1.gltf',
        wallArch:   KIT + 'Wall_Arch.gltf',
        propSupport:KIT + 'Prop_Support.gltf',
        // ── Props communs ──────────────────────────────────────────
        lantern:    PROPS + 'Lantern_Wall.gltf',
        barrel:     PROPS + 'Barrel.gltf',
        barrelH:    PROPS + 'Barrel_Holder.gltf',
        barrelA:    PROPS + 'Barrel_Apples.gltf',
        shelfArch:  PROPS + 'Shelf_Arch.gltf',
        bottles:    PROPS + 'SmallBottles_1.gltf',
        // ── Props taverne RdC ──────────────────────────────────────
        tableLg:    PROPS + 'Table_Large.gltf',
        stool:      PROPS + 'Stool.gltf',
        bench:      PROPS + 'Bench.gltf',
        chair:      PROPS + 'Chair_1.gltf',
        mug:        PROPS + 'Mug.gltf',
        cauldron:   PROPS + 'Cauldron.gltf',
        cabinet:    PROPS + 'Cabinet.gltf',
        shelfBot:   PROPS + 'Shelf_Small_Bottles.gltf',
        chandelier: PROPS + 'Chandelier.gltf',
        candle:     PROPS + 'CandleStick.gltf',
        // ── Props taverne étage ────────────────────────────────────
        bed1:       PROPS + 'Bed_Twin1.gltf',
        bed2:       PROPS + 'Bed_Twin2.gltf',
        nightstand: PROPS + 'Nightstand_Shelf.gltf',
        chest:      PROPS + 'Chest_Wood.gltf',
        bookcase:   PROPS + 'Bookcase_2.gltf',
        scrolls:    PROPS + 'Scroll_1.gltf',
        potionV:    PROPS + 'Potion_1.gltf',
        candle3:    PROPS + 'CandleStick_Triple.gltf',
        // ── Props cachot cave ──────────────────────────────────────
        cage:       PROPS + 'Cage_Small.gltf',
        chain:      PROPS + 'Chain_Coil.gltf',
        dummy:      PROPS + 'Dummy.gltf',
        weapStand:  PROPS + 'WeaponStand.gltf',
        axe:        PROPS + 'Axe_Bronze.gltf',
        pegRack:    PROPS + 'Peg_Rack.gltf',
        rope:       PROPS + 'Rope_1.gltf',
        // ── Décor extérieur ────────────────────────────────────────
        vine1:      KIT + 'Prop_Vine1.gltf',
        vine4:      KIT + 'Prop_Vine4.gltf',
        vine9:      KIT + 'Prop_Vine9.gltf',
        wagon:      KIT + 'Prop_Wagon.gltf',
        fence:      KIT + 'Prop_WoodenFence_Single.gltf',
        fenceExt:   KIT + 'Prop_WoodenFence_Extension1.gltf',
    };

    const m = {};
    let remaining = Object.keys(urls).length;
    function done() {
        if (--remaining > 0) return;
        _assembleTaverne(scene, m, tx, tz);
        _loadNature(scene, loader, ox, oz);
        console.log('[Town] Valcrest V6 — taverne assemblée ✓');
    }
    for (const [key, url] of Object.entries(urls)) {
        loader.load(url,
            gltf => { _patchGlass(gltf.scene); m[key] = gltf.scene; done(); },
            undefined,
            () => { console.warn('[Town] échec:', url); done(); }
        );
    }
}

// ══════════════════════════════════════════════════════════════════
//  PLACE CENTRALE + SOL
// ══════════════════════════════════════════════════════════════════
function _buildGround(scene, ox, oz, by) {
    // Disque d'herbe
    const grass = new THREE.Mesh(new THREE.CircleGeometry(100, 64), mGrass);
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(ox, by + 0.02, oz);
    scene.add(grass);

    // Place centrale 16×16
    const slab = new THREE.Mesh(new THREE.BoxGeometry(16, 0.08, 16), mSquare);
    slab.position.set(ox, by + 0.04, oz);
    scene.add(slab);
    addFloor(ox, oz, 16, 16, by + 0.08);

    // Joints de dalles
    for (let i = -6; i <= 6; i += 2) {
        const h = new THREE.Mesh(new THREE.BoxGeometry(16, 0.09, 0.06), mJoint);
        h.position.set(ox, by + 0.04, oz + i); scene.add(h);
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 16), mJoint);
        v.position.set(ox + i, by + 0.04, oz); scene.add(v);
    }

    // Puits
    _buildWell(scene, ox, by, oz);

    // Chemin vers la taverne (nord)
    _path(scene, ox, oz - 8, ox, oz - 28, 4);

    // 4 lampadaires coins place
    for (const [dx, dz, dir] of [[-6,-6,'E'],[6,-6,'W'],[-6,6,'E'],[6,6,'W']]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 3.6, 6), mTimber);
        post.position.set(ox + dx, by + 1.8, oz + dz); scene.add(post);
        torch(scene, ox + dx, by + 3.4, oz + dz, dir);
        light(scene, ox + dx, by + 3.9, oz + dz, 5, 12);
    }
}

function _buildWell(scene, ox, by, oz) {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.7, 14, 1, true), mStone);
    rim.position.set(ox, by + 0.35, oz); scene.add(rim);
    const base = new THREE.Mesh(new THREE.CircleGeometry(0.9, 14), mStone);
    base.rotation.x = -Math.PI / 2;
    base.position.set(ox, by, oz); scene.add(base);
    for (const dz of [-0.8, 0.8]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.6, 6), mTimber);
        p.position.set(ox, by + 1.3, oz + dz); scene.add(p);
    }
    const xb = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.7, 6), mTimber);
    xb.rotation.z = Math.PI / 2; xb.position.set(ox, by + 2.55, oz); scene.add(xb);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 5), mIron);
    rope.position.set(ox, by + 1.5, oz); scene.add(rope);
}

function _path(scene, x0, z0, x1, z1, w, segs = 6) {
    const dx = (x1 - x0) / segs, dz = (z1 - z0) / segs;
    for (let i = 0; i < segs; i++) {
        const mx = x0 + (i + 0.5) * dx, mz = z0 + (i + 0.5) * dz;
        const sy = getHeight(mx, mz);
        const angle = Math.atan2(dx, dz);
        const len = Math.sqrt(dx * dx + dz * dz);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, len + 0.05), mPath);
        seg.position.set(mx, sy + 0.03, mz); seg.rotation.y = angle;
        scene.add(seg);
    }
}

// ══════════════════════════════════════════════════════════════════
//  TAVERNE — COLLISION (synchrone)
//
//  Dimensions : 8m × 10m  (HW=4, HD=5)
//  3 niveaux   : yC = yG-WH  ·  yG (RdC)  ·  yE = yG+WH  ·  yR = yG+WH×2
// ══════════════════════════════════════════════════════════════════
function _buildTaverneColl(scene, cx, cz) {
    const fp = _fp(cx, cz, 8, 10);
    const yG = fp.buildY;
    const yC = yG - WH;
    const yE = yG + WH;
    const yR = yG + WH * 2;

    // Stocker les niveaux pour l'assemblage glTF (via closure)
    _taverneLevels = { yC, yG, yE, yR };

    _foundation(scene, cx, cz, 8, 10, fp);

    const HW = 4, HD = 5;

    // ── Sols (avec trous pour les trémies d'escalier) ────────────
    // RdC : trou NE (ramp cave→RdC couvre cx+2..cx+4, cz-4..cz-1)
    addFloor(cx,         cz + 1.5,  8,    7.0,  yG);   // moitié S
    addFloor(cx,         cz - 4.25, 8,    1.5,  yG);   // extrémité N
    addFloor(cx - 1.0,   cz - 2.5,  6,    3.0,  yG);   // milieu N sans trou NE
    addFloor(cx + 3.5,   cz - 2.5,  1.0,  3.0,  yG);   // bande E sans trou

    // Étage : trou NW (ramp RdC→étage couvre cx-4..cx-2, cz-4..cz-1)
    addFloor(cx,         cz + 1.5,  8,    7.0,  yE);
    addFloor(cx,         cz - 4.25, 8,    1.5,  yE);
    addFloor(cx + 1.0,   cz - 2.5,  6,    3.0,  yE);
    addFloor(cx - 3.5,   cz - 2.5,  1.0,  3.0,  yE);

    // Cave : sol plein
    addFloor(cx, cz, 8, 10, yC);

    // ── Plafonds ─────────────────────────────────────────────────
    // Pas de plafond RdC (= plancher étage)
    // Plafond étage = sous toiture
    addCeiling(cx, cz, 8, 10, yR);

    // ── Murs (collision) ─────────────────────────────────────────
    const th = 0.4;   // épaisseur collision mur
    // Cave → RdC et Étage → Toit : murs pleins
    for (const [y0, y1] of [[yC, yG], [yE, yR]]) {
        addWall(cx,      cz + HD, 8, th,  y0, y1);
        addWall(cx,      cz - HD, 8, th,  y0, y1);
        addWall(cx + HW, cz,      th, 10, y0, y1);
        addWall(cx - HW, cz,      th, 10, y0, y1);
    }
    // RdC → Étage : porte S (gap 2m centré à cx), murs N/E/W pleins
    addWall(cx - 2,  cz + HD, 4,  th,  yG, yE);  // S gauche
    addWall(cx + 3,  cz + HD, 2,  th,  yG, yE);  // S droite
    addWall(cx,      cz - HD, 8,  th,  yG, yE);  // N plein
    addWall(cx + HW, cz,      th, 10,  yG, yE);
    addWall(cx - HW, cz,      th, 10,  yG, yE);

    // ── Rampes d'escalier ─────────────────────────────────────────
    addRamp(cx + 3.0, cz - 2.5, 1.5, 3.5, yC, yG, 'z');  // cave → RdC  (NE)
    addRamp(cx - 3.0, cz - 2.5, 1.5, 3.5, yG, yE, 'z');  // RdC  → étage (NW)

    // ── Lumières extérieures ──────────────────────────────────────
    light(scene, cx, yG + WH * 0.65, cz + HD + 1.2, 6, 14);
    light(scene, cx + HW + 1.2, yG + WH * 0.65, cz, 4, 10);
    light(scene, cx - HW - 1.2, yG + WH * 0.65, cz, 4, 10);
    torch(scene, cx - 2.5, yG + 2.2, cz + HD + 0.12, 'S');
    torch(scene, cx + 2.5, yG + 2.2, cz + HD + 0.12, 'S');
    torch(scene, cx + HW + 0.12, yG + 2.2, cz - 2.0, 'E');
    torch(scene, cx - HW - 0.12, yG + 2.2, cz + 2.0, 'W');
    // Intérieures
    light(scene, cx, yG + WH * 0.65, cz, 4, 10);
    light(scene, cx, yE + WH * 0.65, cz, 3, 8);
    light(scene, cx, yC + WH * 0.65, cz, 3, 8);
}

// Niveaux stockés pour l'assemblage glTF
let _taverneLevels = null;

// ══════════════════════════════════════════════════════════════════
//  TAVERNE — ASSEMBLAGE glTF (asynchrone, après chargement)
// ══════════════════════════════════════════════════════════════════
function _assembleTaverne(scene, m, cx, cz) {
    const { yC, yG, yE, yR } = _taverneLevels;
    const HW = 4, HD = 5;

    // Rotations : S=face sud (+Z), N=face nord (-Z), E=face est (+X), W=face ouest (-X)
    const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;

    // Grilles de panneaux : chaque panneau fait 2m de large
    // Face S/N (8m = 4 panneaux) : cx−3, cx−1, cx+1, cx+3
    const xGrid = [cx - 3, cx - 1, cx + 1, cx + 3];
    // Face E/W (10m = 5 panneaux) : cz−4, cz−2, cz, cz+2, cz+4
    const zGrid = [cz - 4, cz - 2, cz, cz + 2, cz + 4];

    // Helpers — place une rangée de panneaux
    function rowX(keys, y, face) {
        const [ry, zf] = face === 'S' ? [S, cz + HD] : [N, cz - HD];
        xGrid.forEach((x, i) => _p(scene, m[keys[i]], x, y, zf, ry));
    }
    function rowZ(keys, y, face) {
        const [ry, xf] = face === 'E' ? [E, cx + HW] : [W, cx - HW];
        zGrid.forEach((z, i) => _p(scene, m[keys[i]], xf, y, z, ry));
    }

    // ════════════════════════════════════════════════════════════
    //  MURS — Cave, RdC, Étage
    // ════════════════════════════════════════════════════════════

    // Cave — brique partout
    rowX(Array(4).fill('wBrick'), yC, 'S');
    rowX(Array(4).fill('wBrick'), yC, 'N');
    rowZ(Array(5).fill('wBrick'), yC, 'E');
    rowZ(Array(5).fill('wBrick'), yC, 'W');

    // RdC — porte S (entrée vers place), fenêtres réparties
    //   S : [Fenêtre | Porte | Fenêtre | Brique]
    rowX(['wBrickWin', 'wBrickDoor', 'wBrickWin', 'wBrick'], yG, 'S');
    //   N : [Brique | Fenêtre | Brique | Fenêtre]
    rowX(['wBrick', 'wBrickWin', 'wBrick', 'wBrickWin'],     yG, 'N');
    //   E/W : alternance brique/fenêtre
    rowZ(['wBrick', 'wBrickWin', 'wBrick', 'wBrickWin', 'wBrick'], yG, 'E');
    rowZ(['wBrick', 'wBrickWin', 'wBrick', 'wBrickWin', 'wBrick'], yG, 'W');

    // Étage — plâtre + pans de bois
    //   S : [Grid | Fenêtre | Grid | Fenêtre]
    rowX(['wPlastGrid', 'wPlastWin', 'wPlastGrid', 'wPlastWin'], yE, 'S');
    //   N : [Fenêtre | Grid | Fenêtre | Grid]
    rowX(['wPlastWin', 'wPlastGrid', 'wPlastWin', 'wPlastGrid'], yE, 'N');
    //   E/W : [Plast | Fenêtre | Grid | Fenêtre | Plast]
    rowZ(['wPlast', 'wPlastWin', 'wPlastGrid', 'wPlastWin', 'wPlast'], yE, 'E');
    rowZ(['wPlast', 'wPlastWin', 'wPlastGrid', 'wPlastWin', 'wPlast'], yE, 'W');

    // ════════════════════════════════════════════════════════════
    //  COINS — Cave (Exterior_Brick), RdC (ExteriorWide_Brick), Étage (ExteriorWide_Wood)
    // ════════════════════════════════════════════════════════════
    for (const [x, z, ry] of [
        [cx - HW, cz + HD, S],  // SW
        [cx + HW, cz + HD, E],  // SE
        [cx - HW, cz - HD, W],  // NW
        [cx + HW, cz - HD, N],  // NE
    ]) {
        _noZFight(_p(scene, m.crnBrick,  x, yC, z, ry));
        _noZFight(_p(scene, m.crnBrickW, x, yG, z, ry));
        _noZFight(_p(scene, m.crnWoodW,  x, yE, z, ry));
    }

    // (overhangs supprimés — créaient une saillie plate visible de côté)

    // ════════════════════════════════════════════════════════════
    //  BALCON SUD — face S, pleine largeur, niveau étage
    // ════════════════════════════════════════════════════════════
    for (const x of xGrid)
        _noZFight(_p(scene, m.balcStr, x, yE, cz + HD, S));

    // ════════════════════════════════════════════════════════════
    //  VOLETS — fenêtres RdC (WindowShutters_Wide_Round_Open)
    // ════════════════════════════════════════════════════════════
    // S (fenêtres à cx−3 et cx+1)
    _noZFight(_p(scene, m.shutWin, cx - 3, yG, cz + HD, S));
    _noZFight(_p(scene, m.shutWin, cx + 1, yG, cz + HD, S));
    // N (fenêtres à cx−1 et cx+3)
    _noZFight(_p(scene, m.shutWin, cx - 1, yG, cz - HD, N));
    _noZFight(_p(scene, m.shutWin, cx + 3, yG, cz - HD, N));
    // E (fenêtres à cz−2 et cz+2)
    _noZFight(_p(scene, m.shutWin, cx + HW, yG, cz - 2, E));
    _noZFight(_p(scene, m.shutWin, cx + HW, yG, cz + 2, E));
    // W
    _noZFight(_p(scene, m.shutWin, cx - HW, yG, cz - 2, W));
    _noZFight(_p(scene, m.shutWin, cx - HW, yG, cz + 2, W));

    // ════════════════════════════════════════════════════════════
    //  SOLS (dalles glTF 2×2m — 4×5=20 dalles par niveau)
    // ════════════════════════════════════════════════════════════
    for (const x of xGrid) for (const z of zGrid) {
        _p(scene, m.flRed,   x, yC, z);
        _p(scene, m.flBrick, x, yG, z);
        _p(scene, m.flWood,  x, yE, z);
    }

    // ════════════════════════════════════════════════════════════
    //  TOITURE — Roof_RoundTiles_8x10 + lucarnes + 2 cheminées
    // ════════════════════════════════════════════════════════════
    _tintRoof(_p(scene, m.roof, cx, yR, cz, 0));
    // Pignons — ferment le toit côté N et S (indispensable !)
    _tintRoof(_noZFight(_p(scene, m.roofFront, cx, yR, cz + HD, S)));
    _tintRoof(_noZFight(_p(scene, m.roofFront, cx, yR, cz - HD, N)));
    // Lucarnes face S
    _p(scene, m.roofDormer, cx - 1.5, yR + 0.35, cz + HD * 0.4, S);
    _p(scene, m.roofDormer, cx + 1.5, yR + 0.35, cz + HD * 0.4, S);
    // Cheminées — au sol, le modèle monte jusqu'au sommet du toit
    _p(scene, m.chimney,  cx - 3.2, yG, cz + 4.2);   // SW cuisine
    _p(scene, m.chimney2, cx + 3.2, yG, cz - 4.2);   // NE chambre

    // ════════════════════════════════════════════════════════════
    //  ESCALIERS INTÉRIEURS + TRÉMIES
    // ════════════════════════════════════════════════════════════
    // Escalier cave → RdC (NE, cx+3, cz−2.5)
    _p(scene, m.stairInt,  cx + 3.0, yC, cz - 2.5, 0, 1, 1, 0.74);
    _noZFight(_p(scene, m.stairRail, cx + 3.0, yC, cz - 2.5, 0, 1, 1, 0.74));
    _noZFight(_p(scene, m.holeSt, cx + 3.0, yG, cz - 1.0, N));

    // Escalier RdC → étage (NW, cx−3, cz−2.5)
    _p(scene, m.stairInt,  cx - 3.0, yG, cz - 2.5, 0, 1, 1, 0.74);
    _noZFight(_p(scene, m.stairRail, cx - 3.0, yG, cz - 2.5, 0, 1, 1, 0.74));
    _noZFight(_p(scene, m.holeSt, cx - 3.0, yE, cz - 1.0, N));

    // ════════════════════════════════════════════════════════════
    //  ENSEIGNE — entrée S (arc + supports + bannière)
    // ════════════════════════════════════════════════════════════
    _p(scene, m.wallArch,    cx, yG, cz + HD + 0.05, S);
    _p(scene, m.propSupport, cx - 0.8, yG + WH * 0.6, cz + HD + 0.04, S);
    _p(scene, m.propSupport, cx + 0.8, yG + WH * 0.6, cz + HD + 0.04, S);
    _p(scene, m.banner1,     cx - 1.5, yG + WH * 0.55, cz + HD + 0.05, S);
    _p(scene, m.banner1,     cx + 1.5, yG + WH * 0.55, cz + HD + 0.05, S);

    // ════════════════════════════════════════════════════════════
    //  VIGNES — façades S et W
    // ════════════════════════════════════════════════════════════
    _p(scene, m.vine1, cx - 3.5, yG, cz + HD, S);
    _p(scene, m.vine4, cx + 3.5, yG, cz + HD, S);
    _p(scene, m.vine9, cx - HW,  yG, cz + 2,  W);

    // ════════════════════════════════════════════════════════════
    //  CAVE — cave à vin + cachot
    // ════════════════════════════════════════════════════════════
    // Cave à vin (côté E)
    for (let i = 0; i < 3; i++) {
        _p(scene, m.barrel,    cx + 3.5, yC, cz - 3.5 + i * 2.0);
        _p(scene, m.barrel,    cx + 2.8, yC, cz - 3.5 + i * 2.0);
    }
    _p(scene, m.barrelA, cx + 0.5, yC, cz + 4.5);
    _p(scene, m.barrelH, cx - 0.5, yC, cz + 2.5);
    for (let row = 0; row < 3; row++) {
        _p(scene, m.shelfArch, cx + 3.8, yC + 0.55 + row * 0.85, cz + 0.0, W);
        _p(scene, m.bottles,   cx + 3.6, yC + 0.65 + row * 0.85, cz + 0.0, W);
    }
    _p(scene, m.lantern, cx - 3.8, yC + 1.6, cz,      E);
    _p(scene, m.lantern, cx + 3.8, yC + 1.6, cz - 2,  W);
    torch(scene, cx + 3.5, yC + 1.8, cz + 3.5, 'W');

    // Cachot (NW cave)
    _p(scene, m.cage,     cx - 3.0, yC + 1.9, cz - 4.0);
    _p(scene, m.chain,    cx - 3.3, yC + 0.02, cz - 4.5, Math.PI * 0.35);
    _p(scene, m.dummy,    cx - 1.5, yC,         cz - 4.5, Math.PI * 0.15);
    _p(scene, m.weapStand,cx - 2.5, yC,         cz - 4.8);
    _p(scene, m.axe,      cx - 2.5, yC + 0.5,  cz - 4.6, E);
    _p(scene, m.pegRack,  cx - 1.0, yC + 1.2,  cz - 5.0, S);
    _p(scene, m.rope,     cx - 1.5, yC + 0.1,  cz - 4.8);
    torch(scene, cx - 3.5, yC + 1.6, cz - 3.5, 'E');
    light(scene, cx - 2.5, yC + WH * 0.55, cz - 4.0, 1.8, 6);

    // ════════════════════════════════════════════════════════════
    //  REZ-DE-CHAUSSÉE — grande salle de bar
    // ════════════════════════════════════════════════════════════
    // Comptoir et tables (côté S)
    _p(scene, m.tableLg, cx - 2.8, yG, cz + 4.2);
    _p(scene, m.tableLg, cx - 1.0, yG, cz + 4.2);
    _p(scene, m.tableLg, cx + 0.8, yG, cz + 4.2);
    for (let i = -3; i <= 2; i++)
        _p(scene, m.stool, cx + i * 0.95 + 0.4, yG, cz + 3.2);

    _p(scene, m.cabinet,  cx - 3.5, yG, cz + 4.8, S);
    _p(scene, m.cabinet,  cx - 1.8, yG, cz + 4.8, S);
    _p(scene, m.shelfBot, cx + 0.2, yG, cz + 4.9, S);
    _p(scene, m.shelfBot, cx + 1.8, yG, cz + 4.9, S);

    // Table centrale
    _p(scene, m.tableLg, cx - 1.5, yG, cz + 0.5);
    _p(scene, m.bench,   cx - 1.5, yG, cz + 1.8);
    _p(scene, m.bench,   cx - 1.5, yG, cz - 0.8, N);
    _p(scene, m.mug,     cx - 1.5, yG + 0.76, cz + 0.5);

    _p(scene, m.tableLg, cx + 2.0, yG, cz + 0.5);
    _p(scene, m.chair,   cx + 2.8, yG, cz + 0.5, W);
    _p(scene, m.chair,   cx + 1.2, yG, cz + 0.5, E);

    // Cuisine (SE)
    _p(scene, m.cauldron, cx + 3.2, yG, cz + 4.0);
    torch(scene, cx + 3.5, yG + 1.8, cz + 4.8, 'E');

    // Chandelier
    _p(scene, m.chandelier, cx, yG + WH - 0.5, cz);

    // ════════════════════════════════════════════════════════════
    //  ÉTAGE — chambres
    // ════════════════════════════════════════════════════════════
    // Chambre N (grande)
    _p(scene, m.bed1,       cx - 2.5, yE, cz - 3.8, E);
    _p(scene, m.bed2,       cx + 1.5, yE, cz - 3.8, W);
    _p(scene, m.nightstand, cx - 0.8, yE, cz - 4.5);
    _p(scene, m.chest,      cx + 3.2, yE, cz - 4.5, N);
    _p(scene, m.scrolls,    cx + 3.2, yE + 0.5, cz - 4.0);
    _p(scene, m.potionV,    cx + 3.2, yE + 0.5, cz - 4.3);

    // Chambre S (petite)
    _p(scene, m.bed1,     cx - 2.5, yE, cz + 3.5, E);
    _p(scene, m.candle,   cx - 2.5, yE + 0.76, cz + 2.0);

    // Salle de lecture
    _p(scene, m.bookcase, cx + 3.2, yE, cz + 1.0, W);
    _p(scene, m.candle3,  cx,       yE, cz - 0.5);

    // ════════════════════════════════════════════════════════════
    //  DÉCOR EXTÉRIEUR
    // ════════════════════════════════════════════════════════════
    // Chariot côté E
    _p(scene, m.wagon,    cx + HW + 2.5, yG, cz + 2.0, W);
    // Clôture E
    _p(scene, m.fence,    cx + HW + 1.5, yG, cz + 1.0, E);
    _p(scene, m.fenceExt, cx + HW + 1.5, yG, cz + 2.5, E);
    _p(scene, m.fenceExt, cx + HW + 1.5, yG, cz + 4.0, E);

    // Tonneaux devant entrée
    _p(scene, m.barrel, cx - 3.5, yG, cz + HD + 1.2);
    _p(scene, m.barrelA, cx + 3.5, yG, cz + HD + 1.2);

    // Trappe cave (interaction F depuis game.js)
    const fTrap = _fp(cx, cz, 8, 10);
    _trapdoors.push(
        { x: cx, y: fTrap.buildY, z: cz + HD + 0.9, label: 'ext' },
        { x: cx, y: fTrap.buildY - WH, z: cz + HD - 1.2, label: 'cave' }
    );
}

// ══════════════════════════════════════════════════════════════════
//  PALISSADE
// ══════════════════════════════════════════════════════════════════
function _buildPalisade(scene, ox, oz) {
    const R = 58, COUNT = 72;
    const GAPS = [0, Math.PI / 2, Math.PI, Math.PI * 1.5]; // N, E, S, W

    for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2;
        const inGap = GAPS.some(g => {
            const d = Math.abs(((a - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            return d < 0.12;
        });
        if (inGap) continue;

        const wx = ox + Math.cos(a) * R;
        const wz = oz + Math.sin(a) * R;
        const wy = getHeight(wx, wz);

        const pale = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 3.4, 5), mPale);
        pale.position.set(wx, wy + 1.7, wz);
        scene.add(pale);
        addWall(wx, wz, 0.26, 0.26, wy, wy + 3.4);

        // Barres horizontales entre pieux
        if (i > 0) {
            const pa = ((i - 1) / COUNT) * Math.PI * 2;
            const px = ox + Math.cos(pa) * R, pz = oz + Math.sin(pa) * R;
            const py = getHeight(px, pz);
            for (const hf of [0.28, 0.62]) {
                const bx = (wx + px) * 0.5, bz = (wz + pz) * 0.5;
                const by2 = (wy + py) * 0.5 + 3.4 * hf;
                const len = Math.hypot(wx - px, wz - pz);
                const ang = Math.atan2(wx - px, wz - pz);
                const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), mPale);
                bar.rotation.y = ang; bar.position.set(bx, by2, bz);
                scene.add(bar);
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════
//  NATURE — Arbres et buissons
// ══════════════════════════════════════════════════════════════════
function _loadNature(scene, loader, ox, oz) {
    const TREES  = ['BirchTree_1','BirchTree_2','BirchTree_3','BirchTree_4','BirchTree_5'];
    const MAPLES = ['MapleTree_1','MapleTree_2','MapleTree_3','MapleTree_4','MapleTree_5'];
    const BUSHES = ['Bush','Bush_Large','Bush_Small','Bush_Flowers','Bush_Large_Flowers'];

    const rng = _rng(137);
    const pts = [];

    // Arbres hors palissade
    for (let i = 0; i < 70; i++) {
        const a = rng() * Math.PI * 2, r = 65 + rng() * 130;
        const x = ox + Math.cos(a) * r, z = oz + Math.sin(a) * r;
        if (getTerrainSlope(x, z) > 0.32) continue;
        const isM = rng() < 0.35;
        const name = (isM ? MAPLES : TREES)[Math.floor(rng() * 5)];
        pts.push({ x, z, name, ry: rng() * Math.PI * 2, s: 0.85 + rng() * 0.45 });
    }
    // Buissons à l'intérieur
    for (let i = 0; i < 35; i++) {
        const a = rng() * Math.PI * 2, r = 22 + rng() * 28;
        const x = ox + Math.cos(a) * r, z = oz + Math.sin(a) * r;
        if (Math.hypot(x - ox, z - oz) < 12) continue;
        const name = BUSHES[Math.floor(rng() * BUSHES.length)];
        pts.push({ x, z, name, ry: rng() * Math.PI * 2, s: 0.7 + rng() * 0.6 });
    }

    const unique = [...new Set(pts.map(p => p.name))];
    const tmpl = {}; let done = 0;
    for (const name of unique) {
        loader.load(NATURE + name + '.gltf', gltf => {
            _patchGlass(gltf.scene);
            tmpl[name] = gltf.scene;
            if (++done < unique.length) return;
            for (const p of pts) {
                const t = tmpl[p.name]; if (!t) continue;
                if (getTerrainSlope(p.x, p.z) > 0.38) continue;
                const obj = t.clone(true);
                obj.position.set(p.x, getHeight(p.x, p.z), p.z);
                obj.rotation.y = p.ry; obj.scale.setScalar(p.s);
                scene.add(obj);
            }
        }, undefined, () => { if (++done >= unique.length) {} });
    }
}

// ══════════════════════════════════════════════════════════════════
//  NPCs — 4 personnages
// ══════════════════════════════════════════════════════════════════
function _spawnNPCs(scene, ox, oz, tx, tz) {
    const by = getHeight(ox, oz);
    const configs = [
        { x: tx,      z: tz + 3,  r: 4  },   // Aubergiste près de l'entrée
        { x: tx + 2,  z: tz - 8,  r: 3  },   // Serveur intérieur
        { x: ox + 8,  z: oz + 5,  r: 15 },   // Villageois place
        { x: ox - 6,  z: oz + 3,  r: 12 },   // Villageois 2
    ];
    for (const cfg of configs) {
        const npc = new NPC(
            scene,
            OUTFITS + 'Male_Ranger.gltf',
            NPC_ANIMS, NPC_CLIPS,
            [cfg.x, getHeight(cfg.x, cfg.z), cfg.z],
            { wanderRadius: cfg.r }
        );
        _npcs.push(npc);
    }
    console.log(`[Town] ${_npcs.length} NPC(s) ✓`);
}
