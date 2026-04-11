import * as THREE from 'three';
import { getHeight, getTerrainNormal } from './world.js';
import { CharacterController } from './character.js';
import { resolveCharConfig } from './char-config.js';

// ═══════════════════════════════════════════════════════════════
//  NPC.JS — Personnage non-joueur animé avec IA de déambulation
//
//  Usage (par nom depuis le char-builder) :
//    const npc = new NPC(scene, [x, y, z], { charName: 'Elara' });
//
//  Usage manuel (ancien style) :
//    const npc = new NPC(scene, meshUrl, animUrls, clipMap, [x, y, z], opts);
//
//  opts communs :
//    charName     {string}  — nom du perso sauvegardé dans le char-builder
//    wanderRadius {number}  — rayon de déambulation (défaut 5m)
//    speed        {number}  — vitesse de marche (défaut 1.4 m/s)
//    targetHeight {number}  — hauteur calibrage (défaut 1.75m)
// ═══════════════════════════════════════════════════════════════

const _NPC_ANIMS = [
    'assets/characters/animations/UAL1_Standard.glb',
    'assets/characters/animations/UAL2_Standard.glb',
];
const _NPC_CLIPS = {
    idle        : 'Idle_Loop',
    walk        : 'Walk_Loop',
    run         : 'Sprint_Loop',
    jump        : 'Jump_Start',
    fall        : 'Jump_Loop',
    crouch_idle : 'Crouch_Idle_Loop',
    crouch_walk : 'Crouch_Fwd_Loop',
};

export class NPC {

    /**
     * @param {THREE.Scene} scene
     * @param {string|number[]} meshUrlOrPos — URL outfit OU [x,y,z] si charName fourni
     * @param {string[]|number[]} animUrlsOrPos — URLs anims OU [x,y,z] si charName fourni
     * @param {object|number[]} clipMapOrPos — clip map OU [x,y,z] si charName fourni
     * @param {number[]|object} posOrOpts — [x,y,z] OU opts si charName fourni
     * @param {object} opts
     */
    constructor(scene, meshUrlOrPos, animUrlsOrPos, clipMapOrPos, posOrOpts, opts = {}) {
        // ── Détection du mode d'appel ──────────────────────────
        // Mode charName : new NPC(scene, [x,y,z], { charName: '...' })
        let meshUrl, animUrls, clipMap, pos, options;
        if (Array.isArray(meshUrlOrPos)) {
            // Nouveau style : (scene, [x,y,z], opts)
            pos     = meshUrlOrPos;
            options = animUrlsOrPos || {};
        } else {
            // Ancien style : (scene, meshUrl, animUrls, clipMap, [x,y,z], opts)
            meshUrl  = meshUrlOrPos;
            animUrls = animUrlsOrPos;
            clipMap  = clipMapOrPos;
            pos      = posOrOpts;
            options  = opts;
        }

        const {
            charName     = null,
            wanderRadius = 5,
            speed        = 1.4,
            targetHeight = 1.75,
        } = options;

        this._speed   = speed;
        this._wanderR = wanderRadius;
        this._name    = charName || 'NPC';

        // Position et IA
        const [px, , pz] = pos;
        const spawnY       = getHeight(px, pz);
        this._base         = new THREE.Vector3(px, spawnY, pz);
        this._pos          = new THREE.Vector3(px, spawnY, pz);
        this._targetPos    = new THREE.Vector3(px, spawnY, pz);
        this._yaw          = 0;
        this._walking      = false;
        this._idleTimer    = 2 + Math.random() * 3;

        // Normale terrain (zéro allocation)
        this._nrmTmp = new THREE.Vector3(0, 1, 0);

        // ── Résolution config personnage ──────────────────────
        this._char = new CharacterController(scene);

        if (charName) {
            // Chargement depuis le char-builder par nom
            const cfg = resolveCharConfig(charName);
            console.log(`[NPC] "${charName}" →`, cfg);
            this._char.loadRetargeted(cfg.meshUrl, _NPC_ANIMS, _NPC_CLIPS, {
                targetHeight,
                baseBodyUrl    : cfg.baseUrl,
                hairUrl        : cfg.hairUrl,
                beardUrl       : cfg.beardUrl,
                hairColor      : cfg.hairColor,
                eyeColor       : cfg.eyeColor,
                boneScaleBody  : cfg.boneScaleBody,
                boneScaleOutfit: cfg.boneScaleOutfit,
            }).catch(err => console.error(`[NPC] Erreur chargement "${charName}" :`, err));
        } else {
            // Ancien style manuel
            this._char.loadRetargeted(meshUrl, animUrls || _NPC_ANIMS, clipMap || _NPC_CLIPS,
                { targetHeight })
                .catch(err => console.error('[NPC] Erreur chargement :', err));
        }
    }

    get isLoaded() { return this._char.isLoaded; }

    // ── IA de déambulation ─────────────────────────────────────
    _wander(delta) {
        if (this._walking) {
            const dx   = this._targetPos.x - this._pos.x;
            const dz   = this._targetPos.z - this._pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < 0.15) {
                this._walking   = false;
                this._idleTimer = 3 + Math.random() * 5;
            } else {
                const step = Math.min(this._speed * delta, dist);
                this._pos.x += (dx / dist) * step;
                this._pos.z += (dz / dist) * step;
                this._yaw = Math.atan2(dx, dz);
            }
        } else {
            this._idleTimer -= delta;
            if (this._idleTimer <= 0) {
                const angle = Math.random() * Math.PI * 2;
                const r     = 1.5 + Math.random() * this._wanderR;
                const tx    = this._base.x + Math.cos(angle) * r;
                const tz    = this._base.z + Math.sin(angle) * r;
                this._targetPos.set(tx, getHeight(tx, tz), tz);
                this._walking = true;
            }
        }

        // Coller au terrain en Y
        this._pos.y = getHeight(this._pos.x, this._pos.z);
        getTerrainNormal(this._pos.x, this._pos.z, this._nrmTmp);
    }

    // ── Update (appelé chaque frame) ───────────────────────────
    update(delta) {
        if (!this._char.isLoaded) return;

        this._wander(delta);

        this._char.update(delta, {
            position:      this._pos,
            rotationY:     this._yaw,
            terrainNormal: this._nrmTmp,
            isGrounded:    true,
            isMoving:      this._walking,
            isSprinting:   false,
            isCrouching:   false,
            vy:            0,
        });
    }
}
