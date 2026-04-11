import * as THREE from 'three';
import { getHeight, getTerrainNormal, getDominantZone } from './world.js';
import { getStructureHeight, getCeilingHeight, resolveWallCollision } from './collision.js';
import { CAM_FIRST } from './camera.js';
import { CharacterController } from './character.js';
import { resolveCharConfig } from './char-config.js';

const CHAR_ANIMS = [
    'assets/characters/animations/UAL1_Standard.glb',
    'assets/characters/animations/UAL2_Standard.glb',
];
const CHAR_CLIPS = {
    idle        : 'Idle_Loop',
    walk        : 'Walk_Loop',
    run         : 'Sprint_Loop',
    jump        : 'Jump_Start',
    fall        : 'Jump_Loop',
    crouch_idle : 'Crouch_Idle_Loop',
    crouch_walk : 'Crouch_Fwd_Loop',
};

// ═══════════════════════════════════════════════════════════════
//  PLAYER.JS — Personnage, stats vivantes, mouvement, grimpe
// ═══════════════════════════════════════════════════════════════

// Vecteurs réutilisables
const _moveDir   = new THREE.Vector3();
const _flatFwd   = new THREE.Vector3();
const _flatRight = new THREE.Vector3();
const _up        = new THREE.Vector3(0, 1, 0);
const _tempPos   = new THREE.Vector3();
// Inclinaison terrain — vecteurs et quaternions réutilisables
const _terrainNrm  = new THREE.Vector3();
const _tiltQuat    = new THREE.Quaternion();
const _yawQuat     = new THREE.Quaternion();
const _targetQuat  = new THREE.Quaternion();

// ─────────────────────────────────────────────────────────────
//  STATS — 8 attributs, tous 0–100, dérivent par le comportement
// ─────────────────────────────────────────────────────────────
export const STAT_NAMES = {
    force       : 'Force',
    endurance   : 'Endurance',
    agilite     : 'Agilité',
    intelligence: 'Intelligence',
    eloquence   : 'Éloquence',
    perception  : 'Perception',
    volonte     : 'Volonté',
    ombre       : 'Ombre',
};

// Tensions entre attributs (monter l'un freine l'autre passivement)
const STAT_TENSIONS = [
    ['force',    'intelligence', 0.08],
    ['eloquence','ombre',        0.06],
    ['volonte',  'eloquence',    0.05],
    ['agilite',  'endurance',    0.04],
];

// ─────────────────────────────────────────────────────────────
//  MESH JOUEUR  — capsule simple pour commencer
// ─────────────────────────────────────────────────────────────
function _buildPlayerMesh() {
    const g = new THREE.Group();

    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3a3028 });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0x7a5a40 });

    // Corps
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.32, 1.1, 8), bodyMat
    );
    body.position.y = 0.85;
    g.add(body);

    // Tête
    const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 8, 6), skinMat
    );
    head.position.y = 1.72;
    g.add(head);

    // Jambes
    for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.11, 0.09, 0.72, 6), bodyMat
        );
        leg.position.set(sx * 0.14, 0.36, 0);
        leg.userData.isLeg = true;
        leg.userData.phase = sx > 0 ? 0 : Math.PI;
        g.add(leg);
    }

    // Bras
    for (const sx of [-1, 1]) {
        const arm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.07, 0.65, 6), bodyMat
        );
        arm.position.set(sx * 0.38, 1.0, 0);
        arm.rotation.z = sx * 0.25;
        arm.userData.isArm = true;
        arm.userData.phase = sx > 0 ? Math.PI : 0;
        g.add(arm);
    }

    g.traverse(c => { c.frustumCulled = false; });
    return g;
}

// ─────────────────────────────────────────────────────────────
//  CLASSE PLAYER
// ─────────────────────────────────────────────────────────────
export class Player {
    constructor(scene, startX, startZ) {
        // ── Stats vivantes ────────────────────────────────
        this.stats = {
            force       : 50,
            endurance   : 50,
            agilite     : 50,
            intelligence: 50,
            eloquence   : 50,
            perception  : 50,
            volonte     : 50,
            ombre       : 50,
        };

        // ── Santé et endurance de jeu ──────────────────────
        this.hp         = 100;
        this.maxHp      = 100;
        this.stamina    = 100;
        this.maxStamina = 100;

        // ── Mouvement ─────────────────────────────────────
        this.speed      = 5.5;
        this.sprintMult = 1.8;
        this.isSprinting= false;
        this.isGrounded = true;
        this._vy        = 0;        // vélocité verticale
        this._jumpForce = 7.0;

        // ── Grimpe ────────────────────────────────────────
        this.isClimbing      = false;
        this._climbProgress  = 0;   // 0–1 pendant une grimpe
        this._climbTarget    = new THREE.Vector3();

        // ── Rotation et orientation ────────────────────────
        this._targetYaw   = 0;       // yaw cible (non lissé)
        this._currentYaw  = 0;       // yaw lissé pur — jamais contaminé par le tilt
        this._forceCamYaw = null;    // non-null en cursor lock → perso suit la caméra

        // ── Accroupissement ───────────────────────────────────
        // isCrouching = getter → _crouchToggle (C) OU _crouchHold (Ctrl)
        this._crouchToggle = false;
        this._crouchHold   = false;

        // ── Position ──────────────────────────────────────
        const startY = getHeight(startX, startZ);
        this.position = new THREE.Vector3(startX, startY, startZ);

        // ── Mesh ──────────────────────────────────────────
        this.mesh = _buildPlayerMesh();
        this.mesh.name = '__player__';
        this.mesh.position.copy(this.position);
        scene.add(this.mesh);

        // ── Walk animation (mesh procédural) ──────────────
        this._walkTimer = 0;

        // ── Suivi mouvement (pour state machine) ──────────
        this._isMoving = false;

        // ── CharacterController ────────────────────────────
        this._char = new CharacterController(scene);
        const _charCfg = resolveCharConfig(); // lit darkrpg_character_v1
        console.log('[Player] Config personnage :', _charCfg);
        this._char.loadRetargeted(_charCfg.meshUrl, CHAR_ANIMS, CHAR_CLIPS, {
            baseBodyUrl    : _charCfg.baseUrl,
            hairUrl        : _charCfg.hairUrl,
            beardUrl       : _charCfg.beardUrl,
            hairColor      : _charCfg.hairColor,
            eyeColor       : _charCfg.eyeColor,
            boneScaleBody  : _charCfg.boneScaleBody,
            boneScaleOutfit: _charCfg.boneScaleOutfit,
        }).then(() => {
            // GLB chargé → cacher le mesh procédural
            this.mesh.visible = false;
        }).catch(err => {
            console.warn('[Player] Chargement personnage échoué, mesh procédural utilisé :', err);
        });

        // ── Dérive d'identité — accumulateurs ─────────────
        this._driftAccum = Object.fromEntries(Object.keys(this.stats).map(k => [k, 0]));
        this._driftThreshold = 8;   // accumulation avant message

        // ── Callbacks ─────────────────────────────────────
        this.onDriftMessage = null; // (statName, delta) => void
        this.onStepSound    = null;
    }

    // ── Input ─────────────────────────────────────────────────
    /** Appelé par game.js à chaque frame avec les touches actives */
    update(delta, keys, camYaw, camMode) {
        this._isMoving = false;   // réinitialisé dans _move si touches actives
        this._move(delta, keys, camYaw, camMode);
        this._physics(delta);
        this._animate(delta, keys);
        this._staminaRegen(delta, keys);

        // CharacterController — state machine + mixer
        if (this._char.isLoaded) {
            this._char.update(delta, {
                position:      this.position,
                rotationY:     this._currentYaw,   // yaw pur — sans dérive tilt
                terrainNormal: _terrainNrm,         // normale terrain pour le tilt GLB
                isGrounded:    this.isGrounded,
                isMoving:      this._isMoving,
                isSprinting:   this.isSprinting,
                isCrouching:   this.isCrouching,
                vy:            this._vy,
            });
        }
    }

    // ── Mouvement horizontal ──────────────────────────────────
    _move(delta, keys, camYaw, camMode) {
        const fwd  = keys.has('KeyW') || keys.has('ArrowUp');
        const back = keys.has('KeyS') || keys.has('ArrowDown');
        const left = keys.has('KeyA') || keys.has('ArrowLeft');
        const rght = keys.has('KeyD') || keys.has('ArrowRight');
        const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');

        this.isSprinting = sprint && fwd && this.stamina > 5;
        this._isMoving   = fwd || back || left || rght;

        if (!fwd && !back && !left && !rght) return;

        // Direction relative à la caméra
        _flatFwd.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
        _flatRight.set(Math.cos(camYaw), 0, -Math.sin(camYaw));

        _moveDir.set(0, 0, 0);
        if (fwd)  _moveDir.addScaledVector(_flatFwd,   1);
        if (back) _moveDir.addScaledVector(_flatFwd,  -1);
        if (rght) _moveDir.addScaledVector(_flatRight,  1);
        if (left) _moveDir.addScaledVector(_flatRight, -1);

        if (_moveDir.lengthSq() < 0.001) return;
        _moveDir.normalize();

        const spd = this.speed * (this.isSprinting ? this.sprintMult : 1.0);
        this.position.x += _moveDir.x * spd * delta;
        this.position.z += _moveDir.z * spd * delta;

        // Résolution collision murs
        const headH = this.isCrouching ? 1.0 : 1.85;
        resolveWallCollision(this.position, 0.35, this.position.y, headH);

        // Orienter le mesh
        if (camMode !== CAM_FIRST) {
            this._targetYaw = Math.atan2(_moveDir.x, _moveDir.z);
        } else {
            this._targetYaw = camYaw + Math.PI;
        }
        // En cursor lock 3e personne, le perso suit la direction caméra même sans bouger
        if (camMode !== CAM_FIRST && this._forceCamYaw !== null) {
            this._targetYaw = this._forceCamYaw + Math.PI;
        }

        // Consommer endurance au sprint
        if (this.isSprinting) {
            this.stamina = Math.max(0, this.stamina - 12 * delta);
        }

        // Accumulation stat Force si on se déplace (très lentement)
        this._accumStat('endurance', delta * 0.01);
    }

    // ── Physique verticale ────────────────────────────────────
    _physics(delta) {
        const terrainY   = getHeight(this.position.x, this.position.z);
        const structureY = getStructureHeight(this.position.x, this.position.z, this.position.y);
        const groundY    = Math.max(terrainY, structureY);

        if (!this.isGrounded) {
            this._vy -= 18 * delta;  // gravité
            this.position.y += this._vy * delta;

            if (this.position.y <= groundY) {
                this.position.y = groundY;
                this._vy        = 0;
                this.isGrounded = true;
            }
        } else {
            if (groundY < this.position.y - 0.05) {
                // Marché dans le vide — tomber
                this.isGrounded = false;
                this._vy = 0;
            } else {
                // Coller à la surface (terrain ou structure)
                this.position.y = groundY;
            }
        }

        // ── Collision plafond ──────────────────────────────────
        const headH  = this.isCrouching ? 1.0 : 1.85;
        const ceilY  = getCeilingHeight(this.position.x, this.position.z);
        if (this.position.y + headH > ceilY) {
            this.position.y = ceilY - headH;
            if (this._vy > 0) this._vy = 0;
        }

        // Mise à jour du mesh procédural
        this.mesh.position.copy(this.position);

        // ── Yaw lissé pur (jamais contaminé par le tilt) ─────────
        let dyaw = this._targetYaw - this._currentYaw;
        while (dyaw > Math.PI)  dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        this._currentYaw += dyaw * 0.18;

        // ── Inclinaison terrain (article §2/3) ────────────────────
        // Toujours calculer la normale (utile en l'air aussi pour CharacterController)
        getTerrainNormal(this.position.x, this.position.z, _terrainNrm);

        if (this.isGrounded) {
            const slope = Math.acos(Math.min(1, _terrainNrm.y));
            if (slope < 0.87) {
                _tiltQuat.setFromUnitVectors(_up, _terrainNrm);
                _yawQuat.setFromAxisAngle(_up, this._currentYaw);
                _targetQuat.multiplyQuaternions(_tiltQuat, _yawQuat);
                this.mesh.quaternion.slerp(_targetQuat, Math.min(1, 8 * delta));
            } else {
                _yawQuat.setFromAxisAngle(_up, this._currentYaw);
                this.mesh.quaternion.slerp(_yawQuat, Math.min(1, 8 * delta));
            }
        } else {
            // En l'air : yaw seul, pas de tilt
            _yawQuat.setFromAxisAngle(_up, this._currentYaw);
            this.mesh.quaternion.slerp(_yawQuat, Math.min(1, 8 * delta));
        }

    }

    // ── Saut ──────────────────────────────────────────────────
    jump() {
        if (!this.isGrounded || this.stamina < 10) return;
        this._vy        = this._jumpForce;
        this.isGrounded = false;
        this.stamina   -= 10;
    }

    // ── Accroupissement ───────────────────────────────────────
    get isCrouching() { return this._crouchToggle || this._crouchHold; }

    _canStandUp() {
        return this.position.y + 1.85 <= getCeilingHeight(this.position.x, this.position.z);
    }

    _applyCrouchVisual() {
        const c = this.isCrouching;
        this.mesh.scale.y = c ? 0.55 : 1.0;
        this.mesh.position.y = this.position.y + (c ? -0.35 : 0);
    }

    /** C : toggle accroupissement */
    toggleCrouch() {
        if (this._crouchToggle && !this._canStandUp()) return;  // plafond bloque
        this._crouchToggle = !this._crouchToggle;
        this._applyCrouchVisual();
        if (this.isCrouching) this._accumStat('ombre', 0.1);
    }

    /** Ctrl : maintien accroupissement (hold) */
    setCrouchHold(held) {
        if (!held && this._crouchHold && !this._crouchToggle && !this._canStandUp()) return;
        this._crouchHold = held;
        this._applyCrouchVisual();
    }

    // ── Régénération d'endurance ──────────────────────────────
    _staminaRegen(delta, keys) {
        if (!this.isSprinting) {
            this.stamina = Math.min(this.maxStamina, this.stamina + 8 * delta);
        }
    }

    // ── Animation de marche ───────────────────────────────────
    _animate(delta, keys) {
        const moving = keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD');
        if (!moving) {
            // Respiration idle
            this._walkTimer += delta * 0.8;
            this.mesh.children.forEach(c => {
                if (c.userData.isArm) c.rotation.x = Math.sin(this._walkTimer) * 0.04;
            });
            return;
        }

        const freq = this.isSprinting ? 6 : 3.5;
        this._walkTimer += delta * freq;

        this.mesh.children.forEach(c => {
            if (c.userData.isLeg) {
                c.rotation.x = Math.sin(this._walkTimer + c.userData.phase) * 0.45;
            }
            if (c.userData.isArm) {
                c.rotation.x = Math.sin(this._walkTimer + c.userData.phase + Math.PI) * 0.35;
            }
        });

        // Bob vertical léger du mesh
        this.mesh.position.y = this.position.y + Math.abs(Math.sin(this._walkTimer)) * 0.04;
    }

    // ── Système de dérive des stats ───────────────────────────
    /**
     * Accumule une modification de stat. Quand le seuil est atteint,
     * déclenche la dérive réelle + message narratif.
     */
    _accumStat(statName, amount) {
        if (!this.stats.hasOwnProperty(statName)) return;
        this._driftAccum[statName] = (this._driftAccum[statName] || 0) + Math.abs(amount);
        const sign = amount >= 0 ? 1 : -1;

        if (this._driftAccum[statName] >= this._driftThreshold) {
            this._driftAccum[statName] = 0;
            this._applyDrift(statName, sign * 0.5);
        }
    }

    /** Applique la dérive effective + tensions entre stats */
    _applyDrift(statName, delta) {
        this.stats[statName] = Math.max(1, Math.min(99, this.stats[statName] + delta));

        // Tensions passives
        for (const [a, b, factor] of STAT_TENSIONS) {
            if (statName === a) {
                this.stats[b] = Math.max(1, Math.min(99, this.stats[b] - delta * factor));
            } else if (statName === b) {
                this.stats[a] = Math.max(1, Math.min(99, this.stats[a] - delta * factor));
            }
        }

        // Callback vers UI pour le message narratif
        if (this.onDriftMessage) this.onDriftMessage(statName, delta);
    }

    /** API publique pour les systèmes externes (combat, dialogue, etc.) */
    drift(statName, amount) {
        this._accumStat(statName, amount);
    }

    // ── Accès position pour les autres systèmes ───────────────
    getPosition() { return this.position; }

    // ── Visibilité mesh (FPS = invisible) ────────────────────
    setMeshVisible(visible) {
        this.mesh.visible = this._char.isLoaded ? false : visible;
        this._char.setVisible(visible);
    }
}
