import * as THREE from 'three';
import { getHeight } from '../world.js';
import { addFloor, addCeiling, addWall, addRamp } from '../collision.js';
import { torch, light } from '../builder.js';

// ═══════════════════════════════════════════════════════════════
//  town_hall.js — Mairie de Valcrest
//
//  Bâtiment officiel 3 niveaux — entrée face NORD
//  Empreinte : 8m(X) × 12m(Z)  —  HW=4  HD=6
//  Superficie : 8×12×3 = ~288 m²
//
//  RdC  : Grande Salle d'Assemblée (tables, estrade, chandelier)
//  1er  : Chambre du Conseil (table ronde, bibliothèques)
//  2ème : Archives & Bureau du Seigneur (coffres, livres)
//
//  Usage :
//    buildTownHall(scene, loader, cx, cz);
// ═══════════════════════════════════════════════════════════════

const KIT   = 'assets/environment/village/';
const PROPS = 'assets/environment/props/';
const WH    = 3.12;   // hauteur d'un panneau mural MegaKit

// ── Matériaux procéduraux ─────────────────────────────────────
const mStone    = new THREE.MeshLambertMaterial({ color: 0x8a7a6a });
const mDark     = new THREE.MeshLambertMaterial({ color: 0x4a3828 });
const mBanner   = new THREE.MeshLambertMaterial({ color: 0x6e1010 });  // bordeaux

// ── Utilitaires (copiés depuis le pattern établi) ─────────────
function _p(sc, model, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
    if (!model) return null;
    const o = model.clone(true);
    o.position.set(x, y, z);
    if (ry !== 0) o.rotation.y = ry;
    if (sx !== 1 || sy !== 1 || sz !== 1) o.scale.set(sx, sy, sz);
    sc.add(o);
    return o;
}

function _noZFight(obj, factor = -1, units = -4) {
    if (!obj) return obj;
    obj.traverse(c => {
        if (!c.isMesh) return;
        const mats   = Array.isArray(c.material) ? c.material : [c.material];
        const cloned = mats.map(m => {
            const mc = m.clone();
            mc.polygonOffset = true; mc.polygonOffsetFactor = factor; mc.polygonOffsetUnits = units;
            return mc;
        });
        c.material = Array.isArray(c.material) ? cloned : cloned[0];
    });
    return obj;
}

function _tintRoof(obj, hex = 0x8b2800) {
    if (!obj) return obj;
    obj.traverse(c => {
        if (!c.isMesh) return;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(mat => { if (mat.color) mat.color.setHex(hex); });
    });
    return obj;
}

function _patchGlass(obj) {
    const mat = new THREE.MeshBasicMaterial({
        color: 0x99bbcc, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false,
    });
    mat.name = 'MI_WindowGlass_patched';
    obj.traverse(child => {
        if (!child.isMesh) return;
        if (Array.isArray(child.material))
            child.material = child.material.map(m => m?.name === 'MI_WindowGlass' ? mat : m);
        else if (child.material?.name === 'MI_WindowGlass')
            child.material = mat;
    });
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════════
/**
 * @param {THREE.Scene} scene
 * @param {GLTFLoader}  loader
 * @param {number}      cx   — centre X
 * @param {number}      cz   — centre Z
 * @param {number}      [by] — hauteur sol (défaut : getHeight)
 */
export function buildTownHall(scene, loader, cx, cz, by) {
    if (by === undefined) by = getHeight(cx, cz);

    const TW = 8, TD = 12;
    const HW = 4, HD = 6;

    // Niveaux Y
    const yG = by;            // RdC
    const yE = by + WH;       // 1er étage
    const y2 = by + WH * 2;   // 2ème étage
    const yR = by + WH * 3;   // base toit

    // ── Fondation visible ──────────────────────────────────────
    const hF = 0.45;
    const geoF = new THREE.BoxGeometry(TW + 0.5, hF, TD + 0.5);
    const found = new THREE.Mesh(geoF, mStone);
    found.position.set(cx, by - hF * 0.5 + 0.02, cz);
    scene.add(found);

    // ── Collision — sols ───────────────────────────────────────
    addFloor(cx, cz, TW, TD, yG + 0.02);
    addFloor(cx, cz, TW, TD, yE + 0.02);
    addFloor(cx, cz, TW, TD, y2 + 0.02);

    // ── Collision — plafonds ───────────────────────────────────
    addCeiling(cx, cz, TW, TD, yE - 0.02);
    addCeiling(cx, cz, TW, TD, y2 - 0.02);
    addCeiling(cx, cz, TW, TD, yR - 0.02);

    // ── Collision — murs (3 niveaux × 4 faces) ────────────────
    for (const [y0, y1] of [[yG, yE], [yE, y2], [y2, yR]]) {
        addWall(cx,       cz + HD, TW, 0.4, y0, y1);   // S
        addWall(cx,       cz - HD, TW, 0.4, y0, y1);   // N
        addWall(cx + HW,  cz,      0.4, TD, y0, y1);   // E
        addWall(cx - HW,  cz,      0.4, TD, y0, y1);   // W
    }

    // ── Collision — escaliers intérieurs ──────────────────────
    // RdC → 1er : côté E, arrière du bâtiment
    addRamp(cx + 2.0, cz + 3.5, 1.5, 3.5, yG, yE, 'z');
    // 1er → 2ème : côté W, arrière du bâtiment
    addRamp(cx - 2.0, cz + 3.5, 1.5, 3.5, yE, y2, 'z');

    // ── Chargement assets ──────────────────────────────────────
    const toLoad = {
        // Murs brique (RdC)
        wBrick:       KIT + 'Wall_UnevenBrick_Straight.gltf',
        wBrickWin:    KIT + 'Wall_UnevenBrick_Window_Wide_Round.gltf',
        wBrickDoor:   KIT + 'Wall_UnevenBrick_Door_Round.gltf',
        wallArch:     KIT + 'Wall_Arch.gltf',
        wallCover:    KIT + 'Wall_BottomCover.gltf',
        crnBrick:     KIT + 'Corner_Exterior_Brick.gltf',
        // Murs plâtre (étages)
        wPlast:       KIT + 'Wall_Plaster_Straight.gltf',
        wPlastR:      KIT + 'Wall_Plaster_Straight_R.gltf',
        wPlastWin:    KIT + 'Wall_Plaster_Window_Wide_Round.gltf',
        wPlastGrid:   KIT + 'Wall_Plaster_WoodGrid.gltf',
        wPlastDoor:   KIT + 'Wall_Plaster_Door_Round.gltf',
        wPlastArch:   KIT + 'Wall_Plaster_Door_RoundInset.gltf',
        crnWood:      KIT + 'Corner_Exterior_Wood.gltf',
        // Sols
        flBrick:      KIT + 'Floor_Brick.gltf',
        flRed:        KIT + 'Floor_RedBrick.gltf',
        flWood:       KIT + 'Floor_WoodDark.gltf',
        flWoodL:      KIT + 'Floor_WoodLight.gltf',
        // Toiture
        roof:         KIT + 'Roof_RoundTiles_8x12.gltf',
        roofFront:    KIT + 'Roof_Front_Brick8.gltf',
        roofFront6:   KIT + 'Roof_Front_Brick6.gltf',
        chimney:      KIT + 'Prop_Chimney.gltf',
        chimney2:     KIT + 'Prop_Chimney2.gltf',
        roofSupport:  KIT + 'Roof_Support2.gltf',
        // Balcon N
        balcStr:      KIT + 'Balcony_Simple_Straight.gltf',
        balcCrn:      KIT + 'Balcony_Simple_Corner.gltf',
        balcCross:    KIT + 'Balcony_Cross_Straight.gltf',
        // Escaliers extérieurs (entrée)
        stairExt:     KIT + 'Stairs_Exterior_Straight.gltf',
        stairPlatf:   KIT + 'Stairs_Exterior_Platform.gltf',
        stairSide:    KIT + 'Stairs_Exterior_SingleSide.gltf',
        // Escalier intérieur
        stairInt:     KIT + 'Stair_Interior_Solid.gltf',
        holeCover:    KIT + 'HoleCover_Straight.gltf',
        // Avant-toits 1er étage
        ohLong:       KIT + 'Overhang_Plaster_Long.gltf',
        ohCrn:        KIT + 'Overhang_Plaster_Corner_Front.gltf',
        // Props — Grande Salle
        tableLg:      PROPS + 'Table_Large.gltf',
        chair:        PROPS + 'Chair_1.gltf',
        bench:        PROPS + 'Bench.gltf',
        stool:        PROPS + 'Stool.gltf',
        bookstand:    PROPS + 'BookStand.gltf',
        chandelier:   PROPS + 'Chandelier.gltf',
        candleStand:  PROPS + 'CandleStick_Stand.gltf',
        candleTriple: PROPS + 'CandleStick_Triple.gltf',
        lantern:      PROPS + 'Lantern_Wall.gltf',
        shelfArch:    PROPS + 'Shelf_Arch.gltf',
        shelfSimp:    PROPS + 'Shelf_Simple.gltf',
        // Props — Conseil
        bookcase:     PROPS + 'Bookcase_2.gltf',
        scroll1:      PROPS + 'Scroll_1.gltf',
        scroll2:      PROPS + 'Scroll_2.gltf',
        book5:        PROPS + 'Book_5.gltf',
        bookStack:    PROPS + 'Book_Stack_1.gltf',
        mug:          PROPS + 'Mug.gltf',
        // Props — Archives
        chest:        PROPS + 'Chest_Wood.gltf',
        cabinet:      PROPS + 'Cabinet.gltf',
        potionV:      PROPS + 'Potion_1.gltf',
        // Extérieur
        barrel:       PROPS + 'Barrel.gltf',
        crate:        PROPS + 'Crate_Wooden.gltf',
        banner1C:     PROPS + 'Banner_1_Cloth.gltf',
        banner2:      PROPS + 'Banner_2.gltf',
        vine4:        KIT   + 'Prop_Vine4.gltf',
        vine9:        KIT   + 'Prop_Vine9.gltf',
    };

    const m = {};
    let remaining = Object.keys(toLoad).length;
    function _done() {
        if (--remaining === 0) _assemble(scene, m, cx, cz, yG, yE, y2, yR, by, HW, HD);
    }
    for (const [key, url] of Object.entries(toLoad)) {
        loader.load(url,
            gltf => { _patchGlass(gltf.scene); m[key] = gltf.scene; _done(); },
            undefined,
            () => { _done(); }   // tolérance aux modèles manquants
        );
    }
}

// ═══════════════════════════════════════════════════════════════
//  ASSEMBLAGE glTF
// ═══════════════════════════════════════════════════════════════
function _assemble(scene, m, cx, cz, yG, yE, y2, yR, by, HW, HD) {
    const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;

    // ── Helpers de rangée ──────────────────────────────────────
    // 4 panneaux face N/S  (8m, HW=4)
    function row4(keys, y, face) {
        const [ry, zf] = face === 'S' ? [S, cz + HD] : [N, cz - HD];
        [cx - 3, cx - 1, cx + 1, cx + 3].forEach((x, i) => _p(scene, m[keys[i]], x, y, zf, ry));
    }
    // 6 panneaux face E/W  (12m, HD=6)
    function row6(keys, y, face) {
        const [ry, xf] = face === 'E' ? [E, cx + HW] : [W, cx - HW];
        [cz - 5, cz - 3, cz - 1, cz + 1, cz + 3, cz + 5].forEach((z, i) =>
            _p(scene, m[keys[i]], xf, y, z, ry)
        );
    }

    // ── MURS RDC ──────────────────────────────────────────────
    // Nord : [fenêtre | porte ronde | arche décorative | fenêtre]
    // → entrée principale offical à gauche-centre, arche-loggia à droite
    row4(['wBrickWin', 'wBrickDoor', 'wallArch', 'wBrickWin'], yG, 'N');
    // Sud : fenêtres tout le tour (arrière du bâtiment)
    row4(['wBrickWin', 'wBrickWin', 'wBrickWin', 'wBrickWin'], yG, 'S');
    // Est : alternance mur plein / fenêtre
    row6(['wBrick', 'wBrickWin', 'wBrick', 'wBrickWin', 'wBrick', 'wBrick'], yG, 'E');
    // Ouest : idem
    row6(['wBrick', 'wBrickWin', 'wBrick', 'wBrickWin', 'wBrick', 'wBrick'], yG, 'W');

    // ── MURS 1ER ÉTAGE ─────────────────────────────────────────
    // Nord : porte balcon + fenêtres (accès balcon)
    row4(['wPlastWin', 'wPlastArch', 'wPlastDoor', 'wPlastWin'], yE, 'N');
    // Sud : plâtre + croisillons
    row4(['wPlastWin', 'wPlastGrid', 'wPlastGrid', 'wPlastWin'], yE, 'S');
    // Est
    row6(['wPlast', 'wPlastWin', 'wPlastGrid', 'wPlastWin', 'wPlast', 'wPlast'], yE, 'E');
    // Ouest
    row6(['wPlast', 'wPlastWin', 'wPlastGrid', 'wPlastWin', 'wPlast', 'wPlast'], yE, 'W');

    // ── MURS 2ÈME ÉTAGE ────────────────────────────────────────
    // Nord : pans de bois + 2 grandes fenêtres
    row4(['wPlastGrid', 'wPlastWin', 'wPlastWin', 'wPlastGrid'], y2, 'N');
    // Sud
    row4(['wPlastGrid', 'wPlastGrid', 'wPlastGrid', 'wPlastGrid'], y2, 'S');
    // Est
    row6(['wPlast', 'wPlastGrid', 'wPlastWin', 'wPlastGrid', 'wPlast', 'wPlast'], y2, 'E');
    // Ouest
    row6(['wPlast', 'wPlastGrid', 'wPlastWin', 'wPlastGrid', 'wPlast', 'wPlast'], y2, 'W');

    // ── COINS (3 niveaux) ──────────────────────────────────────
    const corners = [
        [cx - HW, cz + HD, S],
        [cx + HW, cz + HD, E],
        [cx - HW, cz - HD, W],
        [cx + HW, cz - HD, N],
    ];
    for (const [x, z, ry] of corners) {
        _noZFight(_p(scene, m.crnBrick, x, yG, z, ry));
        _noZFight(_p(scene, m.crnWood,  x, yE, z, ry));
        _noZFight(_p(scene, m.crnWood,  x, y2, z, ry));
    }

    // ── PLINTHES (base bâtiment) ───────────────────────────────
    for (const x of [cx - 3, cx - 1, cx + 1, cx + 3]) {
        _noZFight(_p(scene, m.wallCover, x, yG, cz + HD, S));
        _noZFight(_p(scene, m.wallCover, x, yG, cz - HD, N));
    }
    for (const z of [cz - 5, cz - 3, cz - 1, cz + 1, cz + 3, cz + 5]) {
        _noZFight(_p(scene, m.wallCover, cx + HW, yG, z, E));
        _noZFight(_p(scene, m.wallCover, cx - HW, yG, z, W));
    }

    // ── SOLS ──────────────────────────────────────────────────
    const xGrid = [cx - 3, cx - 1, cx + 1, cx + 3];
    const zGrid = [cz - 5, cz - 3, cz - 1, cz + 1, cz + 3, cz + 5];
    for (const x of xGrid) {
        for (const z of zGrid) {
            _p(scene, m.flRed,   x, yG, z);   // RdC — brique rouge (officiel)
            _p(scene, m.flWood,  x, yE, z);   // 1er — bois foncé
            _p(scene, m.flWoodL, x, y2, z);   // 2ème — bois clair
        }
    }

    // ── TOITURE ───────────────────────────────────────────────
    _tintRoof(_p(scene, m.roof, cx, yR, cz));
    _noZFight(_p(scene, m.roofFront, cx, yR, cz + HD, S));   // pignon SUD
    _noZFight(_p(scene, m.roofFront, cx, yR, cz - HD, N));   // pignon NORD
    // Cheminées côté S-E et S-O (arrière du bâtiment)
    _p(scene, m.chimney,  cx - 2.8, yG + 0.05, cz + 5.0);
    _p(scene, m.chimney2, cx + 2.8, yG + 0.05, cz + 5.0);

    // ── ESCALIER INTÉRIEUR RdC → 1er ──────────────────────────
    // Côté E, fond du bâtiment (z+)
    _p(scene, m.stairInt, cx + 2.0, yG, cz + 3.5, S, 1, 1, 0.74);
    _noZFight(_p(scene, m.holeCover, cx + 2.0, yE, cz + 2.2, N));

    // ── ESCALIER INTÉRIEUR 1er → 2ème ─────────────────────────
    // Côté W, fond du bâtiment
    _p(scene, m.stairInt, cx - 2.0, yE, cz + 3.5, S, 1, 1, 0.74);
    _noZFight(_p(scene, m.holeCover, cx - 2.0, y2, cz + 2.2, N));

    // ── ESCALIER EXTÉRIEUR — FAÇADE NORD ──────────────────────
    // 3 panneaux de marches + palier devant la porte (entrée est à yG)
    // On positionne les marches légèrement devant la façade N
    for (const dx of [-1.0, 1.0]) {
        _p(scene, m.stairExt, cx + dx, yG, cz - HD - 1.4, N);
    }
    _p(scene, m.stairPlatf, cx, yG, cz - HD - 0.6, N);
    // Côtés de l'escalier
    _p(scene, m.stairSide, cx - 2.1, yG, cz - HD - 1.0, N);
    _p(scene, m.stairSide, cx + 2.1, yG, cz - HD - 1.0, S);

    // ── BALCON 1ER ÉTAGE — FAÇADE NORD ───────────────────────
    // Garde-corps sur toute la largeur N
    for (const x of [cx - 3, cx - 1, cx + 1, cx + 3]) {
        _p(scene, m.balcStr, x, yE, cz - HD, N);
    }
    // Coins balcon
    _noZFight(_p(scene, m.balcCrn, cx - HW, yE, cz - HD, W));
    _noZFight(_p(scene, m.balcCrn, cx + HW, yE, cz - HD, N));

    // ── AVANT-TOITS 2ème ÉTAGE — FAÇADE NORD ─────────────────
    // Surplomb décoratif au-dessus des fenêtres du 1er, positionné
    // au bas du 2ème étage = yE + WH * (approx)
    const yOH = yE + WH * 0.92;
    for (const x of [cx - 3, cx - 1, cx + 1, cx + 3]) {
        _noZFight(_p(scene, m.ohLong, x, yOH, cz - HD, N));
    }
    _noZFight(_p(scene, m.ohCrn, cx - HW, yOH, cz - HD, W));
    _noZFight(_p(scene, m.ohCrn, cx + HW, yOH, cz - HD, N));

    // ── SUPPORTS DE TOIT (visuels) ────────────────────────────
    _p(scene, m.roofSupport, cx, yR - 0.1, cz);

    // ══════════════════════════════════════════════════════════
    //  GRANDE SALLE D'ASSEMBLÉE (RdC)
    // ══════════════════════════════════════════════════════════

    // Table principale (3 × Table_Large en ligne = 6m de long)
    // Orientée E-W, légèrement au centre-N du hall
    for (let i = 0; i < 3; i++) {
        _p(scene, m.tableLg, cx - 2.0 + i * 2.0, yG, cz - 0.8);
    }
    // Chaises côté N de la table (font face au Sud)
    for (let i = -2; i <= 2; i++) {
        _p(scene, m.chair, cx + i * 1.0, yG, cz - 2.4, S);
    }
    // Chaises côté S de la table (font face au Nord)
    for (let i = -2; i <= 2; i++) {
        _p(scene, m.chair, cx + i * 1.0, yG, cz + 0.6, N);
    }
    // Chaises de bout (E et W)
    _p(scene, m.chair, cx + 3.2, yG, cz - 0.8, W);
    _p(scene, m.chair, cx - 3.2, yG, cz - 0.8, E);

    // Estrade du maire — fond S du hall
    // Plates-formes procédurales (tribune légèrement surélevée)
    const mPlatform = new THREE.MeshLambertMaterial({ color: 0x6a4820 });
    const estrade   = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.22, 2.5), mPlatform);
    estrade.position.set(cx, yG + 0.11, cz + 4.2);
    scene.add(estrade);
    // Table d'estrade + fauteuil de présidence
    _p(scene, m.tableLg, cx - 0.8, yG + 0.22, cz + 4.0);
    _p(scene, m.tableLg, cx + 0.8, yG + 0.22, cz + 4.0);
    _p(scene, m.chair,   cx,       yG + 0.22, cz + 4.8, N);
    _p(scene, m.bookstand, cx + 0.6, yG + 0.22, cz + 3.3, S);
    // Candélabres d'estrade
    _p(scene, m.candleStand, cx - 2.2, yG + 0.22, cz + 3.5);
    _p(scene, m.candleStand, cx + 2.2, yG + 0.22, cz + 3.5);

    // Bancs de spectateurs côté E et W
    for (let i = -2; i <= 2; i += 2) {
        _p(scene, m.bench, cx + 3.5, yG, cz + i, W);
        _p(scene, m.bench, cx - 3.5, yG, cz + i, E);
    }

    // Étagères murales (côté E — dossiers, archives basses)
    _p(scene, m.shelfArch, cx + 3.8, yG + 0.65, cz - 3.5, W);
    _p(scene, m.shelfArch, cx + 3.8, yG + 1.55, cz - 3.5, W);
    _p(scene, m.shelfSimp, cx - 3.8, yG + 0.65, cz - 3.5, E);

    // Chandelier central majestueux
    _p(scene, m.chandelier, cx, yG + WH - 0.08, cz);
    // Lanternes murales face N (ext) et face E (intérieur)
    _p(scene, m.lantern, cx + 3.8, yG + WH * 0.65, cz - 4.8, W);
    _p(scene, m.lantern, cx - 3.8, yG + WH * 0.65, cz - 4.8, E);
    // Lumières
    light(scene, cx,       yG + WH * 0.7, cz,       7, 20);   // chandelier central
    light(scene, cx,       yG + WH * 0.7, cz + 4.0, 4, 12);   // estrade
    light(scene, cx + 3.0, yG + WH * 0.65, cz - 3.5, 2.5, 8); // lanterne E

    // ── Décorations extérieures Nord (entrée) ─────────────────
    // Torches flanquant la porte
    torch(scene, cx - 1.5, yG + WH * 0.65, cz - HD + 0.12, 'N');
    torch(scene, cx + 1.5, yG + WH * 0.65, cz - HD + 0.12, 'N');
    light(scene, cx, yG + WH * 0.75, cz - HD - 0.7, 6, 16);
    // Lanternes hautes sur piliers d'entrée
    _p(scene, m.lantern, cx - 2.5, yG + WH * 0.70, cz - HD + 0.12, S);
    _p(scene, m.lantern, cx + 2.5, yG + WH * 0.70, cz - HD + 0.12, S);
    // Bannières officielles
    _p(scene, m.banner1C, cx - 2.8, yG + WH * 0.52, cz - HD + 0.06, S);
    _p(scene, m.banner1C, cx + 2.8, yG + WH * 0.52, cz - HD + 0.06, S);
    // Tonneau / caisse décorative près de l'entrée
    _p(scene, m.barrel, cx + 3.8, yG, cz - HD - 0.8);
    _p(scene, m.crate,  cx - 3.5, yG, cz - HD - 0.8);
    // Vigne sur façade E
    _p(scene, m.vine4, cx + HW, yG, cz - 2.0, W);
    _p(scene, m.vine9, cx + HW, yG, cz + 1.0, W);

    // ══════════════════════════════════════════════════════════
    //  CHAMBRE DU CONSEIL (1er étage)
    // ══════════════════════════════════════════════════════════

    // Table de conseil (3 × Large en ligne)
    for (let i = 0; i < 3; i++) {
        _p(scene, m.tableLg, cx - 2.0 + i * 2.0, yE, cz - 1.2);
    }
    // Chaises tout autour
    for (let i = -2; i <= 2; i++) {
        _p(scene, m.chair, cx + i * 1.0, yE, cz - 2.8, S);
        _p(scene, m.chair, cx + i * 1.0, yE, cz + 0.4,  N);
    }
    _p(scene, m.chair, cx + 3.3, yE, cz - 1.2, W);
    _p(scene, m.chair, cx - 3.3, yE, cz - 1.2, E);

    // Documents sur la table
    _p(scene, m.scroll1,   cx - 2.0, yE, cz - 1.2);
    _p(scene, m.scroll2,   cx + 0.5, yE, cz - 1.2);
    _p(scene, m.book5,     cx - 0.5, yE, cz - 1.2);
    _p(scene, m.bookStack, cx + 2.0, yE, cz - 1.2);
    // Candélabre triple au centre de la table
    _p(scene, m.candleTriple, cx, yE, cz - 1.2);
    // Mugs pour les conseillers
    for (const dx of [-1.5, -0.5, 0.5, 1.5]) {
        _p(scene, m.mug, cx + dx, yE, cz - 2.5);
    }

    // Bibliothèques côté S (archives du conseil)
    _p(scene, m.bookcase, cx - 2.5, yE, cz + 5.0, N);
    _p(scene, m.bookcase, cx + 0.5, yE, cz + 5.0, N);
    // Etagère avec potions / documents côté W
    _p(scene, m.shelfArch, cx - 3.8, yE + 0.65, cz - 4.8, E);
    _p(scene, m.shelfArch, cx - 3.8, yE + 1.55, cz - 4.8, E);

    // Chandelier
    _p(scene, m.chandelier, cx, yE + WH - 0.08, cz - 1.0);
    // Lumières
    light(scene, cx,       yE + WH * 0.7, cz - 1.0, 6, 16);
    light(scene, cx - 2.0, yE + WH * 0.7, cz + 4.0, 3, 9);

    // ══════════════════════════════════════════════════════════
    //  ARCHIVES & BUREAU DU SEIGNEUR (2ème étage)
    // ══════════════════════════════════════════════════════════

    // Bureau seigneurial (côté E, vue sur le nord via fenêtre)
    _p(scene, m.tableLg, cx + 2.5, y2, cz - 4.0, W);
    _p(scene, m.chair,   cx + 2.5, y2, cz - 4.8, N);
    // Documents du bureau
    _p(scene, m.scroll1,   cx + 1.8, y2, cz - 4.0);
    _p(scene, m.bookStack, cx + 2.8, y2, cz - 4.0);
    // Candélabre de bureau
    _p(scene, m.candleTriple, cx + 3.5, y2, cz - 4.0, W);

    // Archive côté W — 3 bibliothèques + cabinet
    _p(scene, m.bookcase, cx - 3.5, y2, cz - 5.0, E);
    _p(scene, m.bookcase, cx - 3.5, y2, cz - 2.5, E);
    _p(scene, m.bookcase, cx - 3.5, y2, cz + 0.0, E);
    _p(scene, m.cabinet,  cx - 3.5, y2, cz + 2.5, E);

    // Coffres avec archives
    _p(scene, m.chest, cx + 3.5, y2, cz - 5.0, W);
    _p(scene, m.chest, cx + 3.5, y2, cz - 3.0, W);
    _p(scene, m.chest, cx + 3.5, y2, cz - 1.0, W);

    // Potions / documents épars
    _p(scene, m.potionV, cx - 2.0, y2, cz + 4.5);
    _p(scene, m.scroll1, cx - 1.0, y2, cz + 4.5);

    // Chandelier archives
    _p(scene, m.chandelier, cx - 1.5, y2 + WH - 0.08, cz - 2.0);
    // Lumières
    light(scene, cx + 2.0, y2 + WH * 0.7, cz - 4.0, 3.5, 10);  // bureau
    light(scene, cx - 1.5, y2 + WH * 0.7, cz - 2.0, 4.5, 12);  // archives

    console.log('[TownHall] Mairie de Valcrest assemblée à', cx.toFixed(1), cz.toFixed(1), '✓');
}
