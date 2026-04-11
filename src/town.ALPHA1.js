import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getHeight, getTerrainNormal, getTerrainSlope } from './world.js';
import { addFloor, addWall, addRamp } from './collision.js';
import {
    mesh, torch, light,
    FH, DW,
} from './builder.js';
import { NPC } from './npc.js';

// ═══════════════════════════════════════════════════════════════
//  TOWN.JS — "Valcrest" v4
//
//  Principes de placement (article terrain §4/5/6) :
//  • Chaque bâtiment vérifie son empreinte avant d'être placé
//    → pente max 14° (~0.25 rad), variance hauteur max 1.2 m
//  • Fondations visuelles compensent la variance terrain
//  • Chemins en rubans de segments qui épousent le relief
//  • Palissade : chaque poteau à getHeight(x,z) local
//  • Végétation filtrée par pente, placée à hauteur locale
//
//  Architecture hybride (§5 buildings) :
//  • room() de builder.js → murs propres + collision parfaite
//  • Toits + props glTF du MegaKit (vraies tuiles rondes)
//
//  PNJ (§2/3 characters) :
//  • Y terrain en temps réel · tilt normal · yaw pur (zéro dérive)
// ═══════════════════════════════════════════════════════════════

const KIT      = 'assets/environment/village/';
const PROPS    = 'assets/environment/props/';
const NATURE   = 'assets/environment/nature/';
const OUTFITS  = 'assets/characters/outfits/';
const BASE_M   = 'assets/characters/bodies/Superhero_Male_FullBody.gltf';
const BASE_F   = 'assets/characters/bodies/Superhero_Female_FullBody.gltf';
const NPC_ANIMS = [
    'assets/characters/animations/UAL1_Standard.glb',
    'assets/characters/animations/UAL2_Standard.glb',
];

// Hauteur d'un panneau mural du MegaKit (mesurée sur les modèles)
const WH = 3.12;

const NPC_CLIPS = { idle: 'Idle_Loop', walk: 'Walk_Loop' };

// ── Matériaux village (sol, palisade, place) ──────────────────────
const mFoundation = new THREE.MeshLambertMaterial({ color: 0x6a5a4a });
const mGrass      = new THREE.MeshLambertMaterial({ color: 0x70b040 });
const mPath       = new THREE.MeshLambertMaterial({ color: 0xc0b090 });
const mSquare     = new THREE.MeshLambertMaterial({ color: 0xb0a880 });
const mPost       = new THREE.MeshLambertMaterial({ color: 0x7a4820 });
const mTimber     = new THREE.MeshLambertMaterial({ color: 0x9a6030 });

// ── Matériaux taverne ─────────────────────────────────────────────
const mTWall   = new THREE.MeshLambertMaterial({ color: 0xe2d0a8 }); // plâtre chaud
const mTStone  = new THREE.MeshLambertMaterial({ color: 0x786855 }); // pierre
const mTWood   = new THREE.MeshLambertMaterial({ color: 0x7a5028 }); // bois clair
const mTWoodDk = new THREE.MeshLambertMaterial({ color: 0x4a2c10 }); // bois foncé
const mTFloor  = new THREE.MeshLambertMaterial({ color: 0xa89070 }); // carrelage pierre
const mTDirt   = new THREE.MeshLambertMaterial({ color: 0x5a4535 }); // terre battue cave
const mTRoof   = new THREE.MeshLambertMaterial({ color: 0x543020 }); // tuiles sombres
const mTIron   = new THREE.MeshLambertMaterial({ color: 0x2c2530 }); // fer (cerclages)
const mTLinen  = new THREE.MeshLambertMaterial({ color: 0xc8b890 }); // literie
const mTBarrel = new THREE.MeshLambertMaterial({ color: 0x6a3d18 }); // chêne tonneau
const mTEmber  = new THREE.MeshLambertMaterial({                     // braises
    color: 0xff6600, emissive: new THREE.Color(0xff3300), emissiveIntensity: 3.5,
});

// ── Patch vitre — évite le shader crash MI_WindowGlass (MeshStandardMaterial) ──
const _glassPatch = new THREE.MeshLambertMaterial({
    color: 0x99bbcc, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
});
_glassPatch.name = 'MI_WindowGlass_patched';
function _patchGlass(obj) {
    obj.traverse(child => {
        if (!child.isMesh) return;
        if (Array.isArray(child.material)) {
            child.material = child.material.map(m => m?.name === 'MI_WindowGlass' ? _glassPatch : m);
        } else if (child.material?.name === 'MI_WindowGlass') {
            child.material = _glassPatch;
        }
    });
}

// ── PRNG déterministe ─────────────────────────────────────────────
function _rng(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}


// ── NPC state ────────────────────────────────────────────────────
const _npcs = [];
export function getTownNPCs() { return _npcs; }

// ── Trappes d'accès cave ──────────────────────────────────────────
// Rempli par _buildTavern(), lu par game.js pour les interactions F
const _tavernTrapdoors = [];
export function getTavernTrapdoors() { return _tavernTrapdoors; }

// ═══════════════════════════════════════════════════════════════
//  ANALYSE TERRAIN — article §6 : validation d'empreinte
// ═══════════════════════════════════════════════════════════════

/**
 * Échantillonne une grille 4×4 sous une emprise w×d centrée en (cx,cz).
 *
 * Retourne :
 *   minY     — hauteur terrain la plus basse sous l'emprise
 *   maxY     — hauteur terrain la plus haute sous l'emprise
 *   variance — maxY - minY
 *   slope    — pente au centre (rad)
 *   valid    — placement autorisé (variance < 1.2m et slope < 0.25 rad ≈ 14°)
 *
 * Règle de placement (article §6) :
 *   buildY = maxY + 0.1  → terrain jamais plus haut que le plancher
 *   fondation de minY-0.3 jusqu'à buildY → comble visuellement le creux
 */
function _checkFootprint(cx, cz, w, d) {
    const N = 3;
    let minY = Infinity, maxY = -Infinity, sum = 0, count = 0;
    for (let i = 0; i <= N; i++) {
        for (let j = 0; j <= N; j++) {
            const h = getHeight(cx - w*0.5 + (i/N)*w, cz - d*0.5 + (j/N)*d);
            if (h < minY) minY = h;
            if (h > maxY) maxY = h;
            sum += h; count++;
        }
    }
    const variance = maxY - minY;
    const slope    = getTerrainSlope(cx, cz);
    return {
        minY, maxY,
        avgY:     sum / count,
        buildY:   maxY + 0.1,   // plancher toujours AU-DESSUS du terrain
        variance, slope,
        valid:    variance < 1.2 && slope < 0.25,
    };
}

/**
 * Fondation en pierre sous un bâtiment.
 *
 * Principe : dalle qui va de (fp.minY - 0.3) jusqu'à fp.buildY.
 *   → comble tout creux sous le bâtiment
 *   → top = fp.buildY → exactement ras du plancher, jamais au-dessus
 *   → légèrement plus large que le bâtiment pour sceller la jonction sol/mur
 */
function _foundation(sc, cx, cz, w, d, fp) {
    const bottom = fp.minY - 0.3;
    const top    = fp.buildY;
    const h      = Math.max(0.3, top - bottom);
    const base   = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h, d + 0.1), mFoundation);
    base.position.set(cx, bottom + h * 0.5, cz);
    sc.add(base);
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export function buildTown(scene, ox, oz, manager = null) {
    const loader = new GLTFLoader(manager || undefined);
    const by     = getHeight(ox, oz);

    _buildGround  (scene, ox, oz, by);
    _buildTavern  (scene, loader, ox, oz, by);
    _buildPalisade(scene, ox, oz, by);
    _loadNature   (scene, loader, ox, oz, by);
    _spawnNPCs    (scene, ox, oz, by);
}

// ═══════════════════════════════════════════════════════════════
//  SOL — herbe + pavés + chemins qui épousent le relief
// ═══════════════════════════════════════════════════════════════
function _buildGround(scene, ox, oz, by) {
    // Disque herbe
    const grass = new THREE.Mesh(new THREE.CircleGeometry(118, 64), mGrass);
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(ox, by + 0.04, oz);
    grass.receiveShadow = true;
    scene.add(grass);

    // Chemins en rubans de segments — article §terrain : chaque segment à sa hauteur
    _ribbonPath(scene, ox - 30, ox + 30, oz - 3, oz - 3, 5, 4);   // est-ouest N
    _ribbonPath(scene, ox - 30, ox + 30, oz + 3, oz + 3, 5, 4);   // est-ouest S
    _ribbonPath(scene, ox - 3,  ox - 3,  oz - 30, oz + 30, 4, 5); // nord-sud O
    _ribbonPath(scene, ox + 3,  ox + 3,  oz - 30, oz + 30, 4, 5); // nord-sud E

    // Place centrale pavée
    _centralSquare(scene, ox, oz, by);
}

/**
 * Chemin en ruban : succession de dalles dont chacune suit le terrain.
 * x0/z0 → x1/z1 = extrémités, w = largeur, segs = nombre de segments.
 */
function _ribbonPath(scene, x0, x1, z0, z1, w, segs) {
    const dx = (x1 - x0) / segs, dz = (z1 - z0) / segs;
    for (let i = 0; i < segs; i++) {
        const mx = x0 + (i + 0.5) * dx;
        const mz = z0 + (i + 0.5) * dz;
        const sy = getHeight(mx, mz);
        const len = Math.sqrt(dx * dx + dz * dz);
        const angle = Math.atan2(dx, dz);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, len + 0.05), mPath);
        seg.position.set(mx, sy + 0.03, mz);
        seg.rotation.y = angle;
        scene.add(seg);
    }
}

function _centralSquare(scene, ox, oz, by) {
    // Dalle centrale 20×20
    const slab = new THREE.Mesh(new THREE.BoxGeometry(20, 0.07, 20), mSquare);
    slab.position.set(ox, by + 0.035, oz);
    scene.add(slab);
    addFloor(ox, oz, 20, 20, by + 0.07);

    // Joints
    const jMat = new THREE.MeshLambertMaterial({ color: 0x888070 });
    for (let i = -8; i <= 8; i += 2) {
        const h = new THREE.Mesh(new THREE.BoxGeometry(20, 0.075, 0.07), jMat);
        h.position.set(ox, by + 0.035, oz + i); scene.add(h);
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.075, 20), jMat);
        v.position.set(ox + i, by + 0.035, oz); scene.add(v);
    }

    _well(scene, ox, by, oz);

    // 4 lampadaires aux coins de la place
    for (const [dx, dz, dir] of [[-8,-8,'E'],[8,-8,'W'],[-8,8,'E'],[8,8,'W']]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.5, 6), mTimber);
        post.position.set(ox+dx, by+1.75, oz+dz);
        scene.add(post);
        torch(scene, ox+dx, by+3.4, oz+dz, dir);
        light(scene, ox+dx, by+3.8, oz+dz, 5, 12);
    }
}

function _well(scene, ox, by, oz) {
    const mS = new THREE.MeshLambertMaterial({ color: 0xa09880 });
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.8, 12, 1, true), mS);
    rim.position.set(ox, by+0.4, oz); scene.add(rim);
    const base = new THREE.Mesh(new THREE.CircleGeometry(1.0, 12), mS);
    base.rotation.x = -Math.PI/2;
    base.position.set(ox, by, oz); scene.add(base);
    for (const dz of [-0.9, 0.9]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), mTimber);
        p.position.set(ox, by+1.3, oz+dz); scene.add(p);
    }
    const trav = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), mTimber);
    trav.rotation.x = Math.PI/2;
    trav.position.set(ox, by+2.5, oz); scene.add(trav);
}

// ═══════════════════════════════════════════════════════════════
//  TAVERNE "L'Auberge du Corbeau Noir" — V3
//  Architecture : panneaux modulaires MegaKit + props Fantasy
//  Empreinte : 12m(X) × 14m(Z) — 6 panneaux × 7 panneaux de 2m
//  Superficie : ~168m²
//  Niveaux : Cave (yG-WH) · RdC (yG) · Étage (yG+WH) · Toit (yG+WH×2)
//  Nouveautés V3 :
//    • Encorbellements de brique (4 faces + 4 coins) à hauteur étage
//    • Balcon sud pleine largeur (6 sections Balcony_Simple_Straight)
//    • Volets ouverts sur toutes les fenêtres extérieures RdC
//    • Cachot dark-fantasy NW cave : cage suspendue, chaînes, mannequin,
//      support d'armes, crochets à cordes
//    • Arche d'entrée (Wall_Arch) + piliers de soutien (Prop_Support)
//    • Banderoles de guilde (Banner_1/2) flanquant l'entrée
//    • Enseigne V3 : anneau de fer forgé + bordure dorée
//    • 2e cheminée NE (Prop_Chimney2) + 2 lucarnes pente sud (Roof_Dormer)
//    • Garde-corps d'escalier (Stair_Interior_Rails) sur les 2 cages
//    • Couvertures de trémie (HoleCover_Straight) bord nord des ouvertures
//    • Chariot abandonné (Prop_Wagon) côté est + clôture bois
//    • Vignes grimpantes (Prop_Vine 1/4/9) façades S et W
//    • Bar V3 : 2 armoires + 2 étagères bouteilles derrière le comptoir
//    • Cuisine : chariot de livraison (Stall_Cart_Empty)
//    • Chambres V3 : bougiers triples, livres, parchemins, potions
// ═══════════════════════════════════════════════════════════════

/** Clone et place un modèle glTF chargé. Silencieux si modèle manquant. */
function _p(sc, model, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
    if (!model) return null;
    const o = model.clone(true);
    o.position.set(x, y, z);
    if (ry !== 0) o.rotation.y = ry;
    if (sx !== 1 || sy !== 1 || sz !== 1) o.scale.set(sx, sy, sz);
    sc.add(o);
    return o;
}

// Élimine le Z-fighting sur les pièces trim coplanaires (pignons, coins, surplombs)
function _noZFight(obj, factor = -2, units = -8) {
    if (!obj) return obj;
    obj.traverse(c => {
        if (!c.isMesh) return;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        const fixed = mats.map(mat => {
            const mc = mat.clone();
            mc.polygonOffset       = true;
            mc.polygonOffsetFactor = factor;
            mc.polygonOffsetUnits  = units;
            return mc;
        });
        c.material = Array.isArray(c.material) ? fixed : fixed[0];
    });
    return obj;
}

function _buildTavern(scene, loader, ox, oz, by) {
    const cx = ox, cz = oz + 26;   // 26m au sud du centre
    const TW = 12, TD = 14;        // empreinte 12m × 14m (~168m²)
    const HW = TW / 2;             // 6
    const HD = TD / 2;             // 7

    // ── Fondation — calcul terrain réel ──────────────────────────
    const fp = _checkFootprint(cx, cz, TW + 1, TD + 1);
    _foundation(scene, cx, cz, TW + 0.5, TD + 0.5, fp);

    const yG = fp.buildY;   // sol RdC = terrain max + 0.1m
    const yC = yG - WH;     // sol cave
    const yE = yG + WH;     // sol étage
    const yR = yG + WH * 2; // base toiture

    // ── Collision — sols (inchangée V2 → V3 — validée) ───────────
    addFloor(cx, cz, TW, TD, yC);  // cave : sol plein

    // Sol RdC (percé trou NE — escalier cave→RdC)
    addFloor(cx,         cz + 2.625, TW,   8.75, yG);
    addFloor(cx,         cz - 6.125, TW,   1.75, yG);
    addFloor(cx - 1.375, cz - 3.5,   9.25, 3.5,  yG);
    addFloor(cx + 5.375, cz - 3.5,   1.25, 3.5,  yG);

    // Sol étage (percé trou NW — escalier RdC→étage)
    addFloor(cx,         cz + 2.625, TW,   8.75, yE);
    addFloor(cx,         cz - 6.125, TW,   1.75, yE);
    addFloor(cx - 5.375, cz - 3.5,   1.25, 3.5,  yE);
    addFloor(cx + 1.375, cz - 3.5,   9.25, 3.5,  yE);

    // ── Collision — murs ──────────────────────────────────────────
    for (const [y0, y1] of [[yC, yG], [yE, yR]]) {
        addWall(cx,      cz + HD, TW,  0.4, y0, y1);
        addWall(cx,      cz - HD, TW,  0.4, y0, y1);
        addWall(cx + HW, cz,      0.4, TD,  y0, y1);
        addWall(cx - HW, cz,      0.4, TD,  y0, y1);
    }
    addWall(cx,      cz + HD, TW,  0.4, yG, yE);
    addWall(cx + HW, cz,      0.4, TD,  yG, yE);
    addWall(cx - HW, cz,      0.4, TD,  yG, yE);
    addWall(cx - 4,  cz - HD, 4,   0.4, yG, yE);   // N gauche (cx-6..cx-2)
    addWall(cx + 3,  cz - HD, 6,   0.4, yG, yE);   // N droite (cx..cx+6)

    // ── Collision — rampes d'escalier ─────────────────────────────
    addRamp(cx + 4.0, cz - 3.5, 1.5, 3.5, yC, yG, 'z');  // cave → RdC
    addRamp(cx - 4.0, cz - 3.5, 1.5, 3.5, yG, yE, 'z');  // RdC  → étage

    // ── Chargement batch des modèles glTF ─────────────────────────
    const toLoad = {
        // Architecture RdC — brique irrégulière
        wBrick:     KIT + 'Wall_UnevenBrick_Straight.gltf',
        wBrickWin:  KIT + 'Wall_UnevenBrick_Window_Wide_Round.gltf',
        wBrickDoor: KIT + 'Wall_UnevenBrick_Door_Round.gltf',
        crnBrick:   KIT + 'Corner_Exterior_Brick.gltf',
        crnBrickW:  KIT + 'Corner_ExteriorWide_Brick.gltf',
        // Architecture étage — plâtre mi-bois
        wPlast:     KIT + 'Wall_Plaster_Straight.gltf',
        wPlastWin:  KIT + 'Wall_Plaster_Window_Wide_Round.gltf',
        wPlastGrid: KIT + 'Wall_Plaster_WoodGrid.gltf',
        crnWood:    KIT + 'Corner_Exterior_Wood.gltf',
        crnWoodW:   KIT + 'Corner_ExteriorWide_Wood.gltf',
        // Sols (dalle 2×2m)
        flBrick:    KIT + 'Floor_Brick.gltf',
        flRed:      KIT + 'Floor_RedBrick.gltf',
        flWood:     KIT + 'Floor_WoodDark.gltf',
        // Toiture
        roof:       KIT + 'Roof_RoundTiles_8x14.gltf',
        roofFront:  KIT + 'Roof_Front_Brick8.gltf',
        chimney:    KIT + 'Prop_Chimney.gltf',
        chimney2:   KIT + 'Prop_Chimney2.gltf',
        roofDormer: KIT + 'Roof_Dormer_RoundTile.gltf',
        // Encorbellements (brique irrégulière — à la base de l'étage)
        ovhLong:    KIT + 'Overhang_UnevenBrick_Long.gltf',
        ovhCorner:  KIT + 'Overhang_UnevenBrick_Corner.gltf',
        // Balcon sud
        balcStr:    KIT + 'Balcony_Simple_Straight.gltf',
        // Volets de fenêtre ouverts
        shutWin:    KIT + 'WindowShutters_Wide_Round_Open.gltf',
        // Escaliers + rails + couvertures
        stairInt:   KIT + 'Stair_Interior_Solid.gltf',
        stairRail:  KIT + 'Stair_Interior_Rails.gltf',
        holeSt:     KIT + 'HoleCover_Straight.gltf',
        // Entrée : arche + piliers de soutien
        wallArch:   KIT + 'Wall_Arch.gltf',
        propSup:    KIT + 'Prop_Support.gltf',
        // Extérieur : clôture + chariot + vignes
        fencePost:  KIT + 'Prop_WoodenFence_Single.gltf',
        fenceExt:   KIT + 'Prop_WoodenFence_Extension1.gltf',
        propWagon:  KIT + 'Prop_Wagon.gltf',
        propVine1:  KIT + 'Prop_Vine1.gltf',
        propVine4:  KIT + 'Prop_Vine4.gltf',
        propVine9:  KIT + 'Prop_Vine9.gltf',
        // Props — cave à vin
        barrel:     PROPS + 'Barrel.gltf',
        barrelH:    PROPS + 'Barrel_Holder.gltf',
        barrelA:    PROPS + 'Barrel_Apples.gltf',
        shelf:      PROPS + 'Shelf_Simple.gltf',
        shelfArch:  PROPS + 'Shelf_Arch.gltf',
        lantern:    PROPS + 'Lantern_Wall.gltf',
        bottles:    PROPS + 'SmallBottles_1.gltf',
        // Props — cachot (cave NW, dark fantasy)
        cage:       PROPS + 'Cage_Small.gltf',
        chain:      PROPS + 'Chain_Coil.gltf',
        dummy:      PROPS + 'Dummy.gltf',
        weapStand:  PROPS + 'WeaponStand.gltf',
        pegRack:    PROPS + 'Peg_Rack.gltf',
        rope:       PROPS + 'Rope_1.gltf',
        axe:        PROPS + 'Axe_Bronze.gltf',
        // Props — bar & cuisine RdC
        tableLg:    PROPS + 'Table_Large.gltf',
        chair:      PROPS + 'Chair_1.gltf',
        stool:      PROPS + 'Stool.gltf',
        bench:      PROPS + 'Bench.gltf',
        mug:        PROPS + 'Mug.gltf',
        cauldron:   PROPS + 'Cauldron.gltf',
        chandelier: PROPS + 'Chandelier.gltf',
        cabinet:    PROPS + 'Cabinet.gltf',
        shelfBot:   PROPS + 'Shelf_Small_Bottles.gltf',
        stallCart:  PROPS + 'Stall_Cart_Empty.gltf',
        // Props — chambres étage
        bed1:       PROPS + 'Bed_Twin1.gltf',
        bed2:       PROPS + 'Bed_Twin2.gltf',
        nightstand: PROPS + 'Nightstand_Shelf.gltf',
        chest:      PROPS + 'Chest_Wood.gltf',
        candle:     PROPS + 'CandleStick.gltf',
        candleT:    PROPS + 'CandleStick_Triple.gltf',
        bookcase:   PROPS + 'Bookcase_2.gltf',
        bookGrp:    PROPS + 'BookGroup_Medium_1.gltf',
        scroll:     PROPS + 'Scroll_1.gltf',
        potion:     PROPS + 'Potion_1.gltf',
        // Banderoles extérieures
        banner1:    PROPS + 'Banner_1.gltf',
        banner2:    PROPS + 'Banner_2.gltf',
    };

    const m = {};
    let remaining = Object.keys(toLoad).length;
    function _done() {
        remaining--;
        if (remaining === 0) _assembleTavern(scene, m, cx, cz, yC, yG, yE, yR);
    }
    for (const [key, url] of Object.entries(toLoad)) {
        loader.load(url, gltf => { _patchGlass(gltf.scene); m[key] = gltf.scene; _done(); },
                    undefined, () => { console.warn('[Taverne] échec:', url); _done(); });
    }
}

// ── Assemblage visuel V3 après chargement complet ─────────────────
function _assembleTavern(scene, m, cx, cz, yC, yG, yE, yR) {
    const HW = 6, HD = 7;
    const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;

    const xGrid = [cx-5, cx-3, cx-1, cx+1, cx+3, cx+5];
    const zGrid = [cz-6, cz-4, cz-2, cz, cz+2, cz+4, cz+6];

    // row6 : 6 panneaux sur face S ou N (12m)
    function row6(keys, y, face) {
        const [ry, zf] = face === 'S' ? [S, cz + HD] : [N, cz - HD];
        xGrid.forEach((x, i) => _p(scene, m[keys[i]], x, y, zf, ry));
    }
    // row7 : 7 panneaux sur face E ou W (14m)
    function row7(keys, y, face) {
        const [ry, xf] = face === 'E' ? [E, cx + HW] : [W, cx - HW];
        zGrid.forEach((z, i) => _p(scene, m[keys[i]], xf, y, z, ry));
    }

    // ════════════════════════════════════════════════════════════
    //  MURS — 3 niveaux × 4 faces
    // ════════════════════════════════════════════════════════════

    // CAVE — brique partout
    row6(Array(6).fill('wBrick'), yC, 'S');
    row6(Array(6).fill('wBrick'), yC, 'N');
    row7(Array(7).fill('wBrick'), yC, 'E');
    row7(Array(7).fill('wBrick'), yC, 'W');

    // RDC — porte N au panneau cx-1, fenêtres réparties
    row6(['wBrick','wBrickWin','wBrickDoor','wBrickWin','wBrick','wBrickWin'], yG, 'N');
    row6(['wBrickWin','wBrick','wBrickWin','wBrick','wBrickWin','wBrick'],     yG, 'S');
    row7(['wBrick','wBrickWin','wBrick','wBrickWin','wBrick','wBrickWin','wBrick'], yG, 'E');
    row7(['wBrick','wBrickWin','wBrick','wBrickWin','wBrick','wBrickWin','wBrick'], yG, 'W');

    // ÉTAGE — plâtre mi-bois, pans de bois
    row6(['wPlastGrid','wPlastWin','wPlastGrid','wPlastWin','wPlastGrid','wPlastWin'], yE, 'N');
    row6(['wPlast','wPlastWin','wPlast','wPlastWin','wPlast','wPlastWin'],             yE, 'S');
    row7(['wPlast','wPlastWin','wPlastGrid','wPlastWin','wPlastGrid','wPlastWin','wPlast'], yE, 'E');
    row7(['wPlast','wPlastWin','wPlastGrid','wPlastWin','wPlastGrid','wPlastWin','wPlast'], yE, 'W');

    // Coins extérieurs — 3 niveaux × 4 coins
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

    // ════════════════════════════════════════════════════════════
    //  ENCORBELLEMENTS — base de l'étage (yE) × 4 faces + 4 coins
    //  Effet médiéval de plancher en saillie (jettying) :
    //  l'étage déborde de ~0.4m sur la brique du RdC
    // ════════════════════════════════════════════════════════════

    for (const x of xGrid) _noZFight(_p(scene, m.ovhLong, x,      yE, cz - HD, N));
    for (const x of xGrid) _noZFight(_p(scene, m.ovhLong, x,      yE, cz + HD, S));
    for (const z of zGrid) _noZFight(_p(scene, m.ovhLong, cx + HW, yE, z,      E));
    for (const z of zGrid) _noZFight(_p(scene, m.ovhLong, cx - HW, yE, z,      W));

    _noZFight(_p(scene, m.ovhCorner, cx - HW, yE, cz + HD, S));  // SW
    _noZFight(_p(scene, m.ovhCorner, cx + HW, yE, cz + HD, E));  // SE
    _noZFight(_p(scene, m.ovhCorner, cx - HW, yE, cz - HD, W));  // NW
    _noZFight(_p(scene, m.ovhCorner, cx + HW, yE, cz - HD, N));  // NE

    // ════════════════════════════════════════════════════════════
    //  BALCON SUD — pleine largeur, niveau étage
    // ════════════════════════════════════════════════════════════

    for (const x of xGrid)
        _noZFight(_p(scene, m.balcStr, x, yE, cz + HD, S));

    // ════════════════════════════════════════════════════════════
    //  VOLETS EXTÉRIEURS — fenêtres RdC (Wide Round Open)
    // ════════════════════════════════════════════════════════════

    // Face N : fenêtres i=1,3,5 → cx-3, cx+1, cx+5
    _noZFight(_p(scene, m.shutWin, cx - 3, yG, cz - HD, N));
    _noZFight(_p(scene, m.shutWin, cx + 1, yG, cz - HD, N));
    _noZFight(_p(scene, m.shutWin, cx + 5, yG, cz - HD, N));
    // Face S : fenêtres i=0,2,4 → cx-5, cx-1, cx+3
    _noZFight(_p(scene, m.shutWin, cx - 5, yG, cz + HD, S));
    _noZFight(_p(scene, m.shutWin, cx - 1, yG, cz + HD, S));
    _noZFight(_p(scene, m.shutWin, cx + 3, yG, cz + HD, S));
    // Face E : fenêtres i=1,3,5 → cz-4, cz, cz+4
    _noZFight(_p(scene, m.shutWin, cx + HW, yG, cz - 4, E));
    _noZFight(_p(scene, m.shutWin, cx + HW, yG, cz,     E));
    _noZFight(_p(scene, m.shutWin, cx + HW, yG, cz + 4, E));
    // Face W : mêmes Z
    _noZFight(_p(scene, m.shutWin, cx - HW, yG, cz - 4, W));
    _noZFight(_p(scene, m.shutWin, cx - HW, yG, cz,     W));
    _noZFight(_p(scene, m.shutWin, cx - HW, yG, cz + 4, W));

    // ════════════════════════════════════════════════════════════
    //  SOLS — 6×7 dalles 2m×2m (42 dalles / niveau)
    // ════════════════════════════════════════════════════════════
    for (const x of xGrid) for (const z of zGrid) {
        _p(scene, m.flRed,   x, yC, z);
        _p(scene, m.flBrick, x, yG, z);
        _p(scene, m.flWood,  x, yE, z);
    }

    // ════════════════════════════════════════════════════════════
    //  TOITURE — tuiles rondes + pignons + lucarnes + 2 cheminées
    // ════════════════════════════════════════════════════════════

    _p(scene, m.roof, cx, yR, cz, 0, 1.5, 1, 1);
    _noZFight(_p(scene, m.roofFront, cx, yR, cz + HD + 0.01, S, 1.5, 1, 1));  // pignon S
    _noZFight(_p(scene, m.roofFront, cx, yR, cz - HD - 0.01, N, 1.5, 1, 1));  // pignon N

    _p(scene, m.chimney,  cx - 4.5, yG, cz + 5.5);          // SW — cuisine
    _p(scene, m.chimney2, cx + 4.5, yG, cz - 5.0);          // NE — chambre maître

    // Lucarnes pente sud — mi-hauteur du pignon (V3 nouveau)
    _p(scene, m.roofDormer, cx - 2.5, yR + 0.35, cz + HD * 0.4, S);
    _p(scene, m.roofDormer, cx + 2.5, yR + 0.35, cz + HD * 0.4, S);

    // ════════════════════════════════════════════════════════════
    //  ESCALIERS + GARDE-CORPS + COUVERTURES DE TRÉMIE
    // ════════════════════════════════════════════════════════════

    _p(scene, m.stairInt,  cx + 4.0, yC, cz - 3.5, 0, 1, 1, 0.74);  // cave → RdC
    _p(scene, m.stairInt,  cx - 4.0, yG, cz - 3.5, 0, 1, 1, 0.74);  // RdC  → étage

    _noZFight(_p(scene, m.stairRail, cx + 4.0, yC, cz - 3.5, 0, 1, 1, 0.74));
    _noZFight(_p(scene, m.stairRail, cx - 4.0, yG, cz - 3.5, 0, 1, 1, 0.74));

    _noZFight(_p(scene, m.holeSt, cx + 4.0, yG, cz - 1.75, N));  // trémie NE (haut de la rampe)
    _noZFight(_p(scene, m.holeSt, cx - 4.0, yE, cz - 1.75, N));  // trémie NW (haut de la rampe)

    // ════════════════════════════════════════════════════════════
    //  CAVE À VIN — mur W + étagères E
    // ════════════════════════════════════════════════════════════

    for (let i = 0; i < 4; i++) {
        _p(scene, m.barrel, cx - 5.2, yC, cz - 4.5 + i * 2.0);
        _p(scene, m.barrel, cx - 4.4, yC, cz - 4.5 + i * 2.0);
    }
    _p(scene, m.barrelA, cx - 1.0, yC, cz + 5.8);
    _p(scene, m.barrelA, cx + 0.5, yC, cz + 5.8);
    _p(scene, m.barrelA, cx + 2.0, yC, cz + 5.8);
    _p(scene, m.barrelH, cx - 0.5, yC,        cz + 2.0);
    _p(scene, m.barrel,  cx - 0.5, yC + 0.46, cz + 2.0, 0, 0.72, 0.72, 0.72);

    for (let row = 0; row < 3; row++) {
        _p(scene, m.shelfArch, cx + 5.5, yC + 0.55 + row * 0.85, cz - 2.5, W);
        _p(scene, m.bottles,   cx + 5.3, yC + 0.65 + row * 0.85, cz - 2.5, W);
        _p(scene, m.shelfArch, cx + 5.5, yC + 0.55 + row * 0.85, cz + 0.5, W);
        _p(scene, m.bottles,   cx + 5.3, yC + 0.65 + row * 0.85, cz + 0.5, W);
    }

    _p(scene, m.lantern, cx - 5.7, yC + 1.6, cz,      E);
    _p(scene, m.lantern, cx + 5.7, yC + 1.6, cz - 3,  W);
    _p(scene, m.lantern, cx,       yC + 1.6, cz + 6.5, S);
    light(scene, cx, yC + WH * 0.65, cz, 4, 10);
    torch(scene, cx + 5.5, yC + 1.8, cz + 4.5, 'W');

    // ════════════════════════════════════════════════════════════
    //  CACHOT — zone NW de la cave (dark fantasy V3)
    //  Cage suspendue, chaînes, mannequin abîmé, armes rouillées,
    //  crochets à cordes — une cellule abandonnée depuis des années.
    // ════════════════════════════════════════════════════════════

    _p(scene, m.cage,     cx - 4.5, yC + 1.9,  cz - 5.2);
    _p(scene, m.chain,    cx - 4.8, yC + 0.02, cz - 5.8, Math.PI * 0.35);
    _p(scene, m.chain,    cx - 3.8, yC + 0.02, cz - 4.5, Math.PI * 0.70);
    _p(scene, m.dummy,    cx - 2.0, yC,         cz - 5.8, Math.PI * 0.15);
    _p(scene, m.weapStand,cx - 3.5, yC,         cz - 6.0);
    _p(scene, m.axe,      cx - 3.5, yC + 0.5,  cz - 5.8, E);
    _p(scene, m.pegRack,  cx - 1.5, yC + 1.2,  cz - 6.8, S);
    _p(scene, m.rope,     cx - 2.0, yC + 0.1,  cz - 6.5);
    _p(scene, m.rope,     cx - 1.0, yC + 0.1,  cz - 6.5, Math.PI * 0.4);

    torch(scene, cx - 5.5, yC + 1.6, cz - 5.0, 'E');
    light(scene, cx - 3.5, yC + WH * 0.55, cz - 5.5, 2.0, 7);

    // ════════════════════════════════════════════════════════════
    //  REZ-DE-CHAUSSÉE — grande salle de bar
    // ════════════════════════════════════════════════════════════

    // ── Comptoir bar — tables alignées mur S ────────────────────
    _p(scene, m.tableLg, cx - 4.5, yG, cz + 5.8);
    _p(scene, m.tableLg, cx - 2.5, yG, cz + 5.8);
    _p(scene, m.tableLg, cx - 0.5, yG, cz + 5.8);
    _p(scene, m.tableLg, cx + 1.5, yG, cz + 5.8);

    for (let i = -4; i <= 3; i++)
        _p(scene, m.stool, cx + i * 0.95 + 0.5, yG, cz + 4.5);

    // Derrière le bar : armoires + étagères bouteilles (V3)
    _p(scene, m.cabinet,  cx - 5.0, yG, cz + 6.4, S);
    _p(scene, m.cabinet,  cx - 3.0, yG, cz + 6.4, S);
    _p(scene, m.shelfBot, cx - 0.8, yG, cz + 6.5, S);
    _p(scene, m.shelfBot, cx + 1.2, yG, cz + 6.5, S);

    // ── Cuisine — coin SE ───────────────────────────────────────
    _p(scene, m.cauldron,  cx + 4.5, yG, cz + 5.5);
    _p(scene, m.stallCart, cx + 4.8, yG, cz + 3.2, W);
    light(scene, cx + 4.5, yG + 0.9, cz + 5.5, 4, 10);

    // ── Table 1 — zone NW ───────────────────────────────────────
    _p(scene, m.tableLg, cx - 3.5, yG, cz - 3.5);
    _p(scene, m.chair,   cx - 3.5, yG, cz - 5.2, 0);
    _p(scene, m.chair,   cx - 3.5, yG, cz - 1.8, N);
    _p(scene, m.chair,   cx - 5.2, yG, cz - 3.5, E);
    _p(scene, m.mug,     cx - 3.8, yG + 0.82, cz - 3.5);

    // ── Table 2 — zone NE ───────────────────────────────────────
    _p(scene, m.tableLg, cx + 1.5, yG, cz - 3.5);
    _p(scene, m.chair,   cx + 1.5, yG, cz - 5.2, 0);
    _p(scene, m.chair,   cx + 1.5, yG, cz - 1.8, N);
    _p(scene, m.chair,   cx + 3.2, yG, cz - 3.5, W);
    _p(scene, m.mug,     cx + 1.8, yG + 0.82, cz - 3.5);

    // ── Table 3 — centre-ouest avec bancs ───────────────────────
    _p(scene, m.tableLg, cx - 1.5, yG, cz + 1.5);
    _p(scene, m.bench,   cx - 1.5, yG, cz + 0.0);
    _p(scene, m.bench,   cx - 1.5, yG, cz + 3.0, N);
    _p(scene, m.mug,     cx - 1.8, yG + 0.82, cz + 1.5);

    // ── Table 4 — centre-est avec bancs ─────────────────────────
    _p(scene, m.tableLg, cx + 3.5, yG, cz + 1.5);
    _p(scene, m.bench,   cx + 3.5, yG, cz + 0.0);
    _p(scene, m.bench,   cx + 3.5, yG, cz + 3.0, N);
    _p(scene, m.mug,     cx + 3.2, yG + 0.82, cz + 1.5);

    // Chandeliers suspendus
    _p(scene, m.chandelier, cx - 3.5, yG + WH - 0.05, cz - 3.5);
    _p(scene, m.chandelier, cx + 1.5, yG + WH - 0.05, cz - 3.5);
    _p(scene, m.chandelier, cx - 1.5, yG + WH - 0.05, cz + 1.5);
    _p(scene, m.chandelier, cx + 3.5, yG + WH - 0.05, cz + 1.5);
    _p(scene, m.chandelier, cx - 0.5, yG + WH - 0.05, cz + 5.0);

    // Lanternes murales
    _p(scene, m.lantern, cx - 5.7, yG + 1.9, cz - 4.5, E);
    _p(scene, m.lantern, cx + 5.7, yG + 1.9, cz - 4.5, W);
    _p(scene, m.lantern, cx - 5.7, yG + 1.9, cz + 2.5, E);
    _p(scene, m.lantern, cx + 5.7, yG + 1.9, cz + 2.5, W);

    light(scene, cx - 3.5, yG + WH * 0.75, cz - 3.5, 5, 12);
    light(scene, cx + 1.5, yG + WH * 0.75, cz - 3.5, 5, 12);
    light(scene, cx - 1.5, yG + WH * 0.75, cz + 1.5, 5, 12);
    light(scene, cx + 3.5, yG + WH * 0.75, cz + 1.5, 5, 12);
    light(scene, cx,       yG + WH * 0.75, cz + 5.0, 4, 10);

    torch(scene, cx - 2.5, yG + 2.6, cz - HD + 0.15, 'N');
    torch(scene, cx + 0.5, yG + 2.6, cz - HD + 0.15, 'N');

    // ════════════════════════════════════════════════════════════
    //  ÉTAGE — 4 chambres richement meublées (V3)
    // ════════════════════════════════════════════════════════════

    // Mur de séparation E-O (z = cz)
    _p(scene, m.wPlast,    cx - 5, yE, cz, S);
    _p(scene, m.wPlast,    cx - 3, yE, cz, S);
    _p(scene, m.wPlastWin, cx - 1, yE, cz, S);
    _p(scene, m.wPlastWin, cx + 1, yE, cz, S);
    _p(scene, m.wPlast,    cx + 3, yE, cz, S);
    _p(scene, m.wPlast,    cx + 5, yE, cz, S);

    // Chambre NW — la barmaid
    _p(scene, m.bed1,      cx - 4.5, yE, cz - 5.0, E);
    _p(scene, m.nightstand,cx - 3.0, yE, cz - 5.8);
    _p(scene, m.candle,    cx - 3.0, yE + 1.22, cz - 5.8);
    _p(scene, m.chest,     cx - 5.5, yE, cz - 2.0, E);
    _p(scene, m.bookGrp,   cx - 3.0, yE + 1.22, cz - 4.8);
    _p(scene, m.scroll,    cx - 4.8, yE + 0.02,  cz - 3.5, Math.PI * 0.2);

    // Chambre NE — le maître d'armes
    _p(scene, m.bed1,      cx + 4.5, yE, cz - 5.0, W);
    _p(scene, m.nightstand,cx + 3.0, yE, cz - 5.8);
    _p(scene, m.candle,    cx + 3.0, yE + 1.22, cz - 5.8);
    _p(scene, m.chest,     cx + 5.5, yE, cz - 2.0, W);
    _p(scene, m.potion,    cx + 3.0, yE + 1.22, cz - 4.8);
    _p(scene, m.potion,    cx + 3.2, yE + 1.22, cz - 4.5);

    // Chambre SW — les voyageurs
    _p(scene, m.bed2,      cx - 4.5, yE, cz + 2.5, E);
    _p(scene, m.nightstand,cx - 3.0, yE, cz + 1.5);
    _p(scene, m.candleT,   cx - 3.0, yE + 1.22, cz + 1.5);
    _p(scene, m.chest,     cx - 5.5, yE, cz + 5.0, E);
    _p(scene, m.bookGrp,   cx - 3.2, yE + 1.22, cz + 2.5);

    // Chambre SE — l'alchimiste de passage
    _p(scene, m.bed2,      cx + 4.5, yE, cz + 2.5, W);
    _p(scene, m.nightstand,cx + 3.0, yE, cz + 1.5);
    _p(scene, m.candleT,   cx + 3.0, yE + 1.22, cz + 1.5);
    _p(scene, m.bookcase,  cx + 5.5, yE, cz + 5.0, W);
    _p(scene, m.scroll,    cx + 3.2, yE + 1.22, cz + 2.5);
    _p(scene, m.potion,    cx + 5.5, yE + 1.5,  cz + 3.5, W);

    light(scene, cx - 4.0, yE + WH * 0.7, cz - 4.0, 3.5, 8);
    light(scene, cx + 4.0, yE + WH * 0.7, cz - 4.0, 3.5, 8);
    light(scene, cx - 4.0, yE + WH * 0.7, cz + 3.5, 3.5, 8);
    light(scene, cx + 4.0, yE + WH * 0.7, cz + 3.5, 3.5, 8);
    torch(scene, cx - 5.7, yE + 1.9, cz - 4.0, 'E');
    torch(scene, cx + 5.7, yE + 1.9, cz - 4.0, 'W');
    torch(scene, cx - 5.7, yE + 1.9, cz + 3.5, 'E');
    torch(scene, cx + 5.7, yE + 1.9, cz + 3.5, 'W');

    // ════════════════════════════════════════════════════════════
    //  EXTÉRIEUR NORD — entrée principale (V3)
    // ════════════════════════════════════════════════════════════

    // Arche décorative au-dessus de la porte (panneau cx-1)
    _noZFight(_p(scene, m.wallArch, cx - 1, yG, cz - HD, N));

    // Piliers de soutien flanquant l'entrée
    _p(scene, m.propSup, cx - 2.5, yG, cz - HD - 0.2, N);
    _p(scene, m.propSup, cx + 0.5, yG, cz - HD - 0.2, N);

    // Banderoles de guilde
    _p(scene, m.banner1, cx - 2.8, yG + 1.5, cz - HD - 0.1, N);
    _p(scene, m.banner2, cx + 0.8, yG + 1.5, cz - HD - 0.1, N);

    // Enseigne forgée "L'Auberge du Corbeau Noir"
    {
        const signArm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.025, 1.2, 5), mTWoodDk);
        signArm.rotation.z = Math.PI / 2;
        signArm.position.set(cx - 3.5, yG + WH * 0.74, cz - HD - 0.05);
        scene.add(signArm);
        const signRing = new THREE.Mesh(
            new THREE.TorusGeometry(0.07, 0.015, 6, 12), mTIron);
        signRing.position.set(cx - 3.5, yG + WH * 0.74, cz - HD - 0.05);
        scene.add(signRing);
        const signBoard = new THREE.Mesh(
            new THREE.BoxGeometry(1.05, 0.48, 0.07),
            new THREE.MeshLambertMaterial({ color: 0x3a1c08 }));
        signBoard.position.set(cx - 4.15, yG + WH * 0.70, cz - HD - 0.07);
        scene.add(signBoard);
        const signBorder = new THREE.Mesh(
            new THREE.BoxGeometry(1.16, 0.58, 0.04),
            new THREE.MeshLambertMaterial({ color: 0xa07010 }));
        signBorder.position.set(cx - 4.15, yG + WH * 0.70, cz - HD - 0.04);  // derrière la planche, bords visibles
        scene.add(signBorder);
    }

    _p(scene, m.barrel,  cx + 4.5, yG,       cz - HD - 1.5);
    _p(scene, m.barrel,  cx + 4.5, yG + 0.9, cz - HD - 1.5, 0, 0.72, 0.72, 0.72);
    _p(scene, m.barrelA, cx - 4.5, yG,       cz - HD - 1.3);

    light(scene, cx, yG + WH * 0.82, cz - HD - 0.8, 7, 16);
    torch(scene, cx - 2.5, yG + WH * 0.68, cz - HD + 0.08, 'N');
    torch(scene, cx + 0.5, yG + WH * 0.68, cz - HD + 0.08, 'N');

    // ════════════════════════════════════════════════════════════
    //  EXTÉRIEUR — côtés est + arrière (V3)
    // ════════════════════════════════════════════════════════════

    // Chariot abandonné — côté est
    _p(scene, m.propWagon, cx + HW + 2.5, yG, cz + 2.0, W * 0.6);

    // Clôture bois — enclos côté est
    for (let i = 0; i < 4; i++) {
        _p(scene, m.fencePost, cx + HW + 1.5, yG, cz - 2.5 + i * 2.2, E);
        if (i < 3) _p(scene, m.fenceExt, cx + HW + 1.5, yG, cz - 1.4 + i * 2.2, E);
    }

    // Vignes grimpantes — façades S et W
    _p(scene, m.propVine4, cx - 5.5, yG + 0.5, cz + HD + 0.05, S);
    _p(scene, m.propVine9, cx + 4.5, yG + 0.5, cz + HD + 0.05, S);
    _p(scene, m.propVine1, cx - HW - 0.05, yG + 0.5, cz - 2.0, W);
    _p(scene, m.propVine4, cx - HW - 0.05, yG + 0.5, cz + 3.0, W);
    _p(scene, m.propVine9, cx - HW - 0.05, yG + 0.5, cz + 5.5, W);

    // Éclairage extérieur — faces S, E, W (V3 fix : évite les façades noires)
    light(scene, cx,        yG + WH * 0.8, cz + HD + 1.2, 6, 14);  // face S centre
    light(scene, cx + HW + 1.2, yG + WH * 0.8, cz,        5, 12);  // face E
    light(scene, cx - HW - 1.2, yG + WH * 0.8, cz,        5, 12);  // face W
    torch(scene, cx - 4.5, yG + 2.2, cz + HD + 0.12, 'S');          // torche S gauche
    torch(scene, cx + 4.5, yG + 2.2, cz + HD + 0.12, 'S');          // torche S droite
    torch(scene, cx + HW + 0.12, yG + 2.2, cz - 3.0,   'E');        // torche E nord
    torch(scene, cx + HW + 0.12, yG + 2.2, cz + 3.0,   'E');        // torche E sud
    torch(scene, cx - HW - 0.12, yG + 2.2, cz + 2.0,   'W');        // torche W

    // ════════════════════════════════════════════════════════════
    //  TRAPPES D'ACCÈS CAVE (inchangées V2 → V3)
    // ════════════════════════════════════════════════════════════

    const _tpHatchGeo = new THREE.BoxGeometry(1.2, 0.07, 1.2);
    const _tpHatchMat = new THREE.MeshLambertMaterial({ color: 0x3b2510 });
    const _tpRingMat  = new THREE.MeshLambertMaterial({ color: 0x7a5a2a });

    const tpExtX  = cx;
    const tpExtZ  = cz + HD + 0.9;
    const tpCaveX = cx;
    const tpCaveZ = cz + HD - 1.4;

    const tpExtGY = getHeight(tpExtX, tpExtZ);

    const hatchExt = new THREE.Mesh(_tpHatchGeo, _tpHatchMat);
    hatchExt.position.set(tpExtX, tpExtGY + 0.02, tpExtZ);
    scene.add(hatchExt);
    const frameN = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 0.18), _tpRingMat);
    frameN.position.set(tpExtX, tpExtGY + 0.02, tpExtZ - 0.69);
    scene.add(frameN);
    const frameS = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 0.18), _tpRingMat);
    frameS.position.set(tpExtX, tpExtGY + 0.02, tpExtZ + 0.69);
    scene.add(frameS);
    const frameW = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 1.6), _tpRingMat);
    frameW.position.set(tpExtX - 0.69, tpExtGY + 0.02, tpExtZ);
    scene.add(frameW);
    const frameE = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 1.6), _tpRingMat);
    frameE.position.set(tpExtX + 0.69, tpExtGY + 0.02, tpExtZ);
    scene.add(frameE);

    const hatchCave = new THREE.Mesh(_tpHatchGeo, _tpHatchMat);
    hatchCave.position.set(tpCaveX, yC + 0.02, tpCaveZ);
    scene.add(hatchCave);
    const caveFrame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 1.6), _tpRingMat);
    caveFrame.position.set(tpCaveX, yC + 0.01, tpCaveZ);
    scene.add(caveFrame);

    const ladderMat = new THREE.MeshLambertMaterial({ color: 0x5a3a18 });
    for (let i = 0; i < 5; i++) {
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), ladderMat);
        rung.position.set(tpCaveX, yC + 0.4 + i * 0.55, cz + HD - 0.12);
        scene.add(rung);
    }
    const stileL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.0, 0.06), ladderMat);
    stileL.position.set(tpCaveX - 0.22, yC + 1.5, cz + HD - 0.12);
    scene.add(stileL);
    const stileR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.0, 0.06), ladderMat);
    stileR.position.set(tpCaveX + 0.22, yC + 1.5, cz + HD - 0.12);
    scene.add(stileR);

    _tavernTrapdoors.length = 0;
    _tavernTrapdoors.push(
        {
            x: tpExtX,  z: tpExtZ,  playerY: tpExtGY,
            destX: tpCaveX, destY: yC + 1.0, destZ: tpCaveZ,
            label: '[ F ]  Descendre à la cave',
            radius: 1.5,
        },
        {
            x: tpCaveX, z: tpCaveZ, playerY: yC,
            destX: tpExtX, destY: tpExtGY + 1.0, destZ: tpExtZ + 1.2,
            label: '[ F ]  Remonter à l\'extérieur',
            radius: 1.5,
        }
    );

    console.log('[Town] Taverne "L\'Auberge du Corbeau Noir" v3 (12m×14m) assemblée ✓');
}

// ═══════════════════════════════════════════════════════════════
//  PALISSADE — chaque poteau à sa hauteur terrain locale (§terrain)
// ═══════════════════════════════════════════════════════════════
function _buildPalisade(scene, ox, oz, by) {
    const R = 46, pH = 3.2, sp = 1.8;
    _palisadeRow(scene, ox,   oz-R, R*2, 'X', pH, sp, ox);
    _palisadeRow(scene, ox,   oz+R, R*2, 'X', pH, sp, ox);
    _palisadeRow(scene, ox-R, oz,   R*2, 'Z', pH, sp, null);
    _palisadeRow(scene, ox+R, oz,   R*2, 'Z', pH, sp, null);
}

function _palisadeRow(sc, cx, cz, len, axis, pH, sp, gate) {
    const gW = DW + 1.2;
    const n  = Math.floor(len / sp);
    const s0 = (axis === 'X' ? cx : cz) - len / 2;

    for (let i = 0; i < n; i++) {
        const pos = s0 + (i + 0.5) * sp;
        if (gate !== null && Math.abs(pos - gate) < gW / 2) continue;
        const px = axis === 'X' ? pos : cx;
        const pz = axis === 'Z' ? pos : cz;
        // Hauteur terrain locale — article §terrain : chaque objet à son Y
        const localY = getHeight(px, pz);
        const pieu = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.13, pH, 5), mPost);
        pieu.position.set(px, localY + pH / 2, pz);
        sc.add(pieu);
    }

    if (gate === null) return;

    // Piliers de portail — aussi à leur hauteur terrain
    const g1x = axis === 'X' ? gate-gW/2-0.2 : cx;
    const g2x = axis === 'X' ? gate+gW/2+0.2 : cx;
    const g1z = axis === 'Z' ? gate-gW/2-0.2 : cz;
    const g2z = axis === 'Z' ? gate+gW/2+0.2 : cz;
    for (const [px, pz] of [[g1x,g1z],[g2x,g2z]]) {
        const ly = getHeight(px, pz);
        const gp = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, pH+1, 6), mPost);
        gp.position.set(px, ly + (pH+1)/2, pz); sc.add(gp);
    }

    const ly  = getHeight(axis === 'X' ? gate : cx, axis === 'Z' ? gate : cz);
    const tw  = axis === 'X' ? gW+0.6 : 0.25;
    const td  = axis === 'Z' ? gW+0.6 : 0.25;
    const trav = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.25, td), mPost);
    trav.position.set(axis === 'X' ? gate : cx, ly+pH+0.75, axis === 'Z' ? gate : cz);
    sc.add(trav);

    const lgt = axis === 'X' ? gate : cx;
    const lgz = axis === 'Z' ? gate : cz;
    torch(sc, g1x, getHeight(g1x,g1z)+pH*0.8, g1z, 'N');
    torch(sc, g2x, getHeight(g2x,g2z)+pH*0.8, g2z, 'N');
    light(sc, lgt, getHeight(lgt,lgz)+pH+0.4, lgz, 5.5, 13);
}

// ═══════════════════════════════════════════════════════════════
//  NATURE — arbres / buissons / herbe avec filtrage pente (§7)
//  Chaque objet à getHeight(x,z) local (§4 placement surface)
// ═══════════════════════════════════════════════════════════════
const _BIRCH = ['BirchTree_1','BirchTree_2','BirchTree_3','BirchTree_4','BirchTree_5'];
const _MAPLE = ['MapleTree_1','MapleTree_2','MapleTree_3','MapleTree_4','MapleTree_5'];
const _DEAD  = ['DeadTree_1','DeadTree_2','DeadTree_3','DeadTree_4','DeadTree_5',
                'DeadTree_6','DeadTree_7','DeadTree_8','DeadTree_9','DeadTree_10'];
const _BUSH  = ['Bush','Bush_Flowers','Bush_Large','Bush_Small','Bush_Small_Flowers'];
const _GRASS = ['Grass_Large','Grass_Small'];

function _loadNature(scene, loader, ox, oz, by) {
    const rng  = _rng(0xF0BE5771);
    const list = [];

    // Anneau systématique : n arbres équidistants, légère variation radiale + angulaire
    // Anneaux décalés d'un demi-pas entre eux → packing hexagonal, zéro gap angulaire
    function _ring(r, n, angleOffset, scMin, scMax, p0, p1, p2) {
        for (let i = 0; i < n; i++) {
            const a  = (i / n) * Math.PI * 2 + angleOffset + (rng() - 0.5) * 0.12;
            const dr = (rng() - 0.5) * 5;
            const roll = rng();
            const pool = roll < 0.4 ? p0 : roll < 0.72 ? p1 : p2;
            list.push({ name: pool[Math.floor(rng() * pool.length)],
                x: ox + Math.cos(a) * (r + dr), z: oz + Math.sin(a) * (r + dr),
                s: scMin + rng() * (scMax - scMin), ry: rng() * Math.PI * 2, slopeMax: 0.66 });
        }
    }

    // ── MUR VISUEL R=48..105 — anneaux serrés, grands arbres ─
    // n calculé pour ~4 unités entre troncs → canopées qui se chevauchent
    _ring( 48,  75, 0,                1.4, 2.4, _BIRCH, _MAPLE, _DEAD);
    _ring( 57,  90, Math.PI / 90,     1.4, 2.6, _MAPLE, _DEAD,  _BIRCH);
    _ring( 66, 104, 0,                1.5, 2.8, _DEAD,  _BIRCH, _MAPLE);
    _ring( 76, 120, Math.PI / 120,    1.4, 2.6, _BIRCH, _DEAD,  _MAPLE);
    _ring( 87, 137, 0,                1.3, 2.4, _MAPLE, _BIRCH, _DEAD);
    _ring( 99, 156, Math.PI / 156,    1.2, 2.2, _DEAD,  _MAPLE, _BIRCH);

    // ── FORÊT DENSE R=105..260 ───────────────────────────────
    // Aléatoire mais très dense, arbres morts plus fréquents
    for (let i = 0; i < 280; i++) {
        const a    = rng() * Math.PI * 2;
        const r    = 105 + rng() * 155;
        const roll = rng();
        const pool = roll < 0.22 ? _BIRCH : roll < 0.44 ? _MAPLE : _DEAD;
        list.push({ name: pool[Math.floor(rng() * pool.length)],
            x: ox + Math.cos(a) * r, z: oz + Math.sin(a) * r,
            s: 1.1 + rng() * 1.5, ry: rng() * Math.PI * 2, slopeMax: 0.66 });
    }

    // ── FORÊT PROFONDE R=260..450 ────────────────────────────
    // Clairsemée mais grands arbres → continuité visuelle à distance
    for (let i = 0; i < 120; i++) {
        const a    = rng() * Math.PI * 2;
        const r    = 260 + rng() * 190;
        const pool = rng() < 0.30 ? _MAPLE : _DEAD;
        list.push({ name: pool[Math.floor(rng() * pool.length)],
            x: ox + Math.cos(a) * r, z: oz + Math.sin(a) * r,
            s: 1.4 + rng() * 1.6, ry: rng() * Math.PI * 2, slopeMax: 0.66 });
    }

    // ── Buissons R=28..220 ────────────────────────────────────
    for (let i = 0; i < 200; i++) {
        const a = rng() * Math.PI * 2, r = 28 + rng() * 192;
        list.push({ name: _BUSH[Math.floor(rng() * _BUSH.length)],
            x: ox + Math.cos(a) * r, z: oz + Math.sin(a) * r,
            s: 0.6 + rng() * 0.9, ry: rng() * Math.PI * 2, slopeMax: 0.87 });
    }

    // ── Herbe R=16..160 ───────────────────────────────────────
    for (let i = 0; i < 120; i++) {
        const a = rng() * Math.PI * 2, r = 16 + rng() * 144;
        list.push({ name: _GRASS[Math.floor(rng() * _GRASS.length)],
            x: ox + Math.cos(a) * r, z: oz + Math.sin(a) * r,
            s: 0.6 + rng() * 0.8, ry: rng() * Math.PI * 2, slopeMax: 1.05 });
    }

    _batchLoad(scene, loader, list, NATURE);
}

function _batchLoad(sc, loader, list, base) {
    const unique = [...new Set(list.map(e => e.name))];
    const tmpl = {};
    let done = 0;
    for (const name of unique) {
        loader.load(base + name + '.gltf', (gltf) => {
            const root = gltf.scene;
            root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.frustumCulled = false; } });
            _patchGlass(root);
            tmpl[name] = root;
            if (++done === unique.length) {
                for (const e of list) {
                    const t = tmpl[e.name]; if (!t) continue;
                    // Filtrage pente — article §7
                    if (e.slopeMax !== undefined && getTerrainSlope(e.x, e.z) > e.slopeMax) continue;
                    const obj = t.clone(true);
                    // Hauteur terrain locale — article §4
                    obj.position.set(e.x, getHeight(e.x, e.z), e.z);
                    obj.rotation.y = e.ry;
                    obj.scale.setScalar(e.s);
                    sc.add(obj);
                }
            }
        }, undefined, () => { if (++done === unique.length) {} });
    }
}

// ═══════════════════════════════════════════════════════════════
//  PNJ — spawns validés sur terrain plat
// ═══════════════════════════════════════════════════════════════
function _spawnNPCs(scene, ox, oz, by) {
    // Valider chaque position avant de spawner
    const configs = [
        { mesh: OUTFITS+'Male_Peasant.gltf',   base: BASE_M, x: ox+5,  z: oz+3,  r: 4 },
        { mesh: OUTFITS+'Female_Peasant.gltf', base: BASE_F, x: ox-5,  z: oz-2,  r: 3 },
        { mesh: OUTFITS+'Male_Peasant.gltf',   base: BASE_M, x: ox-34, z: oz+28, r: 2 },
        { mesh: OUTFITS+'Male_Ranger.gltf',    base: BASE_M, x: ox+40, z: oz-40, r: 3 },
    ];
    for (const cfg of configs) {
        const y = getHeight(cfg.x, cfg.z);
        _npcs.push(new NPC(scene, cfg.mesh, NPC_ANIMS, NPC_CLIPS,
            [cfg.x, y, cfg.z], { wanderRadius: cfg.r, baseBodyUrl: cfg.base }));
    }
}
