import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getHeight } from './world.js';

// ═══════════════════════════════════════════════════════════════
//  FREECAM — Caméra volante pour le mode édition
//
//  Touches (actives UNIQUEMENT en mode édition) :
//    WASD          — déplacement horizontal
//    Space / C     — monter / descendre
//    Shift         — vitesse ×3
//    Molette       — ajuster la vitesse de base
//    Souris        — regarder (pointer lock)
// ═══════════════════════════════════════════════════════════════
class FreeCam {
    constructor(camera, domElement) {
        this._cam  = camera;
        this._dom  = domElement;
        this._yaw   = 0;
        this._pitch = 0;
        this._speed = 8;

        this._onMove  = this._onMove.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onLock  = this._onLock.bind(this);
    }

    /** Entrée en mode édition — copie l'orientation courante de la caméra. */
    enter() {
        // Lire yaw/pitch depuis la caméra THREE actuelle
        const euler = new THREE.Euler().setFromQuaternion(
            this._cam.quaternion, 'YXZ'
        );
        this._yaw   = euler.y;
        this._pitch = euler.x;

        this._dom.addEventListener('mousemove', this._onMove);
        this._dom.addEventListener('wheel',     this._onWheel, { passive: true });
        document.addEventListener('pointerlockchange', this._onLock);
        this._dom.requestPointerLock?.();
    }

    /** Sortie du mode édition. */
    exit() {
        this._dom.removeEventListener('mousemove', this._onMove);
        this._dom.removeEventListener('wheel',     this._onWheel);
        document.removeEventListener('pointerlockchange', this._onLock);
        document.exitPointerLock?.();
    }

    _onMove(e) {
        if (document.pointerLockElement !== this._dom) return;
        this._yaw   -= e.movementX * 0.0022;
        this._pitch -= e.movementY * 0.0022;
        this._pitch  = Math.max(-1.48, Math.min(1.48, this._pitch));
    }

    _onWheel(e) {
        this._speed = Math.max(1, Math.min(60, this._speed - e.deltaY * 0.015));
    }

    _onLock() {
        // Re-request si le lock se perd accidentellement (le listener est retiré sur exit)
        // Sauf si le curseur a été libéré volontairement (V toggle)
        if (!document.pointerLockElement && !this._cursorFree) {
            setTimeout(() => this._dom.requestPointerLock?.(), 200);
        }
    }

    /** V — bascule cursor libre ↔ pointer lock en mode édition. */
    toggleCursorFree() {
        this._cursorFree = !this._cursorFree;
        if (this._cursorFree) {
            document.exitPointerLock?.();
        } else {
            this._dom.requestPointerLock?.();
        }
        return this._cursorFree;
    }

    /** Mise à jour chaque frame. keys = Set des codes clavier enfoncés. */
    update(delta, keys) {
        // Rotation
        this._cam.rotation.order = 'YXZ';
        this._cam.rotation.y     = this._yaw;
        this._cam.rotation.x     = this._pitch;
        this._cam.rotation.z     = 0;

        // Direction horizontale relative au yaw
        const fwd   = new THREE.Vector3(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));
        const right = new THREE.Vector3( Math.cos(this._yaw), 0, -Math.sin(this._yaw));
        const up    = new THREE.Vector3(0, 1, 0);

        const dir = new THREE.Vector3();
        if (keys.has('KeyW'))    dir.addScaledVector(fwd,   1);
        if (keys.has('KeyS'))    dir.addScaledVector(fwd,  -1);
        if (keys.has('KeyA'))    dir.addScaledVector(right,-1);
        if (keys.has('KeyD'))    dir.addScaledVector(right, 1);
        if (keys.has('Space'))   dir.addScaledVector(up,    1);
        if (keys.has('KeyC'))    dir.addScaledVector(up,   -1);

        if (dir.lengthSq() > 0.001) dir.normalize();

        const boost = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 3 : 1;
        this._cam.position.addScaledVector(dir, this._speed * boost * delta);
    }
}

// ═══════════════════════════════════════════════════════════════
//  BUILD_MODE.JS — Éditeur de monde en temps réel
//
//  Inspiré de Valheim (ghost/snap), Rust (catégories), Cities (export)
//
//  Touches :
//    B             — toggle Edit / Play
//    Tab / Shift+Tab — catégorie suivante / précédente
//    [ / ]         — item précédent / suivant
//    Q / E         — rotation Y (yaw) ±45°
//    Shift+Q/E     — rotation X (pitch) ±11°
//    Alt+Q/E       — rotation Z (roll) ±11°
//    R             — reset rotation
//    G             — toggle snap grille
//    Shift+G       — cycler taille grille (0.1 / 0.25 / 0.5 / 1 / 2m)
//    V             — curseur libre ↔ pointer lock
//    F / Clic      — placer
//    X             — supprimer l'objet visé
//    Ctrl+Z        — undo (dernier posé)
//    Ctrl+E        — exporter en JS dans la console
//    Suppr         — vider tous les objets placés (confirm)
// ═══════════════════════════════════════════════════════════════

const KIT    = 'assets/environment/village/';
const PROPS  = 'assets/environment/props/';
const NATURE = 'assets/environment/nature/';

// ── Catalogue complet — tous les assets des 3 packs ───────────
const CATALOG = [
    {
        name: 'Murs Brique',
        items: [
            { name: 'Mur Plein',               url: KIT + 'Wall_UnevenBrick_Straight.gltf' },
            { name: 'Fenêtre Thin Ronde',       url: KIT + 'Wall_UnevenBrick_Window_Thin_Round.gltf' },
            { name: 'Fenêtre Large Plate',      url: KIT + 'Wall_UnevenBrick_Window_Wide_Flat.gltf' },
            { name: 'Fenêtre Large Ronde',      url: KIT + 'Wall_UnevenBrick_Window_Wide_Round.gltf' },
            { name: 'Porte Plate',              url: KIT + 'Wall_UnevenBrick_Door_Flat.gltf' },
            { name: 'Porte Ronde',              url: KIT + 'Wall_UnevenBrick_Door_Round.gltf' },
        ],
    },
    {
        name: 'Murs Plâtre',
        items: [
            { name: 'Mur Plein',               url: KIT + 'Wall_Plaster_Straight.gltf' },
            { name: 'Mur Plein Base',           url: KIT + 'Wall_Plaster_Straight_Base.gltf' },
            { name: 'Mur Plein Gauche',         url: KIT + 'Wall_Plaster_Straight_L.gltf' },
            { name: 'Mur Plein Droite',         url: KIT + 'Wall_Plaster_Straight_R.gltf' },
            { name: 'Fenêtre Thin Ronde',       url: KIT + 'Wall_Plaster_Window_Thin_Round.gltf' },
            { name: 'Fenêtre Large Plate',      url: KIT + 'Wall_Plaster_Window_Wide_Flat.gltf' },
            { name: 'Fenêtre Large Plate 2',    url: KIT + 'Wall_Plaster_Window_Wide_Flat2.gltf' },
            { name: 'Fenêtre Large Ronde',      url: KIT + 'Wall_Plaster_Window_Wide_Round.gltf' },
            { name: 'Grille Bois',              url: KIT + 'Wall_Plaster_WoodGrid.gltf' },
            { name: 'Porte Plate',              url: KIT + 'Wall_Plaster_Door_Flat.gltf' },
            { name: 'Porte Ronde',              url: KIT + 'Wall_Plaster_Door_Round.gltf' },
            { name: 'Porte Ronde Inset',        url: KIT + 'Wall_Plaster_Door_RoundInset.gltf' },
            { name: 'Arche',                    url: KIT + 'Wall_Arch.gltf' },
            { name: 'Plinthe',                  url: KIT + 'Wall_BottomCover.gltf' },
        ],
    },
    {
        name: 'Coins & Extérieur',
        items: [
            { name: 'Coin Ext Brique',          url: KIT + 'Corner_Exterior_Brick.gltf' },
            { name: 'Coin Ext Large Brique',    url: KIT + 'Corner_ExteriorWide_Brick.gltf' },
            { name: 'Coin Ext Bois',            url: KIT + 'Corner_Exterior_Wood.gltf' },
            { name: 'Coin Ext Large Bois',      url: KIT + 'Corner_ExteriorWide_Wood.gltf' },
            { name: 'Coin Top Down',            url: KIT + 'Corner_Exterior_TopDown.gltf' },
            { name: 'Coin Top Only',            url: KIT + 'Corner_Exterior_TopOnly.gltf' },
            { name: 'Coin Int Grand',           url: KIT + 'Corner_Interior_Big.gltf' },
            { name: 'Coin Int Petit',           url: KIT + 'Corner_Interior_Small.gltf' },
        ],
    },
    {
        name: 'Sols',
        items: [
            { name: 'Sol Brique',               url: KIT + 'Floor_Brick.gltf' },
            { name: 'Sol Brique Rouge',         url: KIT + 'Floor_RedBrick.gltf' },
            { name: 'Sol Brique Irrég.',        url: KIT + 'Floor_UnevenBrick.gltf' },
            { name: 'Sol Bois Foncé',           url: KIT + 'Floor_WoodDark.gltf' },
            { name: 'Sol Bois Foncé Demi 1',    url: KIT + 'Floor_WoodDark_Half1.gltf' },
            { name: 'Sol Bois Foncé Demi 2',    url: KIT + 'Floor_WoodDark_Half2.gltf' },
            { name: 'Sol Bois Foncé Demi 3',    url: KIT + 'Floor_WoodDark_Half3.gltf' },
            { name: 'Surplomb Coin Foncé',      url: KIT + 'Floor_WoodDark_OverhangCorner.gltf' },
            { name: 'Surplomb Coin Foncé 2',    url: KIT + 'Floor_WoodDark_OverhangCorner2.gltf' },
            { name: 'Sol Bois Clair',           url: KIT + 'Floor_WoodLight.gltf' },
            { name: 'Surplomb Coin Clair',      url: KIT + 'Floor_WoodLight_OverhangCorner.gltf' },
            { name: 'Surplomb Coin Clair 2',    url: KIT + 'Floor_WoodLight_OverhangCorner2.gltf' },
        ],
    },
    {
        name: 'Toiture',
        items: [
            { name: 'Toit Modulaire',           url: KIT + 'Roof_Modular_RoundTiles.gltf' },
            { name: 'Tuile 2×1',                url: KIT + 'Roof_RoundTile_2x1.gltf' },
            { name: 'Tuile 2×1 Long',           url: KIT + 'Roof_RoundTile_2x1_Long.gltf' },
            { name: 'Toit 4×4',                 url: KIT + 'Roof_RoundTiles_4x4.gltf' },
            { name: 'Toit 4×6',                 url: KIT + 'Roof_RoundTiles_4x6.gltf' },
            { name: 'Toit 4×8',                 url: KIT + 'Roof_RoundTiles_4x8.gltf' },
            { name: 'Toit 6×4',                 url: KIT + 'Roof_RoundTiles_6x4.gltf' },
            { name: 'Toit 6×6',                 url: KIT + 'Roof_RoundTiles_6x6.gltf' },
            { name: 'Toit 6×8',                 url: KIT + 'Roof_RoundTiles_6x8.gltf' },
            { name: 'Toit 6×10',                url: KIT + 'Roof_RoundTiles_6x10.gltf' },
            { name: 'Toit 6×12',                url: KIT + 'Roof_RoundTiles_6x12.gltf' },
            { name: 'Toit 6×14',                url: KIT + 'Roof_RoundTiles_6x14.gltf' },
            { name: 'Toit 8×8',                 url: KIT + 'Roof_RoundTiles_8x8.gltf' },
            { name: 'Toit 8×10',                url: KIT + 'Roof_RoundTiles_8x10.gltf' },
            { name: 'Toit 8×12',                url: KIT + 'Roof_RoundTiles_8x12.gltf' },
            { name: 'Toit 8×14',                url: KIT + 'Roof_RoundTiles_8x14.gltf' },
            { name: 'Toit 2×4',                 url: KIT + 'Roof_2x4_RoundTile.gltf' },
            { name: 'Toit Lucarne',             url: KIT + 'Roof_Dormer_RoundTile.gltf' },
            { name: 'Toit Tour',                url: KIT + 'Roof_Tower_RoundTiles.gltf' },
            { name: 'Toit Bois 2×1',            url: KIT + 'Roof_Wooden_2x1.gltf' },
            { name: 'Toit Bois Centre',         url: KIT + 'Roof_Wooden_2x1_Center.gltf' },
            { name: 'Toit Bois Centre Miroir',  url: KIT + 'Roof_Wooden_2x1_Center_Mirror.gltf' },
            { name: 'Toit Bois Coin',           url: KIT + 'Roof_Wooden_2x1_Corner.gltf' },
            { name: 'Toit Bois G',              url: KIT + 'Roof_Wooden_2x1_L.gltf' },
            { name: 'Toit Bois Milieu',         url: KIT + 'Roof_Wooden_2x1_Middle.gltf' },
            { name: 'Toit Bois D',              url: KIT + 'Roof_Wooden_2x1_R.gltf' },
            { name: 'Toit Rondin',              url: KIT + 'Roof_Log.gltf' },
            { name: 'Pignon Brique 2',          url: KIT + 'Roof_Front_Brick2.gltf' },
            { name: 'Pignon Brique 4',          url: KIT + 'Roof_Front_Brick4.gltf' },
            { name: 'Pignon Brique 4 G',        url: KIT + 'Roof_Front_Brick4_Half_L.gltf' },
            { name: 'Pignon Brique 4 D',        url: KIT + 'Roof_Front_Brick4_Half_R.gltf' },
            { name: 'Pignon Brique 6',          url: KIT + 'Roof_Front_Brick6.gltf' },
            { name: 'Pignon Brique 6 G',        url: KIT + 'Roof_Front_Brick6_Half_L.gltf' },
            { name: 'Pignon Brique 6 D',        url: KIT + 'Roof_Front_Brick6_Half_R.gltf' },
            { name: 'Pignon Brique 8',          url: KIT + 'Roof_Front_Brick8.gltf' },
            { name: 'Pignon Brique 8 G',        url: KIT + 'Roof_Front_Brick8_Half_L.gltf' },
            { name: 'Pignon Brique 8 D',        url: KIT + 'Roof_Front_Brick8_Half_R.gltf' },
            { name: 'Supports Devant',          url: KIT + 'Roof_FrontSupports.gltf' },
            { name: 'Support Toit',             url: KIT + 'Roof_Support2.gltf' },
        ],
    },
    {
        name: 'Avant-toits',
        items: [
            { name: 'Avant-toit Plâtre Court',  url: KIT + 'Overhang_Plaster_Short.gltf' },
            { name: 'Avant-toit Plâtre Long',   url: KIT + 'Overhang_Plaster_Long.gltf' },
            { name: 'Coin Plâtre',              url: KIT + 'Overhang_Plaster_Corner.gltf' },
            { name: 'Coin Plâtre Avant',        url: KIT + 'Overhang_Plaster_Corner_Front.gltf' },
            { name: 'Toit Incliné Plâtre',      url: KIT + 'Overhang_RoofIncline_Plaster.gltf' },
            { name: 'Toit Plat Plâtre',         url: KIT + 'Overhang_Roof_Plaster.gltf' },
            { name: 'Côté Plâtre Long G',       url: KIT + 'Overhang_Side_Plaster_Long_L.gltf' },
            { name: 'Côté Plâtre Long D',       url: KIT + 'Overhang_Side_Plaster_Long_R.gltf' },
            { name: 'Côté Plâtre Court G',      url: KIT + 'Overhang_Side_Plaster_Short_L.gltf' },
            { name: 'Côté Plâtre Court D',      url: KIT + 'Overhang_Side_Plaster_Short_R.gltf' },
            { name: 'Avant-toit Brique Court',  url: KIT + 'Overhang_UnevenBrick_Short.gltf' },
            { name: 'Avant-toit Brique Long',   url: KIT + 'Overhang_UnevenBrick_Long.gltf' },
            { name: 'Coin Brique',              url: KIT + 'Overhang_UnevenBrick_Corner.gltf' },
            { name: 'Coin Brique Avant',        url: KIT + 'Overhang_UnevenBrick_Corner_Front.gltf' },
            { name: 'Toit Incliné Brique',      url: KIT + 'Overhang_RoofIncline_UnevenBricks.gltf' },
            { name: 'Toit Plat Brique',         url: KIT + 'Overhang_Roof_UnevenBricks.gltf' },
            { name: 'Côté Brique Long G',       url: KIT + 'Overhang_Side_UnevenBrick_Long_L.gltf' },
            { name: 'Côté Brique Long D',       url: KIT + 'Overhang_Side_UnevenBrick_Long_R.gltf' },
            { name: 'Côté Brique Court G',      url: KIT + 'Overhang_Side_UnevenBrick_Short_L.gltf' },
            { name: 'Côté Brique Court D',      url: KIT + 'Overhang_Side_UnevenBrick_Short_R.gltf' },
        ],
    },
    {
        name: 'Portes & Cadres',
        items: [
            { name: 'Porte 1 Plate',            url: KIT + 'Door_1_Flat.gltf' },
            { name: 'Porte 1 Ronde',            url: KIT + 'Door_1_Round.gltf' },
            { name: 'Porte 2 Plate',            url: KIT + 'Door_2_Flat.gltf' },
            { name: 'Porte 2 Ronde',            url: KIT + 'Door_2_Round.gltf' },
            { name: 'Porte 4 Plate',            url: KIT + 'Door_4_Flat.gltf' },
            { name: 'Porte 4 Ronde',            url: KIT + 'Door_4_Round.gltf' },
            { name: 'Porte 8 Plate',            url: KIT + 'Door_8_Flat.gltf' },
            { name: 'Porte 8 Ronde',            url: KIT + 'Door_8_Round.gltf' },
            { name: 'Cadre Plat Brique',        url: KIT + 'DoorFrame_Flat_Brick.gltf' },
            { name: 'Cadre Plat Bois Foncé',    url: KIT + 'DoorFrame_Flat_WoodDark.gltf' },
            { name: 'Cadre Rond Brique',        url: KIT + 'DoorFrame_Round_Brick.gltf' },
            { name: 'Cadre Rond Bois Foncé',    url: KIT + 'DoorFrame_Round_WoodDark.gltf' },
        ],
    },
    {
        name: 'Fenêtres & Volets',
        items: [
            { name: 'Fenêtre Thin Plate',       url: KIT + 'Window_Thin_Flat1.gltf' },
            { name: 'Fenêtre Thin Ronde',       url: KIT + 'Window_Thin_Round1.gltf' },
            { name: 'Fenêtre Large Plate',      url: KIT + 'Window_Wide_Flat1.gltf' },
            { name: 'Fenêtre Large Ronde',      url: KIT + 'Window_Wide_Round1.gltf' },
            { name: 'Fenêtre Toit Thin',        url: KIT + 'Window_Roof_Thin.gltf' },
            { name: 'Fenêtre Toit Large',       url: KIT + 'Window_Roof_Wide.gltf' },
            { name: 'Volet Thin Plat Fermé',    url: KIT + 'WindowShutters_Thin_Flat_Closed.gltf' },
            { name: 'Volet Thin Plat Ouvert',   url: KIT + 'WindowShutters_Thin_Flat_Open.gltf' },
            { name: 'Volet Thin Rond Fermé',    url: KIT + 'WindowShutters_Thin_Round_Closed.gltf' },
            { name: 'Volet Thin Rond Ouvert',   url: KIT + 'WindowShutters_Thin_Round_Open.gltf' },
            { name: 'Volet Large Plat Fermé',   url: KIT + 'WindowShutters_Wide_Flat_Closed.gltf' },
            { name: 'Volet Large Plat Ouvert',  url: KIT + 'WindowShutters_Wide_Flat_Open.gltf' },
            { name: 'Volet Large Rond Fermé',   url: KIT + 'WindowShutters_Wide_Round_Closed.gltf' },
            { name: 'Volet Large Rond Ouvert',  url: KIT + 'WindowShutters_Wide_Round_Open.gltf' },
        ],
    },
    {
        name: 'Escaliers',
        items: [
            { name: 'Escalier Int Rails',       url: KIT + 'Stair_Interior_Rails.gltf' },
            { name: 'Escalier Int Simple',      url: KIT + 'Stair_Interior_Simple.gltf' },
            { name: 'Escalier Int Plein',       url: KIT + 'Stair_Interior_Solid.gltf' },
            { name: 'Escalier Int Étendu',      url: KIT + 'Stair_Interior_SolidExtended.gltf' },
            { name: 'Escalier Ext Droit',       url: KIT + 'Stairs_Exterior_Straight.gltf' },
            { name: 'Escalier Ext Centre',      url: KIT + 'Stairs_Exterior_Straight_Center.gltf' },
            { name: 'Escalier Ext G',           url: KIT + 'Stairs_Exterior_Straight_L.gltf' },
            { name: 'Escalier Ext D',           url: KIT + 'Stairs_Exterior_Straight_R.gltf' },
            { name: 'Palier',                   url: KIT + 'Stairs_Exterior_Platform.gltf' },
            { name: 'Palier 45°',               url: KIT + 'Stairs_Exterior_Platform45.gltf' },
            { name: 'Palier 45° Clean',         url: KIT + 'Stairs_Exterior_Platform45Clean.gltf' },
            { name: 'Palier U',                 url: KIT + 'Stairs_Exterior_PlatformU.gltf' },
            { name: 'Côtés Escalier',           url: KIT + 'Stairs_Exterior_Sides.gltf' },
            { name: 'Côtés Escalier 45°',       url: KIT + 'Stairs_Exterior_Sides45.gltf' },
            { name: 'Côtés Escalier U',         url: KIT + 'Stairs_Exterior_SidesU.gltf' },
            { name: 'Côté Escalier Simple',     url: KIT + 'Stairs_Exterior_SingleSide.gltf' },
            { name: 'Côté Épais',               url: KIT + 'Stairs_Exterior_SingleSideThick.gltf' },
            { name: 'Côté Palier',              url: KIT + 'Stairs_Exterior_SidePlatform.gltf' },
            { name: 'Sans 1re Marche',          url: KIT + 'Stairs_Exterior_NoFirstStep.gltf' },
        ],
    },
    {
        name: 'Balcons & Trappes',
        items: [
            { name: 'Balcon Croisé Coin',       url: KIT + 'Balcony_Cross_Corner.gltf' },
            { name: 'Balcon Croisé Droit',      url: KIT + 'Balcony_Cross_Straight.gltf' },
            { name: 'Balcon Simple Coin',       url: KIT + 'Balcony_Simple_Corner.gltf' },
            { name: 'Balcon Simple Droit',      url: KIT + 'Balcony_Simple_Straight.gltf' },
            { name: 'Cache Trou 90°',           url: KIT + 'HoleCover_90Angle.gltf' },
            { name: 'Cache Trou Demi',          url: KIT + 'HoleCover_90Half.gltf' },
            { name: 'Cache Trou Escalier',      url: KIT + 'HoleCover_90Stairs.gltf' },
            { name: 'Cache Trou Droit',         url: KIT + 'HoleCover_Straight.gltf' },
            { name: 'Cache Trou Droit Demi',    url: KIT + 'HoleCover_StraightHalf.gltf' },
        ],
    },
    {
        name: 'Accessoires Village',
        items: [
            { name: 'Cheminée 1',               url: KIT + 'Prop_Chimney.gltf' },
            { name: 'Cheminée 2',               url: KIT + 'Prop_Chimney2.gltf' },
            { name: 'Caisse',                   url: KIT + 'Prop_Crate.gltf' },
            { name: 'Chariot',                  url: KIT + 'Prop_Wagon.gltf' },
            { name: 'Support',                  url: KIT + 'Prop_Support.gltf' },
            { name: 'Brique 1',                 url: KIT + 'Prop_Brick1.gltf' },
            { name: 'Brique 2',                 url: KIT + 'Prop_Brick2.gltf' },
            { name: 'Brique 3',                 url: KIT + 'Prop_Brick3.gltf' },
            { name: 'Brique 4',                 url: KIT + 'Prop_Brick4.gltf' },
            { name: 'Vigne 1',                  url: KIT + 'Prop_Vine1.gltf' },
            { name: 'Vigne 2',                  url: KIT + 'Prop_Vine2.gltf' },
            { name: 'Vigne 4',                  url: KIT + 'Prop_Vine4.gltf' },
            { name: 'Vigne 5',                  url: KIT + 'Prop_Vine5.gltf' },
            { name: 'Vigne 6',                  url: KIT + 'Prop_Vine6.gltf' },
            { name: 'Vigne 9',                  url: KIT + 'Prop_Vine9.gltf' },
            { name: 'Clôture Bois Simple',      url: KIT + 'Prop_WoodenFence_Single.gltf' },
            { name: 'Clôture Bois Ext 1',       url: KIT + 'Prop_WoodenFence_Extension1.gltf' },
            { name: 'Clôture Bois Ext 2',       url: KIT + 'Prop_WoodenFence_Extension2.gltf' },
            { name: 'Clôture Métal Simple',     url: KIT + 'Prop_MetalFence_Simple.gltf' },
            { name: 'Clôture Métal Ornement',   url: KIT + 'Prop_MetalFence_Ornament.gltf' },
            { name: 'Bordure Ext Coin',         url: KIT + 'Prop_ExteriorBorder_Corner.gltf' },
            { name: 'Bordure Ext 1',            url: KIT + 'Prop_ExteriorBorder_Straight1.gltf' },
            { name: 'Bordure Ext 2',            url: KIT + 'Prop_ExteriorBorder_Straight2.gltf' },
        ],
    },
    {
        name: 'Mobilier',
        items: [
            { name: 'Table Grande',             url: PROPS + 'Table_Large.gltf' },
            { name: 'Chaise',                   url: PROPS + 'Chair_1.gltf' },
            { name: 'Tabouret',                 url: PROPS + 'Stool.gltf' },
            { name: 'Banc',                     url: PROPS + 'Bench.gltf' },
            { name: 'Lit Twin 1',               url: PROPS + 'Bed_Twin1.gltf' },
            { name: 'Lit Twin 2',               url: PROPS + 'Bed_Twin2.gltf' },
            { name: 'Table de Nuit',            url: PROPS + 'Nightstand_Shelf.gltf' },
            { name: 'Armoire',                  url: PROPS + 'Cabinet.gltf' },
            { name: 'Porte-manteau',            url: PROPS + 'Peg_Rack.gltf' },
            { name: 'Établi',                   url: PROPS + 'Workbench.gltf' },
            { name: 'Établi Tiroirs',           url: PROPS + 'Workbench_Drawers.gltf' },
            { name: 'Mannequin',                url: PROPS + 'Dummy.gltf' },
            { name: 'Support Armes',            url: PROPS + 'WeaponStand.gltf' },
            { name: 'Étal Vide',                url: PROPS + 'Stall_Empty.gltf' },
            { name: 'Étal Chariot',             url: PROPS + 'Stall_Cart_Empty.gltf' },
            { name: 'Chaudron',                 url: PROPS + 'Cauldron.gltf' },
        ],
    },
    {
        name: 'Rangements',
        items: [
            { name: 'Tonneau',                  url: PROPS + 'Barrel.gltf' },
            { name: 'Support Tonneau',          url: PROPS + 'Barrel_Holder.gltf' },
            { name: 'Tonneau Pommes',           url: PROPS + 'Barrel_Apples.gltf' },
            { name: 'Coffre Bois',              url: PROPS + 'Chest_Wood.gltf' },
            { name: 'Étagère Arche',            url: PROPS + 'Shelf_Arch.gltf' },
            { name: 'Étagère Simple',           url: PROPS + 'Shelf_Simple.gltf' },
            { name: 'Étagère Bouteilles',       url: PROPS + 'Shelf_Small_Bottles.gltf' },
            { name: 'Bibliothèque',             url: PROPS + 'Bookcase_2.gltf' },
            { name: 'Caisse Métal',             url: PROPS + 'Crate_Metal.gltf' },
            { name: 'Caisse Bois',              url: PROPS + 'Crate_Wooden.gltf' },
            { name: 'Seau Métal',               url: PROPS + 'Bucket_Metal.gltf' },
            { name: 'Seau Bois',                url: PROPS + 'Bucket_Wooden_1.gltf' },
            { name: 'Cage Petite',              url: PROPS + 'Cage_Small.gltf' },
            { name: 'Caisse Pommes',            url: PROPS + 'FarmCrate_Apple.gltf' },
            { name: 'Caisse Carottes',          url: PROPS + 'FarmCrate_Carrot.gltf' },
            { name: 'Caisse Vide',              url: PROPS + 'FarmCrate_Empty.gltf' },
        ],
    },
    {
        name: 'Lumières & Déco',
        items: [
            { name: 'Chandelier',               url: PROPS + 'Chandelier.gltf' },
            { name: 'Lanterne Murale',          url: PROPS + 'Lantern_Wall.gltf' },
            { name: 'Torche Métal',             url: PROPS + 'Torch_Metal.gltf' },
            { name: 'Chandelle',                url: PROPS + 'CandleStick.gltf' },
            { name: 'Chandelle Pied',           url: PROPS + 'CandleStick_Stand.gltf' },
            { name: 'Chandelle Triple',         url: PROPS + 'CandleStick_Triple.gltf' },
            { name: 'Bougie 1',                 url: PROPS + 'Candle_1.gltf' },
            { name: 'Bougie 2',                 url: PROPS + 'Candle_2.gltf' },
            { name: 'Vase 2',                   url: PROPS + 'Vase_2.gltf' },
            { name: 'Vase 4',                   url: PROPS + 'Vase_4.gltf' },
            { name: 'Vase Débris',              url: PROPS + 'Vase_Rubble_Medium.gltf' },
            { name: 'Pot',                      url: PROPS + 'Pot_1.gltf' },
            { name: 'Pot Couvercle',            url: PROPS + 'Pot_1_Lid.gltf' },
            { name: 'Bannière 1',               url: PROPS + 'Banner_1.gltf' },
            { name: 'Bannière 1 Tissu',         url: PROPS + 'Banner_1_Cloth.gltf' },
            { name: 'Bannière 2',               url: PROPS + 'Banner_2.gltf' },
            { name: 'Bannière 2 Tissu',         url: PROPS + 'Banner_2_Cloth.gltf' },
            { name: 'Corde 1',                  url: PROPS + 'Rope_1.gltf' },
            { name: 'Corde 2',                  url: PROPS + 'Rope_2.gltf' },
            { name: 'Corde 3',                  url: PROPS + 'Rope_3.gltf' },
            { name: 'Chaîne',                   url: PROPS + 'Chain_Coil.gltf' },
        ],
    },
    {
        name: 'Livres & Écrits',
        items: [
            { name: 'Livres Moyens 1',          url: PROPS + 'BookGroup_Medium_1.gltf' },
            { name: 'Livres Moyens 2',          url: PROPS + 'BookGroup_Medium_2.gltf' },
            { name: 'Livres Moyens 3',          url: PROPS + 'BookGroup_Medium_3.gltf' },
            { name: 'Livres Petits 1',          url: PROPS + 'BookGroup_Small_1.gltf' },
            { name: 'Livres Petits 2',          url: PROPS + 'BookGroup_Small_2.gltf' },
            { name: 'Livres Petits 3',          url: PROPS + 'BookGroup_Small_3.gltf' },
            { name: 'Lutrin',                   url: PROPS + 'BookStand.gltf' },
            { name: 'Livre 5',                  url: PROPS + 'Book_5.gltf' },
            { name: 'Livre 7',                  url: PROPS + 'Book_7.gltf' },
            { name: 'Livre Simple',             url: PROPS + 'Book_Simplified_Single.gltf' },
            { name: 'Pile Livres 1',            url: PROPS + 'Book_Stack_1.gltf' },
            { name: 'Pile Livres 2',            url: PROPS + 'Book_Stack_2.gltf' },
            { name: 'Parchemin 1',              url: PROPS + 'Scroll_1.gltf' },
            { name: 'Parchemin 2',              url: PROPS + 'Scroll_2.gltf' },
        ],
    },
    {
        name: 'Outils & Armes',
        items: [
            { name: 'Enclume',                  url: PROPS + 'Anvil.gltf' },
            { name: 'Enclume Rondin',           url: PROPS + 'Anvil_Log.gltf' },
            { name: 'Hache Bronze',             url: PROPS + 'Axe_Bronze.gltf' },
            { name: 'Pioche Bronze',            url: PROPS + 'Pickaxe_Bronze.gltf' },
            { name: 'Épée Bronze',              url: PROPS + 'Sword_Bronze.gltf' },
            { name: 'Pierre à Aiguiser',        url: PROPS + 'Whetstone.gltf' },
            { name: 'Bouclier Bois',            url: PROPS + 'Shield_Wooden.gltf' },
            { name: 'Fourchette',               url: PROPS + 'Table_Fork.gltf' },
            { name: 'Couteau',                  url: PROPS + 'Table_Knife.gltf' },
            { name: 'Cuillère',                 url: PROPS + 'Table_Spoon.gltf' },
            { name: 'Assiette',                 url: PROPS + 'Table_Plate.gltf' },
        ],
    },
    {
        name: 'Objets & Provisions',
        items: [
            { name: 'Mug',                      url: PROPS + 'Mug.gltf' },
            { name: 'Calice',                   url: PROPS + 'Chalice.gltf' },
            { name: 'Bouteille',                url: PROPS + 'Bottle_1.gltf' },
            { name: 'Petite Bouteille',         url: PROPS + 'SmallBottle.gltf' },
            { name: 'Petites Bouteilles',       url: PROPS + 'SmallBottles_1.gltf' },
            { name: 'Potion 1',                 url: PROPS + 'Potion_1.gltf' },
            { name: 'Potion 2',                 url: PROPS + 'Potion_2.gltf' },
            { name: 'Potion 4',                 url: PROPS + 'Potion_4.gltf' },
            { name: 'Pièce',                    url: PROPS + 'Coin.gltf' },
            { name: 'Tas Pièces',               url: PROPS + 'Coin_Pile.gltf' },
            { name: 'Tas Pièces 2',             url: PROPS + 'Coin_Pile_2.gltf' },
            { name: 'Clé Or',                   url: PROPS + 'Key_Gold.gltf' },
            { name: 'Clé Métal',                url: PROPS + 'Key_Metal.gltf' },
            { name: 'Bourse',                   url: PROPS + 'Pouch_Large.gltf' },
            { name: 'Sac',                      url: PROPS + 'Bag.gltf' },
            { name: 'Carotte',                  url: PROPS + 'Carrot.gltf' },
        ],
    },
    {
        name: 'Végétation',
        items: [
            { name: 'Bouleau 1',                url: NATURE + 'BirchTree_1.gltf' },
            { name: 'Bouleau 2',                url: NATURE + 'BirchTree_2.gltf' },
            { name: 'Bouleau 3',                url: NATURE + 'BirchTree_3.gltf' },
            { name: 'Bouleau 4',                url: NATURE + 'BirchTree_4.gltf' },
            { name: 'Bouleau 5',                url: NATURE + 'BirchTree_5.gltf' },
            { name: 'Érable 1',                 url: NATURE + 'MapleTree_1.gltf' },
            { name: 'Érable 2',                 url: NATURE + 'MapleTree_2.gltf' },
            { name: 'Érable 3',                 url: NATURE + 'MapleTree_3.gltf' },
            { name: 'Érable 4',                 url: NATURE + 'MapleTree_4.gltf' },
            { name: 'Érable 5',                 url: NATURE + 'MapleTree_5.gltf' },
            { name: 'Arbre Mort 1',             url: NATURE + 'DeadTree_1.gltf' },
            { name: 'Arbre Mort 2',             url: NATURE + 'DeadTree_2.gltf' },
            { name: 'Arbre Mort 3',             url: NATURE + 'DeadTree_3.gltf' },
            { name: 'Arbre Mort 4',             url: NATURE + 'DeadTree_4.gltf' },
            { name: 'Arbre Mort 5',             url: NATURE + 'DeadTree_5.gltf' },
            { name: 'Arbre Mort 6',             url: NATURE + 'DeadTree_6.gltf' },
            { name: 'Arbre Mort 7',             url: NATURE + 'DeadTree_7.gltf' },
            { name: 'Arbre Mort 8',             url: NATURE + 'DeadTree_8.gltf' },
            { name: 'Arbre Mort 9',             url: NATURE + 'DeadTree_9.gltf' },
            { name: 'Arbre Mort 10',            url: NATURE + 'DeadTree_10.gltf' },
            { name: 'Buisson',                  url: NATURE + 'Bush.gltf' },
            { name: 'Buisson Fleurs',           url: NATURE + 'Bush_Flowers.gltf' },
            { name: 'Grand Buisson',            url: NATURE + 'Bush_Large.gltf' },
            { name: 'Grand Buisson Fleurs',     url: NATURE + 'Bush_Large_Flowers.gltf' },
            { name: 'Petit Buisson',            url: NATURE + 'Bush_Small.gltf' },
            { name: 'Petit Buisson Fleurs',     url: NATURE + 'Bush_Small_Flowers.gltf' },
            { name: 'Fleur 1',                  url: NATURE + 'Flower_1.gltf' },
            { name: 'Fleur 1 Touffue',          url: NATURE + 'Flower_1_Clump.gltf' },
            { name: 'Fleur 2',                  url: NATURE + 'Flower_2.gltf' },
            { name: 'Fleur 2 Touffue',          url: NATURE + 'Flower_2_Clump.gltf' },
            { name: 'Fleur 3 Touffue',          url: NATURE + 'Flower_3_Clump.gltf' },
            { name: 'Fleur 4 Touffue',          url: NATURE + 'Flower_4_Clump.gltf' },
            { name: 'Fleur 5 Touffue',          url: NATURE + 'Flower_5_Clump.gltf' },
            { name: 'Grande Herbe',             url: NATURE + 'Grass_Large.gltf' },
            { name: 'Grande Herbe Ext.',        url: NATURE + 'Grass_Large_Extruded.gltf' },
            { name: 'Petite Herbe',             url: NATURE + 'Grass_Small.gltf' },
        ],
    },
];

const SNAP_SIZES  = [0.1, 0.25, 0.5, 1.0, 2.0];
const GHOST_ALPHA = 0.42;
const SAVE_KEY         = 'darkrpg_build_v1';
const SAVE_HOTBAR_KEY  = 'darkrpg_build_hotbar_v1';
// v2 : terrain désormais déterministe (seed fixe dans world.js) → clés Y stables
// Les clés v1/v2 (terrain aléatoire) sont abandonnées intentionnellement.
const SAVE_WORLD_KEY       = 'darkrpg_world_dels_v2';
const SAVE_WORLD_TRANS_KEY = 'darkrpg_world_trans_v3';
const ROT_STEP_Y  = Math.PI / 4;          // 45°
const ROT_STEP_XZ = Math.PI / 16;         // ~11°

// Couleur par catégorie (même ordre que CATALOG)
const CAT_COLORS = [
    '#c87840', // Murs Brique
    '#d4b880', // Murs Plâtre
    '#b06030', // Coins & Extérieur
    '#6090c8', // Sols
    '#c04040', // Toiture
    '#a03030', // Avant-toits
    '#805090', // Portes & Cadres
    '#6060a0', // Fenêtres & Volets
    '#c8a030', // Escaliers
    '#708050', // Balcons & Trappes
    '#988840', // Accessoires Village
    '#4888c0', // Mobilier
    '#805020', // Rangements
    '#c0b840', // Lumières & Déco
    '#507890', // Livres & Écrits
    '#a04040', // Outils & Armes
    '#50a080', // Objets & Provisions
    '#408060', // Végétation
];

// ── Couleur du ghost : vert=OK, rouge=bloqué (futur) ──────────
const MAT_GHOST_OK  = new THREE.MeshLambertMaterial({
    color: 0x88ffaa, transparent: true, opacity: GHOST_ALPHA, depthWrite: false,
});

// ═══════════════════════════════════════════════════════════════
export class BuildMode {

    constructor(scene, camera, domElement, camCtrl) {
        this._scene    = scene;
        this._camera   = camera;
        this._camCtrl  = camCtrl;
        this._freeCam  = new FreeCam(camera, domElement);
        this._loader   = new GLTFLoader();

        // État
        this._active   = false;
        this._catIdx   = 0;
        this._itemIdx  = 0;

        // Rotation accumulée
        this._rotY = 0;
        this._rotX = 0;
        this._rotZ = 0;

        // Snap
        this._snapEnabled = true;
        this._snapIdx     = 1;   // 0.5m par défaut

        // Ghost (preview)
        this._ghost    = null;
        this._ghostUrl = null;
        this._cache    = {};     // url → THREE.Object3D (référence loader)

        // Objets placés
        this._placed    = [];    // données sérialisables
        this._placed3d  = [];    // THREE.Object3D correspondants

        // Raycaster pour placement (far=30) + raycaster pour picking (far=Infinity)
        this._ray = new THREE.Raycaster();
        this._ray.far = 30;
        this._rayOrigin = new THREE.Vector3();
        this._rayDir    = new THREE.Vector3();
        this._pickRay   = new THREE.Raycaster();

        // Hauteur manuelle (molette Shift)
        this._heightOffset = 0;

        // Verrou plancher (H) — force le Y de placement à un niveau fixe
        this._floorLocked  = false;
        this._floorY       = 0;
        this._floorPlane   = null;   // mesh visuel semi-transparent

        // Pile d'annulation (max 50 actions)
        this._undoStack = [];

        // Slot rapide (● avant le 1) — rempli par Shift+clic gauche sur un objet
        this._quickSlot   = null;
        this._quickActive = false;

        // Sélection / déplacement groupé
        this._groupSel        = [];   // { obj, entry, url, origMats, origPos, origRot, offset, origKey }
        this._groupGhosts     = [];   // conservé pour compat. undo (vide dans le nouveau flux)
        this._groupRotDelta   = 0;    // rotation Y accumulée du groupe
        this._groupHeightOff  = 0;   // décalage hauteur du groupe
        this._groupCenter     = new THREE.Vector3();
        this._isMoving        = false;  // true = déplacement en cours (objets suivent le curseur)
        this._lastGroupObjects = [];   // Alt+R : restaurer la dernière sélection
        this._axisLock        = null;  // 'x' | 'z' | null — verrouillage d'axe (X/Z keys)
        this._axisLockOrigin  = new THREE.Vector3();  // position de référence quand le verrou est activé
        this._surfaceSnap     = false; // N — snap face/normale pour cadres de porte/fenêtre
        this._ghostBboxHalf   = new THREE.Vector3(); // demi-taille du ghost (cache)

        // Mode placement ↔ sélection (Tab)
        this._selectionMode = false;   // false = placement, true = sélection

        // Hotbar — 10 slots, chaque slot = { catIdx, itemIdx, name, url } ou null
        this._hotbar     = new Array(10).fill(null);
        this._hotbarSlot = 0;   // slot actif (0-9)

        // Menu inventaire
        this._invOpen        = false;
        this._invCatIdx      = 0;
        this._invHoveredItem = null;   // dernier item survolé dans la grille

        // Suppressions monde (objets de la scène non placés par BuildMode)
        this._deletedWorldKeys = new Set();
        this._pendingWorldDels = new Set();
        this._worldScanAge     = 0;

        // Transforms monde (déplacements/rotations d'objets non placés par BuildMode)
        this._worldTransforms   = new Map();  // origKey → {key,x,y,z,rx,ry,rz}
        this._pendingWorldTrans = new Map();  // origKey → transform à appliquer (async)

        this._hud     = this._buildHUD();
        this._hotbarEl = this._buildHotbar();
        this._invEl    = this._buildInventory();
        this._$crosshair = this._buildCrosshair();
        this._setupKeys();
        this._loadSaved();
        this._loadHotbar();
        this._loadWorldDeletions();
        this._loadWorldTransforms();
    }

    // ── Public ─────────────────────────────────────────────────
    get active() { return this._active; }

    toggle() {
        this._active = !this._active;

        if (this._active) {
            // ── Entrer en mode édition ─────────────────────────
            this._selectionMode = false;  // toujours démarrer en mode placement
            this._camCtrl.setEditMode(true);
            this._freeCam.enter();
            this._hud.root.style.display = 'flex';
            this._hotbarEl.style.display = 'flex';
            this._refreshHotbar();
            if (this._floorPlane) this._floorPlane.visible = true;
            this._loadGhostCurrent();
            this._refreshHUD();
        } else {
            // ── Retourner en mode jeu ──────────────────────────
            if (this._invOpen) this._closeInventory();
            if (this._groupSel.length) this._cancelGroup();
            this._freeCam.exit();
            this._camCtrl.setEditMode(false);
            this._removeGhost();
            this._hud.root.style.display = 'none';
            this._hotbarEl.style.display = 'none';
            if (this._floorPlane) this._floorPlane.visible = false;
            if (this._$crosshair) this._$crosshair.style.display = 'none';
            // Revenir en mode placement pour la prochaine ouverture
            this._selectionMode = false;
        }
    }

    /** Appelé chaque frame depuis game.js (delta + keys requis en mode édition). */
    update(delta, keys) {
        // Ré-appliquer suppressions et transforms monde après rechargement (modèles async)
        // Scan toutes les frames pendant les 10 premières secondes (~600 frames à 60fps),
        // puis toutes les 60 frames — assure que les objets chargés tardivement sont couverts.
        if (this._pendingWorldDels.size > 0 || this._pendingWorldTrans.size > 0) {
            this._worldScanAge++;
            const freq = this._worldScanAge < 600 ? 1 : 60;
            if (this._worldScanAge % freq === 0) {
                this._scanAndApplyDeletions();
                this._scanAndApplyTransforms();
            }
        }

        if (!this._active) return;
        this._freeCam.update(delta, keys);
        this._updateGhost();
    }

    // ── Ghost ──────────────────────────────────────────────────

    _currentItem() {
        if (this._quickActive && this._quickSlot) return this._quickSlot;
        const cat = CATALOG[this._catIdx];
        return cat?.items[this._itemIdx] ?? null;
    }

    _loadGhostCurrent() {
        const item = this._currentItem();
        if (!item) return;
        if (this._ghostUrl === item.url && this._ghost) return;

        this._removeGhost();
        this._ghostUrl = item.url;

        this._ghostBboxHalf.set(0, 0, 0);
        this._fetchModel(item.url, (src) => {
            if (this._ghostUrl !== item.url) return;  // changé entre-temps
            const g = src.clone(true);
            g.name = '__ghost__';
            g.userData.isGhost = true;
            g.traverse(c => { c.userData.isGhost = true; });
            _makeGhost(g);
            this._scene.add(g);
            this._ghost = g;
            // Cacher demi-taille pour surface snap (dans le repère du modèle, rotation 0)
            const sz = new THREE.Vector3();
            new THREE.Box3().setFromObject(g).getSize(sz);
            this._ghostBboxHalf.copy(sz).multiplyScalar(0.5);
        });
    }

    _removeGhost() {
        if (this._ghost) {
            this._scene.remove(this._ghost);
            this._ghost    = null;
            this._ghostUrl = null;
        }
    }

    _updateGhost() {
        // En mode sélection + déplacement actif : les objets réels suivent le curseur
        if (this._selectionMode) {
            if (this._isMoving && this._groupSel.length) {
                this._camera.getWorldPosition(this._rayOrigin);
                this._camera.getWorldDirection(this._rayDir);
                let px = null, py = null, pz = null;
                for (let t = 0.5; t < 24; t += 0.6) {
                    const x = this._rayOrigin.x + this._rayDir.x * t;
                    const y = this._rayOrigin.y + this._rayDir.y * t;
                    const z = this._rayOrigin.z + this._rayDir.z * t;
                    if (y <= getHeight(x, z)) { px = x; py = getHeight(x, z); pz = z; break; }
                }
                if (px === null) {
                    px = this._rayOrigin.x + this._rayDir.x * 8;
                    py = this._rayOrigin.y + this._rayDir.y * 8;
                    pz = this._rayOrigin.z + this._rayDir.z * 8;
                }
                if (this._snapEnabled) {
                    const s = SNAP_SIZES[this._snapIdx];
                    px = Math.round(px / s) * s;
                    pz = Math.round(pz / s) * s;
                }
                // Verrouillage d'axe pour déplacement groupe
                if (this._axisLock === 'x') pz = this._axisLockOrigin.z;
                else if (this._axisLock === 'z') px = this._axisLockOrigin.x;
                py += this._groupHeightOff;
                this._updateGroupObjects(px, py, pz);
            }
            return;
        }
        if (!this._ghost) return;

        // ── Calcul position de placement ──────────────────────
        this._camera.getWorldPosition(this._rayOrigin);
        this._camera.getWorldDirection(this._rayDir);

        // 1) Terrain
        let px = null, py = null, pz = null;
        const STEP = 0.6, MAX = 24;
        for (let t = 0.5; t < MAX; t += STEP) {
            const x = this._rayOrigin.x + this._rayDir.x * t;
            const y = this._rayOrigin.y + this._rayDir.y * t;
            const z = this._rayOrigin.z + this._rayDir.z * t;
            if (y <= getHeight(x, z)) { px = x; py = getHeight(x, z); pz = z; break; }
        }

        // 2) Objets déjà posés (inclut scene.children pour objets monde)
        {
            const allMeshes = [];
            this._scene.traverse(c => {
                if (c.isMesh && !c.name.startsWith('__') && !c.userData.isTerrain && !c.userData.isGhost) allMeshes.push(c);
            });
            this._ray.set(this._rayOrigin, this._rayDir);
            const hits = this._ray.intersectObjects(allMeshes, false);
            if (hits.length) {
                const h = hits[0];
                const td = px !== null
                    ? Math.hypot(px - this._rayOrigin.x, py - this._rayOrigin.y, pz - this._rayOrigin.z)
                    : Infinity;
                if (h.distance < td) {
                    if (this._surfaceSnap && h.face) {
                        // ── Surface snap : aligner la face du ghost sur la surface touchée ──
                        const wn = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
                        // Demi-profondeur du ghost dans la direction de la normale
                        const halfD = Math.abs(
                            this._ghostBboxHalf.x * Math.abs(wn.x) +
                            this._ghostBboxHalf.y * Math.abs(wn.y) +
                            this._ghostBboxHalf.z * Math.abs(wn.z)
                        );
                        px = h.point.x + wn.x * halfD;
                        py = h.point.y + wn.y * halfD;
                        pz = h.point.z + wn.z * halfD;
                        // Auto-rotation Y vers la normale (horizontale seulement)
                        if (Math.abs(wn.y) < 0.4) {
                            this._rotY = Math.atan2(wn.x, wn.z);
                            if (this._ghost) this._ghost.rotation.y = this._rotY;
                        }
                    } else {
                        px = h.point.x; py = h.point.y; pz = h.point.z;
                    }
                }
            }
        }

        // 3) Aucun hit → 8m devant
        if (px === null) {
            px = this._rayOrigin.x + this._rayDir.x * 8;
            py = this._rayOrigin.y + this._rayDir.y * 8;
            pz = this._rayOrigin.z + this._rayDir.z * 8;
        }

        // 4) Snap grille — XZ uniquement (Y suit le terrain/surface naturellement)
        if (this._snapEnabled) {
            const s = SNAP_SIZES[this._snapIdx];
            px = Math.round(px / s) * s;
            pz = Math.round(pz / s) * s;
            // Y ne snape PAS sur la grille — utiliser heightOffset pour ajustements fins
        }

        // 5) Verrouillage d'axe (X ou Z) — appliqué après snap pour rester sur la grille
        if (this._axisLock === 'x') {
            pz = this._axisLockOrigin.z;
        } else if (this._axisLock === 'z') {
            px = this._axisLockOrigin.x;
        }

        // 6) Verrou plancher (H) ou décalage manuel (Shift+Molette)
        if (this._floorLocked) {
            py = this._floorY + this._heightOffset;
        } else {
            py += this._heightOffset;
        }

        this._ghost.position.set(px, py, pz);
        this._ghost.rotation.set(this._rotX, this._rotY, this._rotZ);
    }

    // ── Groupe — mise à jour des ghosts ───────────────────────

    _updateGroupObjects(cursorX, cursorY, cursorZ) {
        const cos = Math.cos(this._groupRotDelta);
        const sin = Math.sin(this._groupRotDelta);
        for (let i = 0; i < this._groupSel.length; i++) {
            const sel = this._groupSel[i];
            const off = sel.offset;
            const rx  = off.x * cos - off.z * sin;
            const rz  = off.x * sin + off.z * cos;
            sel.obj.position.set(cursorX + rx, cursorY + off.y, cursorZ + rz);
            sel.obj.rotation.set(sel.origRot.x, sel.origRot.y + this._groupRotDelta, sel.origRot.z);
        }
    }

    // ── Groupe — (re)calcul du centroïde et des offsets ───────

    _recalcGroupCenter() {
        const c = new THREE.Vector3();
        for (const s of this._groupSel) c.add(s.obj.position);  // positions réelles, pas origPos
        c.divideScalar(this._groupSel.length);
        this._groupCenter.copy(c);
        for (const s of this._groupSel) s.offset.copy(s.obj.position).sub(c);
    }

    // ── Groupe — toggle sélection d'une pièce (Alt+clic) ──────

    _toggleGroupItem(e) {
        const target = this._pickTarget(e);
        if (!target) { this._flashHUD('Aucune pièce visée'); return; }

        const entry = this._placed.find(en => en._obj === target);

        // Toggle : si déjà sélectionné → retirer
        const existIdx = this._groupSel.findIndex(s => s.obj === target);
        if (existIdx !== -1) {
            const removed = this._groupSel.splice(existIdx, 1)[0];
            this._clearGroupHighlight(removed.obj, removed.origMats);
            const g = this._groupGhosts.splice(existIdx, 1)[0];
            if (g) this._scene.remove(g);
            this._recalcGroupCenter();
            this._flashHUD(`Désélectionné  (${this._groupSel.length} pièces)`);
            return;
        }

        // Ajouter
        const origMats = this._applyGroupHighlight(target);
        this._groupSel.push({
            obj:      target,
            entry:    entry ?? null,
            url:      this._urlFromObject(target) ?? null,  // null = objet hors catalogue (toujours sélectionnable)
            origMats,
            origPos:  target.position.clone(),
            origRot:  target.rotation.clone(),
            offset:   new THREE.Vector3(),
            origKey:  this._ensureOrigKey(target),
        });
        this._groupGhosts.push(null);
        this._recalcGroupCenter();

        const n = this._groupSel.length;
        this._flashHUD(`+Sélection (${n} pièce${n>1?'s':''}) — Clic droit=Déplacer  •  Alt+Clic gauche=Ajouter  •  ⇧Clic droit=Supprimer  •  Échap=Annuler`);
    }

    // ── Groupe — confirmer le déplacement ─────────────────────

    _placeGroup() {
        if (!this._groupSel.length || !this._isMoving) return;

        // Les objets sont déjà à leur nouvelle position (déplacés en temps réel)
        const snapshots = this._groupSel.map(sel => ({
            obj:     sel.obj,
            entry:   sel.entry,
            origKey: sel.origKey,   // capturé à la sélection, avant tout déplacement
            oldPos:  sel.origPos.clone(),
            oldRot:  sel.origRot.clone(),
            newPos:  sel.obj.position.clone(),
            newRot:  sel.obj.rotation.clone(),
        }));

        for (const s of snapshots) {
            if (s.entry) {
                s.entry.x  = s.newPos.x; s.entry.y  = s.newPos.y; s.entry.z  = s.newPos.z;
                s.entry.rx = s.newRot.x; s.entry.ry = s.newRot.y; s.entry.rz = s.newRot.z;
            } else {
                const t = { key: s.origKey, x: s.newPos.x, y: s.newPos.y, z: s.newPos.z,
                            rx: s.newRot.x, ry: s.newRot.y, rz: s.newRot.z };
                this._worldTransforms.set(s.origKey, t);
            }
        }
        this._recordAction({ type: 'group_move', snapshots });
        this._save();
        if (snapshots.some(s => !s.entry)) this._saveWorldTransforms();

        this._isMoving = false;   // désactiver avant _cancelGroup pour ne pas restaurer
        this._cancelGroup();
        this._refreshHUD();
        const n = snapshots.length;
        this._flashHUD(`${n} pièce${n>1?'s':''} déplacée${n>1?'s':''} ✓  (Ctrl+Z pour annuler)`);
    }

    // ── Groupe — annuler la sélection ─────────────────────────

    _cancelGroup() {
        // Sauvegarder la liste des objets pour Alt+R (avant d'effacer)
        if (this._groupSel.length) {
            this._lastGroupObjects = this._groupSel.map(s => s.obj);
        }
        // Si déplacement en cours → restaurer les positions d'origine
        if (this._isMoving) {
            for (const s of this._groupSel) {
                s.obj.position.copy(s.origPos);
                s.obj.rotation.copy(s.origRot);
            }
            this._isMoving = false;
        }
        for (const s of this._groupSel) this._clearGroupHighlight(s.obj, s.origMats);
        for (const g of this._groupGhosts) { if (g) this._scene.remove(g); }
        this._groupSel       = [];
        this._groupGhosts    = [];
        this._groupRotDelta  = 0;
        this._groupHeightOff = 0;
        this._axisLock       = null;
    }

    // ── Groupe — highlight orange ──────────────────────────────

    _applyGroupHighlight(obj) {
        const map = new Map();
        obj.traverse(c => {
            if (!c.isMesh) return;
            map.set(c, c.material);
            const m = c.material.clone();
            m.color             = new THREE.Color(0x5599ff);
            m.emissive          = new THREE.Color(0x2255dd);
            m.emissiveIntensity = 0.6;
            m.transparent       = true;
            m.opacity           = 0.88;
            c.material = m;
        });
        return map;
    }

    _clearGroupHighlight(obj, map) {
        obj.traverse(c => {
            if (!c.isMesh) return;
            const orig = map.get(c);
            if (orig) c.material = orig;
        });
    }

    // ── Placement ──────────────────────────────────────────────

    _place() {
        // Si un groupe est sélectionné, confirmer son déplacement
        if (this._groupSel.length > 0) { this._placeGroup(); return; }
        const item = this._currentItem();
        if (!item || !this._ghost) return;

        const p = this._ghost.position;
        const entry = {
            url:  item.url,
            name: item.name,
            x: p.x, y: p.y, z: p.z,
            rx: this._rotX, ry: this._rotY, rz: this._rotZ,
        };

        this._fetchModel(item.url, (src) => {
            const obj = src.clone(true);
            obj.position.set(entry.x, entry.y, entry.z);
            obj.rotation.set(entry.rx, entry.ry, entry.rz);
            obj.name = 'placed__' + _urlKey(item.url);
            obj.traverse(c => { c.frustumCulled = false; });
            _applyZFightFix(obj, item.url);
            this._scene.add(obj);
            entry._obj = obj;
            this._placed3d.push(obj);
        });

        this._placed.push(entry);
        this._recordAction({ type: 'place', entry });
        this._save();
        // Conserver l'axisLockOrigin à la position du ghost placé (permet de continuer sur le même axe)
        if (this._axisLock && this._ghost) this._axisLockOrigin.copy(this._ghost.position);
        this._flashHUD('Placé ✓');
    }

    // ── Suppression ────────────────────────────────────────────

    /** Supprimer la pièce visée par le rayon caméra (pointer lock) */
    _deleteHovered() {
        // Toujours recalculer depuis la caméra — _updateGhost ne met pas à jour en mode sélection
        this._camera.getWorldPosition(this._rayOrigin);
        this._camera.getWorldDirection(this._rayDir);
        const candidates = [];
        this._scene.traverse(c => {
            if (!c.isMesh || c.name.startsWith('__') || c.userData.isGhost || c.userData.isTerrain) return;
            candidates.push(c);
        });
        this._ray.set(this._rayOrigin, this._rayDir);
        const hits = this._ray.intersectObjects(candidates, false);
        if (!hits.length) { this._flashHUD('Rien à supprimer'); return; }
        let target = hits[0].object;
        while (target.parent && target.parent !== this._scene) target = target.parent;
        if (!target.parent) { this._flashHUD('Rien à supprimer'); return; }
        this._deleteTarget(target);
    }

    /** Supprimer la pièce sous le curseur souris (mode curseur libre) */
    _deleteAtCursor(e) {
        const target = this._pickTarget(e);
        if (!target) { this._flashHUD('Rien à supprimer'); return; }
        this._deleteTarget(target);
    }

    /** Logique commune de suppression (undo + persistance) */
    _deleteTarget(target) {
        if (this._placed3d.includes(target)) {
            const idx = this._placed.findIndex(e => e._obj === target);
            const entry = idx !== -1 ? this._placed[idx] : null;
            this._scene.remove(target);
            this._placed3d.splice(this._placed3d.indexOf(target), 1);
            if (idx !== -1) this._placed.splice(idx, 1);
            if (entry) this._recordAction({ type: 'delete_placed', entry });
            this._save();
            this._flashHUD('Supprimé ✓  (Ctrl+Z pour annuler)');
            return;
        }
        const key = this._worldKey(target);
        this._scene.remove(target);
        this._deletedWorldKeys.add(key);
        this._recordAction({ type: 'delete_world', key, obj: target });
        this._saveWorldDeletions();
        this._flashHUD('Supprimé ✓  décor  (Ctrl+Z pour annuler)');
    }

    // ── Sélection d'une pièce (Shift+clic gauche) ─────────────

    _selectObjectAtCursor(e) {
        const target = this._pickTarget(e);
        if (!target) { this._flashHUD('Aucune pièce visée'); return; }
        const item = this._itemFromObject(target);
        if (!item) { this._flashHUD('Pièce non identifiable dans le catalogue'); return; }
        this._setQuickSlot(item);
    }

    /** Renvoi l'objet racine pointé par le curseur (curseur libre ou pointer lock) */
    _pickTarget(e) {
        const dom = this._freeCam._dom;
        const rect = dom.getBoundingClientRect();
        let nx, ny;
        if (document.pointerLockElement === dom) {
            nx = 0; ny = 0;
        } else {
            nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            ny = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
        }
        this._pickRay.setFromCamera({ x: nx, y: ny }, this._camera);
        const candidates = [];
        this._scene.traverse(c => {
            if (!c.isMesh || c.name.startsWith('__') || c.userData.isGhost || c.userData.isTerrain) return;
            candidates.push(c);
        });
        const hits = this._pickRay.intersectObjects(candidates, false);
        if (!hits.length) return null;
        let target = hits[0].object;
        while (target.parent && target.parent !== this._scene) target = target.parent;
        return target.parent ? target : null;
    }

    /** Cherche l'item du catalogue correspondant à un objet de la scène */
    _itemFromObject(obj) {
        // Objet placé par BuildMode → on a l'URL exacte
        const entry = this._placed.find(e => e._obj === obj);
        if (entry) {
            for (let ci = 0; ci < CATALOG.length; ci++) {
                const ii = CATALOG[ci].items.findIndex(it => it.url === entry.url);
                if (ii !== -1) return { catIdx: ci, itemIdx: ii, name: entry.name, url: entry.url };
            }
            return { catIdx: 0, itemIdx: 0, name: entry.name, url: entry.url };
        }
        // Objet du monde → tentative par nom (ex: "placed__Wall_UnevenBrick_Straight")
        const nameKey = obj.name.replace(/^placed__/, '');
        for (let ci = 0; ci < CATALOG.length; ci++) {
            const cat = CATALOG[ci];
            for (let ii = 0; ii < cat.items.length; ii++) {
                if (_urlKey(cat.items[ii].url) === nameKey) {
                    return { catIdx: ci, itemIdx: ii, name: cat.items[ii].name, url: cat.items[ii].url };
                }
            }
        }
        return null;
    }

    /** Définit le slot rapide ● et l'active immédiatement */
    _setQuickSlot(item) {
        this._quickSlot   = item;
        this._quickActive = true;
        this._loadGhostCurrent();
        this._refreshHUD();
        this._refreshHotbar();
        this._flashHUD(`● ${item.name}  →  slot rapide actif`);
    }

    // ── Résolution URL depuis un objet scène ──────────────────

    _urlFromObject(obj) {
        const entry = this._placed.find(en => en._obj === obj);
        if (entry) return entry.url;
        const k = obj.name.replace(/^placed__/, '');
        for (const cat of CATALOG) {
            const it = cat.items.find(i => _urlKey(i.url) === k);
            if (it) return it.url;
        }
        return null;
    }

    // ── Clé d'identification d'un objet monde ─────────────────

    _worldKey(obj) {
        const p = obj.position;
        const r = v => Math.round(v * 1000) / 1000;
        // Si l'objet n'a pas de nom utile, on remonte dans les enfants
        let name = obj.name;
        if (!name || name === 'Scene' || name === 'RootNode') {
            obj.traverse(c => {
                if (c !== obj && !name && c.name && c.name !== 'Scene') name = c.name;
            });
        }
        return `${name || '_'}|${r(p.x)},${r(p.y)},${r(p.z)}`;
    }

    /**
     * Retourne la clé d'origine stable d'un objet monde.
     * Lors du premier déplacement, on enregistre la position naturelle de spawn
     * dans userData.origKey — elle ne change plus ensuite, même après d'autres déplacements.
     */
    _ensureOrigKey(obj) {
        if (!obj.userData.origKey) obj.userData.origKey = this._worldKey(obj);
        return obj.userData.origKey;
    }

    // ── Ré-application au rechargement (modèles chargés async) ─

    _scanAndApplyDeletions() {
        // ── Diagnostic frame 1 : comparaison directe clés pendantes vs scène ──
        if (this._worldScanAge === 1 && this._pendingWorldDels.size > 0) {
            const sceneKeys = new Set([...this._scene.children]
                .filter(o => !o.name.startsWith('__'))
                .map(o => this._worldKey(o)));
            const pending = [...this._pendingWorldDels];
            const found   = pending.filter(k => sceneKeys.has(k));
            const missing = pending.filter(k => !sceneKeys.has(k));
            console.log(`[BuildMode] Scan#1 — ${pending.length} en attente, ${found.length} trouvées, ${missing.length} manquantes`);
            if (found.length)   console.log('[BuildMode] Trouvées:', found.slice(0, 3));
            if (missing.length) {
                console.warn('[BuildMode] Manquantes:', missing.slice(0, 3));
                console.log('[BuildMode] Clés scène sample:', [...sceneKeys].slice(0, 6));
            }
        }

        for (const obj of [...this._scene.children]) {
            if (obj.name.startsWith('__')) continue;
            const k = this._worldKey(obj);
            if (this._pendingWorldDels.has(k)) {
                console.log(`[BuildMode] Suppression appliquée: "${k}"`);
                this._scene.remove(obj);
                this._pendingWorldDels.delete(k);
            }
        }
        if (this._worldScanAge === 300 && this._pendingWorldDels.size > 0) {
            console.warn('[BuildMode] Suppressions non résolues après 300 frames:', [...this._pendingWorldDels].slice(0, 3));
            console.log('[BuildMode] Clés scène actuelles sample:', [...this._scene.children]
                .filter(o => !o.name.startsWith('__'))
                .map(o => this._worldKey(o)).slice(0, 6));
        }
    }

    _scanAndApplyTransforms() {
        if (!this._pendingWorldTrans.size) return;
        for (const obj of this._scene.children) {
            if (obj.name.startsWith('__')) continue;
            const k = this._worldKey(obj);
            if (this._pendingWorldTrans.has(k)) {
                const t = this._pendingWorldTrans.get(k);
                obj.position.set(t.x, t.y, t.z);
                obj.rotation.set(t.rx, t.ry, t.rz);
                obj.userData.origKey = k;
                this._pendingWorldTrans.delete(k);
                console.log(`[BuildMode] Transform appliqué: "${k}" → (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)})`);
            }
        }
        // Debug : si des transforms restent non appliqués après 600 frames, loguer les clés manquantes
        if (this._worldScanAge === 600 && this._pendingWorldTrans.size > 0) {
            console.warn('[BuildMode] Transforms non résolus (objets introuvables dans la scène) :', [...this._pendingWorldTrans.keys()]);
            const sceneKeys = this._scene.children
                .filter(o => !o.name.startsWith('__'))
                .map(o => this._worldKey(o));
            console.log('[BuildMode] Clés scène disponibles :', sceneKeys.slice(0, 30));
        }
    }

    // ── Persistance suppressions monde ────────────────────────

    _saveWorldDeletions() {
        localStorage.setItem(SAVE_WORLD_KEY, JSON.stringify([...this._deletedWorldKeys]));
    }

    _loadWorldDeletions() {
        try {
            const raw = localStorage.getItem(SAVE_WORLD_KEY);
            if (!raw) return;
            const keys = JSON.parse(raw);
            this._deletedWorldKeys = new Set(keys);
            this._pendingWorldDels = new Set(keys);
            if (keys.length) console.log(`[BuildMode] ${keys.length} suppression(s) monde rechargée(s):`, keys);
        } catch (e) {
            console.warn('[BuildMode] Erreur world deletions:', e);
        }
    }

    // ── Persistance transforms monde (déplacements) ────────────

    _saveWorldTransforms() {
        const data = [...this._worldTransforms.values()];
        localStorage.setItem(SAVE_WORLD_TRANS_KEY, JSON.stringify(data));
    }

    _loadWorldTransforms() {
        try {
            const raw = localStorage.getItem(SAVE_WORLD_TRANS_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            for (const t of data) {
                this._worldTransforms.set(t.key, t);
                this._pendingWorldTrans.set(t.key, t);
            }
            if (data.length) console.log(`[BuildMode] ${data.length} transform(s) monde rechargé(s)`);
        } catch (e) {
            console.warn('[BuildMode] Erreur world transforms:', e);
        }
    }

    /**
     * Enregistre ou met à jour le transform d'un objet monde.
     * origKey = clé de spawn stable (position naturelle initiale).
     */
    _setWorldTransform(obj, pos, rot) {
        const origKey = this._ensureOrigKey(obj);
        const t = { key: origKey, x: pos.x, y: pos.y, z: pos.z, rx: rot.x, ry: rot.y, rz: rot.z };
        this._worldTransforms.set(origKey, t);
        this._saveWorldTransforms();
    }

    /** Supprime le transform sauvegardé (undo vers position originale). */
    _removeWorldTransform(origKey) {
        if (this._worldTransforms.delete(origKey)) this._saveWorldTransforms();
    }

    // ── Undo / Redo ────────────────────────────────────────────

    _recordAction(action) {
        this._undoStack.push(action);
        if (this._undoStack.length > 50) this._undoStack.shift();
    }

    _undo() {
        if (!this._undoStack.length) { this._flashHUD('Rien à annuler'); return; }
        const action = this._undoStack.pop();

        if (action.type === 'place') {
            const obj = action.entry._obj;
            if (!obj) { this._flashHUD('Chargement encore en cours…'); this._undoStack.push(action); return; }
            this._scene.remove(obj);
            const pi = this._placed3d.indexOf(obj);
            if (pi !== -1) this._placed3d.splice(pi, 1);
            const ei = this._placed.indexOf(action.entry);
            if (ei !== -1) this._placed.splice(ei, 1);
            this._save();
            this._flashHUD('Placement annulé ✓');

        } else if (action.type === 'delete_placed') {
            const obj = action.entry._obj;
            if (!obj) return;
            this._scene.add(obj);
            this._placed3d.push(obj);
            this._placed.push(action.entry);
            this._save();
            this._flashHUD('Suppression annulée ✓');

        } else if (action.type === 'delete_world') {
            this._scene.add(action.obj);
            this._deletedWorldKeys.delete(action.key);
            this._pendingWorldDels.delete(action.key);
            this._saveWorldDeletions();
            this._flashHUD('Suppression annulée ✓  (décor)');

        } else if (action.type === 'group_move') {
            for (const s of action.snapshots) {
                s.obj.position.copy(s.oldPos);
                s.obj.rotation.set(s.oldRot.x, s.oldRot.y, s.oldRot.z);
                if (s.entry) {
                    s.entry.x  = s.oldPos.x; s.entry.y  = s.oldPos.y; s.entry.z  = s.oldPos.z;
                    s.entry.rx = s.oldRot.x; s.entry.ry = s.oldRot.y; s.entry.rz = s.oldRot.z;
                } else if (s.origKey) {
                    // Objet monde : mettre à jour le transform avec la position restaurée
                    const t = { key: s.origKey, x: s.oldPos.x, y: s.oldPos.y, z: s.oldPos.z,
                                rx: s.oldRot.x, ry: s.oldRot.y, rz: s.oldRot.z };
                    this._worldTransforms.set(s.origKey, t);
                }
            }
            this._save();
            if (action.snapshots.some(s => !s.entry)) this._saveWorldTransforms();
            this._flashHUD(`Déplacement groupe annulé ✓  (${action.snapshots.length} pièces)`);
        }
    }

    // ── Tout effacer ────────────────────────────────────────────

    _clearAll() {
        for (const e of this._placed) {
            if (e._obj) this._scene.remove(e._obj);
        }
        this._placed   = [];
        this._placed3d = [];
        this._save();
        this._flashHUD('Tout effacé');
    }

    // ── Chargement modèle (cache) ──────────────────────────────

    _fetchModel(url, cb) {
        if (this._cache[url]) { cb(this._cache[url]); return; }
        this._loader.load(url,
            (gltf) => { this._cache[url] = gltf.scene; cb(gltf.scene); },
            undefined,
            (err)  => console.warn('[BuildMode] Échec:', url, err)
        );
    }

    // ── Navigation ─────────────────────────────────────────────

    _goCat(dir) {
        this._catIdx  = (this._catIdx + dir + CATALOG.length) % CATALOG.length;
        this._itemIdx = 0;
        this._loadGhostCurrent();
        this._refreshHUD();
    }

    _goItem(dir) {
        const n = CATALOG[this._catIdx].items.length;
        this._itemIdx = (this._itemIdx + dir + n) % n;
        this._loadGhostCurrent();
        this._refreshHUD();
    }

    // ── Rotation ───────────────────────────────────────────────

    _rotY_adj(dir) { this._rotY += dir * ROT_STEP_Y;  this._refreshRot(); }
    _rotX_adj(dir) { this._rotX += dir * ROT_STEP_XZ; this._refreshRot(); }
    _rotZ_adj(dir) { this._rotZ += dir * ROT_STEP_XZ; this._refreshRot(); }
    _resetRot()    { this._rotX = this._rotY = this._rotZ = 0; this._heightOffset = 0; this._refreshRot(); }

    _refreshRot() {
        if (this._ghost) this._ghost.rotation.set(this._rotX, this._rotY, this._rotZ);
        this._refreshHUD();
    }

    // ── Snap ───────────────────────────────────────────────────

    _toggleSnap() {
        this._snapEnabled = !this._snapEnabled;
        this._refreshHUD();
    }

    _cycleSnap() {
        this._snapIdx = (this._snapIdx + 1) % SNAP_SIZES.length;
        this._refreshHUD();
    }

    _toggleAxisLock(axis) {
        if (this._axisLock === axis) {
            // Désactiver
            this._axisLock = null;
            this._refreshHUD();
            this._flashHUD('Axe libre');
        } else {
            // Activer : mémoriser la position courante du ghost ou du groupe
            if (this._ghost) {
                this._axisLockOrigin.copy(this._ghost.position);
            } else if (this._groupCenter.lengthSq() > 0) {
                this._axisLockOrigin.copy(this._groupCenter);
            }
            this._axisLock = axis;
            this._refreshHUD();
            this._flashHUD(axis === 'x'
                ? '← → Axe X verrouillé (Z gelé)  — X pour déverrouiller'
                : '↑ ↓ Axe Z verrouillé (X gelé)  — Z pour déverrouiller');
        }
    }

    // ── Export JS ─────────────────────────────────────────────

    _export() {
        if (!this._placed.length) { this._flashHUD('Rien à exporter'); return; }
        const lines = [
            '// ══ BUILD MODE EXPORT ══',
            `// ${this._placed.length} objet(s) — coller dans _assembleTavern() ou équivalent`,
            '',
        ];
        for (const e of this._placed) {
            const key = _urlKey(e.url);
            const x   = e.x.toFixed(2), y = e.y.toFixed(2), z = e.z.toFixed(2);
            const ry  = e.ry.toFixed(3);
            const rx  = e.rx.toFixed(3), rz = e.rz.toFixed(3);
            const rot = (e.rx !== 0 || e.rz !== 0)
                ? `, ${ry}, 1, 1, 1 /* rx:${rx} rz:${rz} */`
                : `, ${ry}`;
            lines.push(`_p(scene, m.${key}, ${x}, ${y}, ${z}${rot});   // ${e.name}`);
        }
        lines.push('');
        console.log('%c' + lines.join('\n'), 'color:#8f8;font-family:monospace');
        this._flashHUD(`Export ✓  (${this._placed.length} lignes dans la console)`);
    }

    // ── Persistance ────────────────────────────────────────────

    _save() {
        const data = this._placed.map(({ url, name, x, y, z, rx, ry, rz }) =>
            ({ url, name, x, y, z, rx, ry, rz })
        );
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    }

    _loadSaved() {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            for (const e of data) {
                this._fetchModel(e.url, (src) => {
                    const obj = src.clone(true);
                    obj.position.set(e.x, e.y, e.z);
                    obj.rotation.set(e.rx, e.ry, e.rz);
                    obj.name = 'placed__' + _urlKey(e.url);
                    obj.traverse(c => { c.frustumCulled = false; });
                    _applyZFightFix(obj, e.url);
                    this._scene.add(obj);
                    e._obj = obj;
                    this._placed3d.push(obj);
                });
                this._placed.push(e);
            }
            if (data.length) console.log(`[BuildMode] ${data.length} objet(s) rechargés`);
        } catch (err) {
            console.warn('[BuildMode] Erreur chargement save:', err);
        }
    }

    // ── Clavier ────────────────────────────────────────────────

    _setupKeys() {
        window.addEventListener('keydown', (e) => {
            // B toggle — toujours actif
            if (e.code === 'KeyB' && !e.ctrlKey && !e.altKey) {
                this.toggle();
                return;
            }
            if (!this._active) return;
            // Si inventaire ouvert
            if (this._invOpen) {
                if (e.code === 'Escape' || e.code === 'KeyI') { e.preventDefault(); this._closeInventory(); return; }
                // Digit 1-0 pendant survol d'un item → assigner à ce slot SANS fermer
                if (this._invHoveredItem && e.code.startsWith('Digit') && !e.ctrlKey) {
                    e.preventDefault();
                    const n = e.code === 'Digit0' ? 9 : parseInt(e.code.slice(5)) - 1;
                    this._hotbar[n] = { ...this._invHoveredItem };
                    this._saveHotbar();
                    this._refreshHotbar();
                    this._flashHUD(`Slot ${n === 9 ? 0 : n + 1} ← ${this._invHoveredItem.name}`);
                }
                return;
            }

            // Ctrl+Z / Ctrl+E
            if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); this._undo(); return; }
            if (e.ctrlKey && e.code === 'KeyE') { e.preventDefault(); this._export(); return; }

            // Delete — tout effacer (avec confirmation)
            if (e.code === 'Delete') {
                if (this._deleteConfirm) { this._clearAll(); this._deleteConfirm = false; }
                else { this._flashHUD('Appuyer à nouveau sur Suppr pour tout effacer'); this._deleteConfirm = true; setTimeout(() => { this._deleteConfirm = false; }, 3000); }
                return;
            }

            // Hotbar slots 1-0
            if (e.code.startsWith('Digit') && !e.ctrlKey && !e.altKey) {
                const n = e.code === 'Digit0' ? 9 : parseInt(e.code.slice(5)) - 1;
                this._selectHotbarSlot(n);
                return;
            }

            switch (e.code) {
                case 'Backquote':   // ` — activer/désactiver slot rapide
                    e.preventDefault();
                    if (this._quickSlot) {
                        this._quickActive = !this._quickActive;
                        if (this._quickActive) { this._loadGhostCurrent(); this._flashHUD(`● ${this._quickSlot.name}  actif`); }
                        else { this._loadGhostCurrent(); this._flashHUD('Slot rapide désactivé'); }
                        this._refreshHotbar(); this._refreshHUD();
                    } else {
                        this._flashHUD('Slot rapide vide  (Shift+clic gauche sur une pièce)');
                    }
                    break;
                case 'KeyI':
                    e.preventDefault();
                    this._toggleInventory();
                    break;
                case 'KeyV':
                    e.preventDefault();
                    this._toggleFreeCamLock();
                    break;
                case 'KeyH':
                    e.preventDefault();
                    this._toggleFloorLock();
                    break;
                case 'Tab':
                    e.preventDefault();
                    this._toggleSelectionMode();
                    break;
                case 'Comma':        this._goCat(-1);  break;  // , = catégorie précédente
                case 'Period':       this._goCat(1);   break;  // . = catégorie suivante
                case 'BracketLeft':  this._goItem(-1); break;
                case 'BracketRight': this._goItem(1);  break;

                case 'Escape':
                    if (this._groupSel.length > 0) {
                        this._cancelGroup();
                        this._flashHUD('Sélection groupe annulée');
                    }
                    break;

                case 'KeyQ':
                    e.preventDefault();
                    if (this._groupSel.length > 0) {
                        this._groupRotDelta -= ROT_STEP_Y;
                    } else if (!this._selectionMode) {
                        if (e.shiftKey)      this._rotX_adj(-1);
                        else if (e.altKey)   this._rotZ_adj(-1);
                        else                 this._rotY_adj(-1);
                    }
                    break;
                case 'KeyE':
                    e.preventDefault();
                    if (this._groupSel.length > 0) {
                        this._groupRotDelta += ROT_STEP_Y;
                    } else if (!this._selectionMode) {
                        if (e.shiftKey)      this._rotX_adj(1);
                        else if (e.altKey)   this._rotZ_adj(1);
                        else                 this._rotY_adj(1);
                    }
                    break;

                case 'KeyR':
                    if (e.altKey && this._selectionMode) {
                        // Alt+R = restaurer la dernière sélection de groupe
                        e.preventDefault();
                        this._restoreLastGroup();
                    } else if (this._groupSel.length > 0) {
                        this._groupRotDelta  = 0;
                        this._groupHeightOff = 0;
                        this._flashHUD('Groupe : rotation/hauteur réinitialisées');
                    } else if (!this._selectionMode) {
                        this._resetRot();
                    }
                    break;
                case 'KeyG':
                    if (!this._selectionMode) {
                        if (e.shiftKey) this._cycleSnap();
                        else            this._toggleSnap();
                    }
                    break;
                case 'KeyF':
                    if (!this._selectionMode) this._place();
                    else if (this._isMoving && this._groupSel.length > 0) this._placeGroup();
                    break;
                case 'KeyX':
                    if (this._selectionMode) {
                        this._deleteHovered();  // mode sélection : supprimer sous curseur
                    } else {
                        // Mode placement / déplacement : verrou axe X
                        this._toggleAxisLock('x');
                    }
                    break;
                case 'KeyZ':
                    if (!e.ctrlKey) {
                        // Verrou axe Z (Ctrl+Z est capté plus haut pour undo)
                        this._toggleAxisLock('z');
                    }
                    break;
                case 'KeyN':
                    // N = surface snap (cadres de porte/fenêtre)
                    this._surfaceSnap = !this._surfaceSnap;
                    this._refreshHUD();
                    this._flashHUD(this._surfaceSnap
                        ? '⊕ Surface Snap ON — ghost s\'aligne sur la face visée (idéal pour cadres)'
                        : '⊕ Surface Snap OFF');
                    break;
            }
        });

        // Gestion des clics souris
        window.addEventListener('mousedown', (e) => {
            if (!this._active || this._invOpen) return;
            const locked = document.pointerLockElement !== null;

            if (e.button === 0) {
                if (e.altKey) {
                    e.preventDefault();
                    // Alt+Clic gauche = toggle sélection multiple (mode sélection)
                    if (this._selectionMode) this._toggleGroupItem(e);
                } else if (e.shiftKey && !this._selectionMode) {
                    // Shift+clic gauche = slot rapide (mode placement seulement)
                    e.preventDefault();
                    this._selectObjectAtCursor(e);
                } else if (!this._selectionMode) {
                    // MODE PLACEMENT : placer la pièce
                    if (locked) this._place();
                    else if (this._freeCam._cursorFree && this._groupSel.length > 0) this._placeGroup();
                } else {
                    // MODE SÉLECTION
                    if (this._isMoving && (locked || this._freeCam._cursorFree)) {
                        // Déplacement en cours → confirmer
                        this._placeGroup();
                    } else if (locked || this._freeCam._cursorFree) {
                        // Sélectionner l'objet visé
                        this._selectSingle(e);
                    }
                }
            }

            if (e.button === 2) {
                e.preventDefault();
                if (e.shiftKey) {
                    // Shift+Clic droit = supprimer la sélection active (mode sélection)
                    if (this._selectionMode) this._deleteSelected();
                } else if (!e.altKey) {
                    if (this._selectionMode) {
                        // Clic droit = saisir/confirmer déplacement
                        if (this._isMoving) this._placeGroup();
                        else               this._grabSelection();
                    }
                }
            }
        });

        // Bloquer le menu contextuel en mode édition (pour Shift+clic droit)
        window.addEventListener('contextmenu', (e) => {
            if (this._active) e.preventDefault();
        });

        // Molette = zoom (dolly) ou hauteur (Shift)
        window.addEventListener('wheel', (e) => {
            if (!this._active || this._invOpen) return;
            e.preventDefault();
            if (e.shiftKey) {
                // Shift+Molette = ajuster hauteur pièce / groupe
                const step = e.deltaY > 0 ? -0.25 : 0.25;
                if (this._groupSel.length > 0) {
                    if (this._isMoving) {
                        // Pendant déplacement actif : offset relatif au curseur
                        this._groupHeightOff = Math.round((this._groupHeightOff + step) * 100) / 100;
                        this._flashHUD(`Hauteur déplacement : ${this._groupHeightOff >= 0 ? '+' : ''}${this._groupHeightOff.toFixed(2)} m`);
                    } else {
                        // Sélectionné au repos : déplacer directement les objets en Y
                        const snapshots = [];
                        for (const s of this._groupSel) {
                            const oldY = s.obj.position.y;
                            const newY = Math.round((oldY + step) * 100) / 100;
                            snapshots.push({
                                obj: s.obj, entry: s.entry, origKey: s.origKey,
                                oldPos: new THREE.Vector3(s.obj.position.x, oldY, s.obj.position.z),
                                oldRot: s.origRot.clone(),
                                newPos: new THREE.Vector3(s.obj.position.x, newY, s.obj.position.z),
                                newRot: s.obj.rotation.clone(),
                            });
                            s.obj.position.y = newY;
                            s.origPos.y = newY;  // synchronise origPos pour Escape + _recalcGroupCenter
                            if (s.entry) {
                                s.entry.y = newY;
                            } else {
                                const t = this._worldTransforms.get(s.origKey);
                                if (t) { t.y = newY; }
                                else {
                                    this._worldTransforms.set(s.origKey, {
                                        key: s.origKey,
                                        x: s.obj.position.x, y: newY, z: s.obj.position.z,
                                        rx: s.obj.rotation.x, ry: s.obj.rotation.y, rz: s.obj.rotation.z,
                                    });
                                }
                            }
                        }
                        this._recordAction({ type: 'group_move', snapshots });
                        this._save();
                        if (snapshots.some(s => !s.entry)) this._saveWorldTransforms();
                        this._flashHUD(`Y → ${this._groupSel[0].obj.position.y.toFixed(2)} m`);
                    }
                } else if (!this._selectionMode) {
                    this._heightOffset = Math.round((this._heightOffset + step) * 100) / 100;
                    this._refreshHUD();
                }
            } else if (this._groupSel.length > 0 && !this._isMoving) {
                // Molette seule + sélection au repos = pousser/tirer avant-arrière
                const step = e.deltaY > 0 ? -0.25 : 0.25;
                const fwd = new THREE.Vector3();
                this._camera.getWorldDirection(fwd);
                fwd.y = 0;
                if (fwd.lengthSq() > 0.0001) fwd.normalize();
                const snapshots = [];
                for (const s of this._groupSel) {
                    const oldX = s.obj.position.x, oldZ = s.obj.position.z;
                    const newX = Math.round((oldX + fwd.x * step) * 100) / 100;
                    const newZ = Math.round((oldZ + fwd.z * step) * 100) / 100;
                    snapshots.push({
                        obj: s.obj, entry: s.entry, origKey: s.origKey,
                        oldPos: new THREE.Vector3(oldX, s.obj.position.y, oldZ),
                        oldRot: s.origRot.clone(),
                        newPos: new THREE.Vector3(newX, s.obj.position.y, newZ),
                        newRot: s.obj.rotation.clone(),
                    });
                    s.obj.position.x = newX;
                    s.obj.position.z = newZ;
                    s.origPos.x = newX;
                    s.origPos.z = newZ;
                    if (s.entry) {
                        s.entry.x = newX;
                        s.entry.z = newZ;
                    } else {
                        const t = this._worldTransforms.get(s.origKey);
                        if (t) { t.x = newX; t.z = newZ; }
                        else {
                            this._worldTransforms.set(s.origKey, {
                                key: s.origKey,
                                x: newX, y: s.obj.position.y, z: newZ,
                                rx: s.obj.rotation.x, ry: s.obj.rotation.y, rz: s.obj.rotation.z,
                            });
                        }
                    }
                }
                this._recalcGroupCenter();
                this._recordAction({ type: 'group_move', snapshots });
                this._save();
                if (snapshots.some(s => !s.entry)) this._saveWorldTransforms();
                this._flashHUD(`Poussé ${step > 0 ? '↑' : '↓'} ${Math.abs(step).toFixed(2)} m`);
            } else {
                // Molette seule = dolly caméra (zoom avant/arrière)
                const _dir = new THREE.Vector3();
                this._camera.getWorldDirection(_dir);
                this._camera.position.addScaledVector(_dir, -e.deltaY * 0.02);
            }
        }, { passive: false });
    }

    // ── Verrou plancher ────────────────────────────────────────

    _toggleFloorLock() {
        if (this._floorLocked) {
            // Déverrouiller
            this._floorLocked = false;
            this._heightOffset = 0;
            if (this._floorPlane) {
                this._scene.remove(this._floorPlane);
                this._floorPlane = null;
            }
            this._flashHUD('Plancher libre');
        } else {
            // Verrouiller au Y courant du ghost (terrain + offset)
            const g = this._ghost;
            this._floorY      = g ? g.position.y : getHeight(
                this._camera.position.x, this._camera.position.z
            );
            this._floorLocked  = true;
            this._heightOffset = 0;

            // Plan visuel 80×80m semi-transparent doré
            const geo = new THREE.PlaneGeometry(80, 80);
            geo.rotateX(-Math.PI / 2);
            const mat = new THREE.MeshBasicMaterial({
                color: 0xf0c040, transparent: true, opacity: 0.12,
                depthWrite: false, side: THREE.DoubleSide,
            });
            this._floorPlane = new THREE.Mesh(geo, mat);
            this._floorPlane.position.set(
                this._camera.position.x, this._floorY, this._camera.position.z
            );
            this._floorPlane.name = '__floorPlane__';
            this._scene.add(this._floorPlane);

            this._flashHUD(`Plancher verrouillé  Y = ${this._floorY.toFixed(2)} m`);
        }
        this._refreshHUD();
    }

    // ── Sélection rapide clic droit → déplacement ─────────────

    // ── Sélection simple (Clic gauche en mode sélection) ──────────

    _selectSingle(e) {
        const target = this._pickTarget(e);
        this._cancelGroup();  // efface toute sélection/déplacement précédent
        if (!target) { this._flashHUD('Aucun objet visé'); return; }

        const entry = this._placed.find(en => en._obj === target);

        const origMats = this._applyGroupHighlight(target);
        this._groupSel = [{
            obj:     target,
            entry:   entry ?? null,
            url:     this._urlFromObject(target) ?? null,  // null = objet hors catalogue (toujours sélectionnable)
            origMats,
            origPos: target.position.clone(),
            origRot: target.rotation.clone(),
            offset:  new THREE.Vector3(),
            origKey: this._ensureOrigKey(target),  // capturé maintenant (position = spawn)
        }];
        this._groupGhosts   = [null];
        this._groupRotDelta  = 0;
        this._groupHeightOff = 0;
        this._groupCenter.copy(target.position);
        this._flashHUD('● Sélectionné — Clic droit=Déplacer  •  Alt+Clic gauche=Ajouter  •  ⇧Clic droit=Supprimer  •  Échap=Annuler');
    }

    // ── Saisir la sélection pour déplacement temps réel ──────────

    _grabSelection() {
        if (!this._groupSel.length) {
            this._flashHUD('Aucune sélection — Clic gauche pour sélectionner');
            return;
        }
        if (this._isMoving) return;  // déjà en cours
        this._recalcGroupCenter();
        this._axisLockOrigin.copy(this._groupCenter);
        this._axisLock = null;
        this._isMoving = true;
        const n = this._groupSel.length;
        this._refreshHUD();
        this._flashHUD(`Déplacement (${n} pièce${n>1?'s':''}) — Clic gauche/F confirmer  •  Q/E rotation  •  ⇧Molette hauteur  •  Échap annuler`);
    }

    // ── Supprimer la sélection active ────────────────────────────

    _deleteSelected() {
        if (!this._groupSel.length) { this._flashHUD('Aucune sélection à supprimer'); return; }
        const n = this._groupSel.length;
        // Si déplacement en cours, restaurer d'abord
        if (this._isMoving) {
            for (const s of this._groupSel) { s.obj.position.copy(s.origPos); s.obj.rotation.copy(s.origRot); }
            this._isMoving = false;
        }
        for (const g of this._groupGhosts) { if (g) this._scene.remove(g); }
        this._groupGhosts = [];
        for (const s of this._groupSel) {
            this._clearGroupHighlight(s.obj, s.origMats);
            this._deleteTarget(s.obj);
        }
        this._lastGroupObjects = [];  // sélection supprimée = pas de restauration
        this._groupSel       = [];
        this._groupRotDelta  = 0;
        this._groupHeightOff = 0;
        this._flashHUD(`${n} objet${n>1?'s':''} supprimé${n>1?'s':''} ✓  (Ctrl+Z pour annuler)`);
    }

    // ── Alt+R : restaurer la dernière sélection de groupe ────────

    _restoreLastGroup() {
        if (!this._lastGroupObjects.length) { this._flashHUD('Aucune sélection précédente'); return; }
        this._cancelGroup();
        for (const obj of this._lastGroupObjects) {
            if (!this._scene.children.includes(obj)) continue;
            const entry = this._placed.find(en => en._obj === obj);
            const origMats = this._applyGroupHighlight(obj);
            this._groupSel.push({
                obj, entry: entry ?? null, url: this._urlFromObject(obj) ?? null, origMats,
                origPos:  obj.position.clone(),
                origRot:  obj.rotation.clone(),
                offset:   new THREE.Vector3(),
                origKey:  this._ensureOrigKey(obj),
            });
            this._groupGhosts.push(null);
        }
        if (!this._groupSel.length) { this._flashHUD('Objets précédents introuvables'); return; }
        this._recalcGroupCenter();
        const n = this._groupSel.length;
        this._flashHUD(`Sélection restaurée (${n} pièce${n>1?'s':''}) — Clic droit=Déplacer  •  ⇧Clic droit=Supprimer  •  Échap=Annuler`);
    }

    // ── Toggle Placement ↔ Sélection (Tab) ────────────────────

    _toggleSelectionMode() {
        this._selectionMode = !this._selectionMode;

        if (this._selectionMode) {
            // Entrer en mode sélection : masquer le ghost de placement
            this._removeGhost();
            this._flashHUD('◎ MODE SÉLECTION — Clic gauche=Sélectionner  •  Alt+Clic=Groupe  •  Clic droit=Déplacer  •  ⇧Clic droit=Supprimer  •  Tab=Placement');
        } else {
            // Entrer en mode placement : annuler sélection + restaurer ghost
            this._cancelGroup();
            this._loadGhostCurrent();
            this._flashHUD('◈ MODE PLACEMENT — F/Clic placer  •  Ctrl+Z undo  •  Tab=Sélection');
        }
        this._refreshHUD();
    }

    _toggleFreeCamLock() {
        const free = this._freeCam.toggleCursorFree();
        this._refreshHUD();
        this._flashHUD(free ? 'Souris libre  (V = revenir)' : 'Caméra active  (V = curseur libre)');
    }

    // ── Hotbar ─────────────────────────────────────────────────

    _buildHotbar() {
        const bar = document.createElement('div');
        bar.style.cssText = [
            'position:fixed', 'bottom:12px', 'left:50%', 'transform:translateX(-50%)',
            'display:none', 'flex-direction:row', 'gap:4px', 'align-items:center',
            'padding:6px 8px',
            'background:rgba(0,0,0,0.82)',
            'border-radius:8px',
            'border:1px solid rgba(200,160,80,0.35)',
            'pointer-events:auto',
            'z-index:9998',
        ].join(';');

        // ── Slot rapide ● (avant le 1) ────────────────────────
        const qs = document.createElement('div');
        qs.style.cssText = [
            'position:relative', 'width:52px', 'height:68px',
            'border-radius:4px', 'border:2px solid #888',
            'background:rgba(20,20,20,0.8)',
            'display:flex', 'flex-direction:column', 'align-items:center',
            'cursor:pointer', 'overflow:hidden',
        ].join(';');
        const qsNum = document.createElement('div');
        qsNum.style.cssText = 'font:bold 10px monospace;color:#ccc;padding:2px 0 1px;width:100%;text-align:center;background:rgba(0,0,0,0.5)';
        qsNum.textContent = '●';
        const qsBar   = document.createElement('div');
        qsBar.style.cssText = 'width:100%;height:3px';
        const qsLabel = document.createElement('div');
        qsLabel.style.cssText = 'font:9px monospace;color:#555;text-align:center;padding:3px 3px 0;word-break:break-word;line-height:1.3;flex:1;display:flex;align-items:center;justify-content:center';
        qsLabel.textContent = '—';
        qs.appendChild(qsNum); qs.appendChild(qsBar); qs.appendChild(qsLabel);
        qs.addEventListener('click', () => {
            if (this._quickSlot) {
                this._quickActive = !this._quickActive;
                if (this._quickActive) { this._loadGhostCurrent(); this._flashHUD(`● ${this._quickSlot.name}  actif`); }
                else { this._loadGhostCurrent(); this._flashHUD('Slot rapide désactivé'); }
                this._refreshHotbar(); this._refreshHUD();
            }
        });
        this._quickSlotEl = { root: qs, colorBar: qsBar, label: qsLabel };
        bar.appendChild(qs);

        // Séparateur
        const sep = document.createElement('div');
        sep.style.cssText = 'width:1px;height:40px;background:rgba(255,255,255,0.15);margin:0 2px';
        bar.appendChild(sep);

        this._hotbarSlots = [];
        for (let i = 0; i < 10; i++) {
            const slot = document.createElement('div');
            slot.style.cssText = [
                'position:relative', 'width:52px', 'height:68px',
                'border-radius:4px',
                'border:2px solid rgba(255,255,255,0.2)',
                'background:rgba(20,20,20,0.8)',
                'display:flex', 'flex-direction:column', 'align-items:center',
                'cursor:pointer', 'overflow:hidden',
            ].join(';');

            const num = document.createElement('div');
            num.style.cssText = 'font:bold 10px monospace;color:#aaa;padding:2px 0 1px;width:100%;text-align:center;background:rgba(0,0,0,0.5)';
            num.textContent = i === 9 ? '0' : String(i + 1);

            const colorBar = document.createElement('div');
            colorBar.style.cssText = 'width:100%;height:3px';

            const label = document.createElement('div');
            label.style.cssText = [
                'font:9px monospace', 'color:#555', 'text-align:center',
                'padding:3px 3px 0', 'word-break:break-word', 'line-height:1.3',
                'flex:1', 'display:flex', 'align-items:center', 'justify-content:center',
            ].join(';');
            label.textContent = '—';

            slot.appendChild(num);
            slot.appendChild(colorBar);
            slot.appendChild(label);
            bar.appendChild(slot);

            const si = i;
            slot.addEventListener('click', () => this._selectHotbarSlot(si));

            this._hotbarSlots.push({ root: slot, colorBar, label });
        }

        document.body.appendChild(bar);
        return bar;
    }

    _refreshHotbar() {
        // Slot rapide ●
        if (this._quickSlotEl) {
            const { root, colorBar, label } = this._quickSlotEl;
            const active = this._quickActive && !!this._quickSlot;
            root.style.borderColor = active ? '#ff9900' : 'rgba(255,255,255,0.3)';
            root.style.background  = active ? 'rgba(60,30,5,0.95)' : 'rgba(20,20,20,0.8)';
            if (this._quickSlot) {
                colorBar.style.background = CAT_COLORS[this._quickSlot.catIdx] ?? '#888';
                label.textContent = this._quickSlot.name;
                label.style.color = '#e8d5a0';
            } else {
                colorBar.style.background = 'transparent';
                label.textContent = '—';
                label.style.color = '#555';
            }
        }

        // Slots 1-0
        if (!this._hotbarSlots) return;
        for (let i = 0; i < 10; i++) {
            const { root, colorBar, label } = this._hotbarSlots[i];
            const active = !this._quickActive && i === this._hotbarSlot;
            root.style.borderColor = active ? '#f0c040' : 'rgba(255,255,255,0.2)';
            root.style.background  = active ? 'rgba(60,45,10,0.95)' : 'rgba(20,20,20,0.8)';

            const entry = this._hotbar[i];
            if (entry) {
                colorBar.style.background = CAT_COLORS[entry.catIdx] ?? '#888';
                label.textContent = entry.name;
                label.style.color = '#e8d5a0';
            } else {
                colorBar.style.background = 'transparent';
                label.textContent = '—';
                label.style.color = '#555';
            }
        }
    }

    _selectHotbarSlot(idx) {
        this._hotbarSlot  = idx;
        this._quickActive = false;   // désactive le slot rapide
        const entry = this._hotbar[idx];
        if (entry) {
            this._catIdx  = entry.catIdx;
            this._itemIdx = entry.itemIdx;
            this._loadGhostCurrent();
            this._refreshHUD();
        }
        this._refreshHotbar();
    }

    _assignToHotbar(catIdx, itemIdx) {
        const item = CATALOG[catIdx]?.items[itemIdx];
        if (!item) return;
        this._hotbar[this._hotbarSlot] = { catIdx, itemIdx, name: item.name, url: item.url };
        this._saveHotbar();
        this._selectHotbarSlot(this._hotbarSlot);
        this._flashHUD(`Slot ${this._hotbarSlot === 9 ? 0 : this._hotbarSlot + 1} ← ${item.name}`);
    }

    _saveHotbar() {
        const data = this._hotbar.map(e => e ? { catIdx: e.catIdx, itemIdx: e.itemIdx } : null);
        localStorage.setItem(SAVE_HOTBAR_KEY, JSON.stringify(data));
    }

    _loadHotbar() {
        try {
            const raw = localStorage.getItem(SAVE_HOTBAR_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (!Array.isArray(data)) return;
            this._hotbar = data.map(e => {
                if (!e) return null;
                const cat = CATALOG[e.catIdx];
                if (!cat || !cat.items[e.itemIdx]) return null;
                const item = cat.items[e.itemIdx];
                return { catIdx: e.catIdx, itemIdx: e.itemIdx, name: item.name, url: item.url };
            });
            this._refreshHotbar();
        } catch (err) {
            console.warn('[BuildMode] Erreur chargement hotbar:', err);
        }
    }

    // ── Inventaire ─────────────────────────────────────────────

    // Crée le renderer de prévisualisation la première fois (lazy)
    _ensurePvRenderer() {
        if (this._pvRenderer) return;
        this._pvRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this._pvRenderer.setSize(240, 240);
        this._pvRenderer.setClearColor(0x0c0805, 1);
        this._pvRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this._pvScene  = new THREE.Scene();
        this._pvCamera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
        this._pvCamera.position.set(2.8, 2.0, 2.8);
        this._pvCamera.lookAt(0, 0.8, 0);
        this._pvScene.add(new THREE.AmbientLight(0xfff0e0, 0.7));
        const pvDir = new THREE.DirectionalLight(0xfff4cc, 1.3);
        pvDir.position.set(3, 6, 4);
        this._pvScene.add(pvDir);

        this._pvMesh       = null;
        this._pvAngle      = 0;
        this._pvRunning    = false;
        this._pvPendingUrl = null;

        // Insérer le canvas dans le panneau droit
        if (this._pvCanvasSlot) {
            const c = this._pvRenderer.domElement;
            c.style.cssText = 'border-radius:6px;border:1px solid rgba(200,160,80,0.3);width:240px;height:240px';
            this._pvCanvasSlot.appendChild(c);
        }
    }

    _buildInventory() {
        this._pvRenderer = null;  // lazy init à la première ouverture

        // ── Structure DOM ──────────────────────────────────────
        const overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
            'display:none', 'align-items:center', 'justify-content:center',
            'background:rgba(0,0,0,0.65)',
            'z-index:10000', 'pointer-events:auto',
        ].join(';');

        // Panel principal — flex row : grille à gauche, aperçu à droite
        const panel = document.createElement('div');
        panel.style.cssText = [
            'background:rgba(12,8,4,0.97)',
            'border:1px solid rgba(200,160,80,0.5)',
            'border-radius:10px',
            'display:flex', 'flex-direction:row',
            'max-height:82vh', 'overflow:hidden',
            'pointer-events:auto',
            'color:#e8d5a0', 'font-family:monospace',
        ].join(';');

        // ── Colonne gauche : header + tabs + grille ────────────
        const leftCol = document.createElement('div');
        leftCol.style.cssText = 'width:580px;display:flex;flex-direction:column;overflow:hidden;border-right:1px solid rgba(200,160,80,0.2)';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(200,160,80,0.3);flex-shrink:0';
        header.innerHTML = '<span style="font-size:13px;font-weight:bold;color:#f0c040;letter-spacing:0.1em">✦ INVENTAIRE</span>'
                         + '<span style="font-size:9px;color:#666">Clic = assigner au slot actif &nbsp;|&nbsp; I / Échap = fermer</span>';

        const tabs = document.createElement('div');
        tabs.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px;border-bottom:1px solid rgba(200,160,80,0.2);flex-shrink:0';
        this._invTabEls = [];
        for (let i = 0; i < CATALOG.length; i++) {
            const tab = document.createElement('div');
            tab.style.cssText = 'padding:4px 10px;border-radius:4px;font-size:10px;cursor:pointer;border:1px solid rgba(255,255,255,0.15)';
            tab.textContent = CATALOG[i].name;
            const ci = i;
            tab.addEventListener('click', () => { this._invCatIdx = ci; this._refreshInventory(); });
            tabs.appendChild(tab);
            this._invTabEls.push(tab);
        }

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px;overflow-y:auto;flex:1';
        this._invGrid = grid;

        leftCol.appendChild(header);
        leftCol.appendChild(tabs);
        leftCol.appendChild(grid);

        // ── Colonne droite : aperçu 3D ─────────────────────────
        const rightCol = document.createElement('div');
        rightCol.style.cssText = 'width:264px;display:flex;flex-direction:column;align-items:center;padding:16px 12px;gap:10px;flex-shrink:0';

        const pvTitle = document.createElement('div');
        pvTitle.style.cssText = 'font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#f0c040';
        pvTitle.textContent = 'Aperçu';

        // Emplacement réservé au canvas (injecté lors du lazy init)
        const pvCanvasSlot = document.createElement('div');
        pvCanvasSlot.style.cssText = 'width:240px;height:240px;border-radius:6px;border:1px solid rgba(200,160,80,0.2);background:#0c0805;display:flex;align-items:center;justify-content:center';
        pvCanvasSlot.innerHTML = '<span style="font-size:9px;color:#333">Survoler un item</span>';
        this._pvCanvasSlot = pvCanvasSlot;

        this._pvNameEl = document.createElement('div');
        this._pvNameEl.style.cssText = 'font-size:11px;font-weight:bold;color:#fff;text-align:center;line-height:1.4;min-height:32px';
        this._pvNameEl.textContent = '—';

        this._pvCatEl = document.createElement('div');
        this._pvCatEl.style.cssText = 'font-size:9px;color:#888;text-align:center';
        this._pvCatEl.textContent = '';

        rightCol.appendChild(pvTitle);
        rightCol.appendChild(pvCanvasSlot);
        rightCol.appendChild(this._pvNameEl);
        rightCol.appendChild(this._pvCatEl);

        panel.appendChild(leftCol);
        panel.appendChild(rightCol);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeInventory(); });

        return overlay;
    }

    // ── Renderer prévisualisation ──────────────────────────────

    _setPreview(url, name, catName) {
        this._ensurePvRenderer();
        this._pvNameEl.textContent = name;
        this._pvCatEl.textContent  = catName;
        this._pvPendingUrl = url;   // garde-fou contre les races async

        if (this._pvMesh) { this._pvScene.remove(this._pvMesh); this._pvMesh = null; }

        this._fetchModel(url, (src) => {
            if (this._pvPendingUrl !== url) return;  // utilisateur a déjà bougé

            const clone  = src.clone(true);
            const box    = new THREE.Box3().setFromObject(clone);
            const center = box.getCenter(new THREE.Vector3());
            const size   = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim < 0.001) return;
            const scale  = 2.0 / maxDim;
            clone.scale.setScalar(scale);
            clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

            // Retirer l'éventuel ancien mesh (charge async tardive)
            if (this._pvMesh) this._pvScene.remove(this._pvMesh);
            this._pvScene.add(clone);
            this._pvMesh  = clone;
            this._pvAngle = 0;
        });
    }

    _animatePreview() {
        if (!this._pvRunning) return;
        requestAnimationFrame(() => this._animatePreview());
        if (!this._pvRenderer) return;
        if (this._pvMesh) {
            this._pvAngle += 0.010;
            this._pvMesh.rotation.y = this._pvAngle;
        }
        this._pvRenderer.render(this._pvScene, this._pvCamera);
    }

    // ── Refresh inventaire ─────────────────────────────────────

    _refreshInventory() {
        for (let i = 0; i < this._invTabEls.length; i++) {
            const active = i === this._invCatIdx;
            const c = CAT_COLORS[i];
            this._invTabEls[i].style.background  = active ? c + '44' : 'transparent';
            this._invTabEls[i].style.borderColor = active ? c       : 'rgba(255,255,255,0.15)';
            this._invTabEls[i].style.color       = active ? '#fff'  : '#999';
        }

        this._invGrid.innerHTML = '';
        const cat   = CATALOG[this._invCatIdx];
        const color = CAT_COLORS[this._invCatIdx];

        cat.items.forEach((item, itemIdx) => {
            const card = document.createElement('div');
            card.style.cssText = [
                'background:rgba(35,25,15,0.9)',
                'border:2px solid rgba(200,160,80,0.15)',
                'border-radius:6px',
                'cursor:pointer', 'text-align:center',
                'overflow:hidden', 'display:flex', 'flex-direction:column',
                'min-height:54px',
            ].join(';');

            const bar = document.createElement('div');
            bar.style.cssText = `width:100%;height:4px;background:${color};flex-shrink:0`;
            card.appendChild(bar);

            const name = document.createElement('div');
            name.style.cssText = 'font-size:9px;color:#e8d5a0;padding:7px 5px;line-height:1.4;flex:1;display:flex;align-items:center;justify-content:center';
            name.textContent = item.name;
            card.appendChild(name);

            const ci = this._invCatIdx, ii = itemIdx;
            card.addEventListener('mouseenter', () => {
                card.style.borderColor = color;
                card.style.background  = 'rgba(70,50,15,0.9)';
                this._invHoveredItem = { catIdx: ci, itemIdx: ii, name: item.name, url: item.url };
                this._setPreview(item.url, item.name, cat.name);
            });
            card.addEventListener('mouseleave', () => {
                card.style.borderColor = 'rgba(200,160,80,0.15)';
                card.style.background  = 'rgba(35,25,15,0.9)';
            });

            // Clic = assigner au slot actif + fermer
            card.addEventListener('click', () => { this._assignToHotbar(ci, ii); this._closeInventory(); });

            this._invGrid.appendChild(card);
        });

        // Prévisualiser le premier item par défaut
        if (cat.items.length) {
            this._setPreview(cat.items[0].url, cat.items[0].name, cat.name);
        }
    }

    _openInventory() {
        this._ensurePvRenderer();
        this._invEl.style.display = 'flex';
        this._invOpen = true;
        this._invCatIdx = this._catIdx;
        this._refreshInventory();
        this._pvRunning = true;
        this._animatePreview();
        // Libère le pointer lock pour avoir le curseur
        document.exitPointerLock?.();
        if (this._freeCam) this._freeCam._cursorFree = true;
    }

    _closeInventory() {
        this._pvRunning = false;
        this._invHoveredItem = null;
        // Vider la prévisualisation
        if (this._pvMesh) { this._pvScene.remove(this._pvMesh); this._pvMesh = null; }
        this._invEl.style.display = 'none';
        this._invOpen = false;
        // Réactive la caméra libre si en mode édition
        if (this._active && this._freeCam) {
            this._freeCam._cursorFree = false;
            setTimeout(() => this._freeCam._dom.requestPointerLock?.(), 100);
        }
    }

    _toggleInventory() {
        if (this._invOpen) this._closeInventory();
        else this._openInventory();
    }

    // ── HUD ────────────────────────────────────────────────────

    _buildHUD() {
        const root = document.createElement('div');
        root.style.cssText = [
            'position:fixed', 'top:50%', 'right:18px',
            'transform:translateY(-50%)',
            'display:none', 'flex-direction:column', 'gap:5px',
            'width:420px',
            'color:#e8d5a0', 'font:12px/1.65 monospace',
            'background:rgba(0,0,0,0.88)', 'padding:14px 16px 12px',
            'border-radius:8px',
            'border:1px solid rgba(200,160,80,0.40)',
            'box-shadow:0 4px 24px rgba(0,0,0,0.6)',
            'pointer-events:none',
            'z-index:9999',
            'max-height:90vh', 'overflow:hidden',
        ].join(';');

        const badge = document.createElement('div');
        badge.style.cssText = 'font-size:11px;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:4px;font-weight:bold';
        badge.textContent = '◈ PLACEMENT';
        this._hudBadge = badge;

        const catEl  = document.createElement('div');
        catEl.style.cssText = 'font-size:11px;color:#999';

        const itemEl = document.createElement('div');
        itemEl.style.cssText = 'font-size:14px;font-weight:bold;color:#fff;letter-spacing:0.04em';

        const snapEl = document.createElement('div');
        snapEl.style.cssText = 'font-size:11px;color:#7cf';

        const rotEl  = document.createElement('div');
        rotEl.style.cssText = 'font-size:11px;color:#afc';

        const flashEl = document.createElement('div');
        flashEl.style.cssText = 'font-size:11px;color:#8f8;min-height:15px';

        const help = document.createElement('div');
        help.style.cssText = [
            'font-size:11px', 'color:#bbb', 'line-height:2.0',
            'border-top:1px solid rgba(255,255,255,0.12)',
            'padding-top:7px', 'margin-top:4px',
        ].join(';');
        help.id = '__bm_help__';
        help.innerHTML = '';  // rempli par _refreshHUD

        root.appendChild(badge);
        root.appendChild(catEl);
        root.appendChild(itemEl);
        root.appendChild(snapEl);
        root.appendChild(rotEl);
        root.appendChild(flashEl);
        root.appendChild(help);
        document.body.appendChild(root);

        return { root, catEl, itemEl, snapEl, rotEl, flashEl };
    }

    _buildCrosshair() {
        const el = document.createElement('div');
        el.style.cssText = [
            'position:fixed', 'top:50%', 'left:50%',
            'transform:translate(-50%,-50%)',
            'width:20px', 'height:20px',
            'pointer-events:none', 'display:none', 'z-index:998',
        ].join(';');
        const h = document.createElement('div');
        h.style.cssText = 'position:absolute;top:9px;left:0;width:20px;height:2px;background:rgba(255,255,255,0.75);border-radius:1px;';
        const v = document.createElement('div');
        v.style.cssText = 'position:absolute;left:9px;top:0;width:2px;height:20px;background:rgba(255,255,255,0.75);border-radius:1px;';
        const dot = document.createElement('div');
        dot.style.cssText = 'position:absolute;top:6px;left:6px;width:8px;height:8px;border-radius:50%;background:rgba(64,208,255,0.9);box-shadow:0 0 5px rgba(64,208,255,0.7);';
        el.appendChild(h); el.appendChild(v); el.appendChild(dot);
        document.body.appendChild(el);
        return el;
    }

    _refreshHUD() {
        // Badge mode
        if (this._hudBadge) {
            if (this._selectionMode) {
                this._hudBadge.textContent = '◎ SÉLECTION';
                this._hudBadge.style.color = '#40d0ff';
            } else {
                this._hudBadge.textContent = '◈ PLACEMENT';
                this._hudBadge.style.color = '#f90';
            }
        }
        // Crosshair — visible en mode sélection avec pointer lock
        if (this._$crosshair) {
            const locked = !!document.pointerLockElement;
            this._$crosshair.style.display =
                (this._selectionMode && this._active && locked) ? 'block' : 'none';
        }
        const cat  = CATALOG[this._catIdx];
        const item = this._currentItem();
        this._hud.catEl.textContent  = `${cat?.name ?? '—'}   (${this._catIdx + 1} / ${CATALOG.length})`;
        this._hud.itemEl.textContent = item
            ? `▸ ${item.name}   [${this._itemIdx + 1}/${cat.items.length}]`
            : '—';
        const s = SNAP_SIZES[this._snapIdx];
        const hSign = this._heightOffset >= 0 ? '+' : '';
        const floorStr = this._floorLocked ? `  ⌂${this._floorY.toFixed(2)}m` : '';
        const axisStr  = this._axisLock ? `  🔒${this._axisLock.toUpperCase()}` : '';
        const surfStr  = this._surfaceSnap ? '  ⊕SURF' : '';
        this._hud.snapEl.textContent = `Snap : ${this._snapEnabled ? `ON ${s}m` : 'OFF libre'}${axisStr}${surfStr}   Haut : ${hSign}${this._heightOffset.toFixed(2)}m${floorStr}`;
        const d = (r) => Math.round(r * 180 / Math.PI);
        this._hud.rotEl.textContent  = `Rot  Y:${d(this._rotY)}°  X:${d(this._rotX)}°  Z:${d(this._rotZ)}°`;

        // Bloc d'aide dynamique
        const helpEl = document.getElementById('__bm_help__');
        if (helpEl) {
            // Touche stylisée
            const K = (t) => `<span style="display:inline-block;color:#f5e090;background:rgba(255,220,80,0.13);border:1px solid rgba(255,210,80,0.35);padding:1px 5px;border-radius:3px;font-size:11px;letter-spacing:0.04em;line-height:1.4">${t}</span>`;
            // Séparateur léger
            const SEP = `<span style="color:rgba(255,255,255,0.18);margin:0 3px">│</span>`;
            // Label action
            const A = (t) => `<span style="color:#ccc">${t}</span>`;

            let rows;
            if (this._selectionMode) {
                const moving = this._isMoving;
                const sel    = this._groupSel.length;
                const axX = this._axisLock === 'x';
                const axZ = this._axisLock === 'z';
                rows = [
                    // ── Ligne titre ──────────────────────────────
                    `<span style="color:#40d0ff;font-size:12px;font-weight:bold;letter-spacing:.08em">◎ MODE SÉLECTION</span>`,
                    // ── Ligne sélection ──────────────────────────
                    `${K('Clic G')} ${A('Sélectionner')} ${SEP} ${K('Alt+Clic G')} ${A('Ajouter au groupe')} ${SEP} ${K('Alt+R')} ${A('Restaurer groupe')}`,
                    // ── Ligne déplacement (change selon état) ─────
                    moving
                        ? `${K('Clic G')} ${A('ou')} ${K('F')} ${A('Confirmer')} ${SEP} ${K('Q/E')} ${A('Rotation')} ${SEP} ${K('⇧Molette')} ${A('Hauteur')} ${SEP} ${K('Échap')} ${A('Annuler')}`
                        : `${K('Clic D')} ${A('Déplacer sélection')} ${SEP} ${K('⇧Clic D')} ${A(sel > 0 ? `Supprimer (${sel})` : 'Supprimer')} ${SEP} ${K('Échap')} ${A('Désélectionner')}`,
                    // ── Verrous d'axe ────────────────────────────
                    `${K('X')} <span style="color:${axX?'#f88':'#999'}">${axX?'⟵ Axe X verrouillé ⟶':'Axe X'}</span> ${SEP} ${K('Z')} <span style="color:${axZ?'#88f':'#999'}">${axZ?'⟵ Axe Z verrouillé ⟶':'Axe Z'}</span>`,
                    // ── Global ───────────────────────────────────
                    `${K('Tab')} ${A('Placement')} ${SEP} ${K('V')} ${A('Curseur')} ${SEP} ${K('B')} ${A('Quitter')} ${SEP} ${K('Ctrl+Z')} ${A('Undo')}`,
                ];
            } else {
                const ax = this._axisLock;
                const ns = this._surfaceSnap;
                rows = [
                    // ── Ligne titre ──────────────────────────────
                    `<span style="color:#f90;font-size:12px;font-weight:bold;letter-spacing:.08em">◈ MODE PLACEMENT</span>`,
                    // ── Placer / rotation ─────────────────────────
                    `${K('F')} ${A('ou')} ${K('Clic G')} ${A('Placer')} ${SEP} ${K('Q/E')} ${A('Yaw')} ${SEP} ${K('⇧Q/E')} ${A('Pitch')} ${SEP} ${K('Alt+Q/E')} ${A('Roll')} ${SEP} ${K('R')} ${A('Reset')}`,
                    // ── Snap ─────────────────────────────────────
                    `${K('G')} ${A('Snap')} ${SEP} ${K('⇧G')} ${A('Taille snap')} ${SEP} ${K('⇧Molette')} ${A('Hauteur')} ${SEP} ${K('H')} ${A('Plancher ⌂')} ${SEP} `
                    + `${K('X')} <span style="color:${ax==='x'?'#f88':'#aaa'}">${ax==='x'?'Axe X 🔒':'Axe X'}</span> ${SEP} `
                    + `${K('Z')} <span style="color:${ax==='z'?'#88f':'#aaa'}">${ax==='z'?'Axe Z 🔒':'Axe Z'}</span>`,
                    // ── Surface snap ─────────────────────────────
                    `${K('N')} <span style="color:${ns?'#4f4':'#aaa'}">${ns?'Surface Snap ⊕ ON — face auto-alignée sur le mur':'Surface Snap (cadres de porte/fenêtre)'}</span>`,
                    // ── Inventaire / hotbar ───────────────────────
                    `${K('1–0')} ${A('Hotbar')} ${SEP} ${K('I')} ${A('Inventaire')} ${SEP} ${K(',/.')} ${A('Catégorie')} ${SEP} ${K('[/]')} ${A('Item')}`,
                    // ── Global ───────────────────────────────────
                    `${K('Tab')} ${A('Sélection')} ${SEP} ${K('V')} ${A('Curseur')} ${SEP} ${K('B')} ${A('Quitter')} ${SEP} ${K('Ctrl+Z')} ${A('Undo')} ${SEP} ${K('Ctrl+E')} ${A('Export')}`,
                ];
            }
            helpEl.innerHTML = rows.join('<div style="height:1px;background:rgba(255,255,255,0.05);margin:2px 0"></div>');
        }
    }

    _flashHUD(msg) {
        this._hud.flashEl.textContent = msg;
        clearTimeout(this._flashTimer);
        this._flashTimer = setTimeout(() => { this._hud.flashEl.textContent = ''; }, 2500);
    }
}

// ── Utilitaires ────────────────────────────────────────────────

/**
 * Applique polygonOffset sur les pièces trim/overlay pour éliminer le Z-fighting.
 * Pignons, coins, surplombs, et supports de toit se superposent exactement
 * aux surfaces de base — le logarithmicDepthBuffer ne suffit pas pour un écart nul.
 */
const _ZFIGHT_PATTERN = /Roof_Front|Roof_Dormer|Corner_Exterior|Corner_Interior|Overhang|BottomCover|FrontSupport|Roof_Support/i;

function _applyZFightFix(obj, url) {
    if (!_ZFIGHT_PATTERN.test(url)) return;
    obj.traverse(c => {
        if (!c.isMesh) return;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        const fixed = mats.map(m => {
            const mc = m.clone();
            mc.polygonOffset       = true;
            mc.polygonOffsetFactor = -1;
            mc.polygonOffsetUnits  = -4;
            return mc;
        });
        c.material = Array.isArray(c.material) ? fixed : fixed[0];
    });
}

/** Rend un mesh semi-transparent vert pour la preview. */
function _makeGhost(root) {
    root.traverse(c => {
        if (!c.isMesh) return;
        const clone = MAT_GHOST_OK.clone();
        c.material     = clone;
        c.renderOrder  = 1;
        c.frustumCulled = false;
    });
}

/** Extrait une clé JS propre depuis une URL glTF. */
function _urlKey(url) {
    return url.split('/').pop()
        .replace(/\.(gltf|glb)$/i, '')
        .replace(/[^a-zA-Z0-9]/g, '_');
}
