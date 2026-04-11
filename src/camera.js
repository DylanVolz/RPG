import * as THREE from 'three';
import { getHeight } from './world.js';
import { getCeilingHeight } from './collision.js';

// ═══════════════════════════════════════════════════════════════
//  CAMERA.JS
//
//  3e personne — comportement Witcher 3 :
//    Cursor lock (Tab) : souris tourne personnage + caméra suit collée derrière
//    Clic droit enfoncé : orbite caméra autour du personnage (perso ne tourne pas)
//
//  V → bascule 3e personne ↔ 1re personne FPS
// ═══════════════════════════════════════════════════════════════

export const CAM_THIRD = 'third';
export const CAM_FIRST = 'first';

const _offset     = new THREE.Vector3();
const _target     = new THREE.Vector3();
const _camDesired = new THREE.Vector3();

export class CameraController {
    constructor(camera, domElement) {
        this.camera = camera;
        this.dom    = domElement;
        this.mode   = CAM_THIRD;

        // ── 3e personne ──────────────────────────────────────
        this.yaw         = 0;
        this.pitch       = 0.4;
        this.distance    = 12;
        this.minDist     = 3;
        this.maxDist     = 22;
        this.sensitivity = 0.0025;

        // ── Lean (Q/E) ────────────────────────────────────────
        this._leanTarget  = 0;
        this._leanCurrent = 0;

        // ── Distance effective (réduite en intérieur) ─────────
        this._effectiveDist = this.distance;

        // ── 1re personne ─────────────────────────────────────
        this.fpYaw     = 0;
        this.fpPitch   = 0;
        this.fpSens    = 0.0020;
        this.eyeHeight = 1.75;

        // ── Pointer lock ──────────────────────────────────────
        this._locked         = false;
        this._cursorLock     = false;
        this._rightClickHeld = false;
        // Suivi de position absolue (fallback quand pointer lock pas encore accordé)
        this._prevMouseX     = 0;
        this._prevMouseY     = 0;

        this._bindEvents();
    }

    // ─────────────────────────────────────────────────────────
    _bindEvents() {
        this.dom.addEventListener('mousedown', e => {
            if (this.mode !== CAM_THIRD) return;
            if (e.button === 2) {
                this._rightClickHeld = true;
                this._prevMouseX = e.clientX;
                this._prevMouseY = e.clientY;
                // Demande pointer lock seulement si pas déjà actif
                if (!this._locked) this.dom.requestPointerLock?.();
            }
        });

        this.dom.addEventListener('mouseup', e => {
            if (e.button === 2) {
                this._rightClickHeld = false;
                if (this.mode === CAM_THIRD && !this._cursorLock) {
                    document.exitPointerLock?.();
                }
            }
        });

        this.dom.addEventListener('mousemove', e => {
            if (this._editMode) return;
            if (this.mode === CAM_THIRD) {
                if (this._rightClickHeld) {
                    // Orbite caméra — fonctionne avec ou sans pointer lock
                    // Pointer lock actif → movementX/Y illimité (meilleur)
                    // Sinon → delta depuis position absolue (fallback)
                    let dx, dy;
                    if (this._locked) {
                        dx = e.movementX;
                        dy = e.movementY;
                    } else {
                        dx = e.clientX - this._prevMouseX;
                        dy = e.clientY - this._prevMouseY;
                    }
                    this._prevMouseX = e.clientX;
                    this._prevMouseY = e.clientY;
                    this.yaw   -= dx * this.sensitivity;
                    this.pitch += dy * this.sensitivity;

                } else if (this._cursorLock && this._locked) {
                    // Cursor lock (Tab) sans clic droit : regarde + personnage suit
                    this.yaw   -= e.movementX * this.sensitivity;
                    this.pitch += e.movementY * this.sensitivity;
                }
            }

            if (this.mode === CAM_FIRST && this._locked) {
                this.fpYaw   -= e.movementX * this.fpSens;
                this.fpPitch -= e.movementY * this.fpSens;
                this.fpPitch  = Math.max(-1.4, Math.min(1.4, this.fpPitch));
            }
        });

        this.dom.addEventListener('wheel', e => {
            if (this._editMode) return;
            if (this.mode === CAM_THIRD) {
                this.distance = Math.max(this.minDist,
                    Math.min(this.maxDist, this.distance + e.deltaY * 0.012));
            }
        }, { passive: true });

        document.addEventListener('pointerlockchange', () => {
            this._locked = document.pointerLockElement === this.dom;
        });
    }

    // ── Tab : toggle cursor lock (fonctionne en FPS et 3e personne) ──
    toggleCursorLock() {
        this._cursorLock = !this._cursorLock;
        if (this._cursorLock) {
            this.dom.requestPointerLock?.();
        } else {
            document.exitPointerLock?.();
        }
        return this._cursorLock;
    }

    get cursorLockActive() { return this._cursorLock; }

    // ── V : toggle 3e ↔ 1re personne ─────────────────────────
    toggleMode(playerPos) {
        if (this.mode === CAM_THIRD) {
            this.fpYaw   = this.yaw;
            this.fpPitch = this.pitch - 0.4;
            this.mode    = CAM_FIRST;
            // En FPS le cursor lock est actif par défaut (on peut Tab pour le libérer)
            this._cursorLock = true;
            this.dom.requestPointerLock?.();
            document.getElementById('crosshair').style.display = 'block';
            document.getElementById('camera-mode').textContent = '1ST';
        } else {
            this.yaw     = this.fpYaw;
            this.pitch   = this.fpPitch + 0.4;
            this.mode    = CAM_THIRD;
            // Conserver l'état cursor lock du mode 3e personne
            if (!this._cursorLock) document.exitPointerLock?.();
            document.getElementById('crosshair').style.display = 'none';
            document.getElementById('camera-mode').textContent = '3RD';
        }
    }

    // ── API cursor pour menu / inventaire ────────────────────
    releaseCursor() {
        document.exitPointerLock?.();
    }

    captureCursor() {
        if (this._cursorLock) {
            this.dom.requestPointerLock?.();
        }
    }

    isLocked()   { return this._locked; }
    setLean(dir) { this._leanTarget = dir; }

    /** Appelé par BuildMode — suspend tous les traitements souris/caméra. */
    setEditMode(on) {
        this._editMode = on;
        if (on) {
            // Figer le lean
            this._leanTarget  = 0;
            this._leanCurrent = 0;
        }
    }

    getCameraYaw() {
        return this.mode === CAM_FIRST ? this.fpYaw : this.yaw;
    }

    /**
     * Retourne le yaw à imposer au personnage, ou null si le perso
     * s'oriente librement vers sa direction de déplacement.
     *
     * Witcher 3 :
     *   cursor lock SANS clic droit → perso suit la caméra
     *   clic droit (orbite)         → perso ignore la caméra
     */
    getCharacterYaw() {
        if (this.mode === CAM_FIRST) return this.fpYaw;
        if (this.mode === CAM_THIRD && this._cursorLock && !this._rightClickHeld) return this.yaw;
        return null;
    }

    update(delta, playerPos, playerMesh) {
        // Lean animation partagée entre les deux modes
        this._leanCurrent += (this._leanTarget * 3.0 - this._leanCurrent)
                             * Math.min(1, delta * 10);

        if (this.mode === CAM_THIRD) this._updateThird(delta, playerPos);
        else                         this._updateFirst(playerPos);
    }

    _updateThird(delta, playerPos) {
        // Distance réduite automatiquement en intérieur (plafond détecté)
        const playerCeil = getCeilingHeight(playerPos.x, playerPos.z);
        const indoors    = playerCeil < Infinity;
        const distTarget = indoors ? Math.min(this.distance, 5.5) : this.distance;
        this._effectiveDist += (distTarget - this._effectiveDist) * Math.min(1, delta * 4);

        const sinYaw   = Math.sin(this.yaw);
        const cosYaw   = Math.cos(this.yaw);
        const cosPitch = Math.cos(this.pitch);
        const sinPitch = Math.sin(this.pitch);
        const dist     = this._effectiveDist;

        _offset.set(
            sinYaw * cosPitch * dist,
            sinPitch * dist + 2,
            cosYaw * cosPitch * dist,
        );

        _target.copy(playerPos);
        _target.y += 1.4;

        _camDesired.copy(_target).add(_offset);

        // ── Lean Q/E ─────────────────────────────────────────
        if (Math.abs(this._leanCurrent) > 0.001) {
            _camDesired.x += cosYaw  *  this._leanCurrent;
            _camDesired.z += -sinYaw *  this._leanCurrent;
            _target.x     += cosYaw  *  this._leanCurrent * 0.4;
            _target.z     += -sinYaw *  this._leanCurrent * 0.4;
        }

        // Anti-clip terrain
        const terrainY = getHeight(_camDesired.x, _camDesired.z);
        if (_camDesired.y < terrainY + 0.5) _camDesired.y = terrainY + 0.5;

        // Anti-clip plafond structurel
        const ceilY = getCeilingHeight(_camDesired.x, _camDesired.z);
        if (_camDesired.y > ceilY - 0.25) _camDesired.y = ceilY - 0.25;

        const followSpeed = (this._cursorLock && !this._rightClickHeld) ? 0.55 : 0.12;
        this.camera.position.lerp(_camDesired, followSpeed);
        this.camera.lookAt(_target);
    }

    _updateFirst(playerPos) {
        // Décalage latéral lors du lean
        const leanX = Math.cos(this.fpYaw) * this._leanCurrent * 0.35;
        const leanZ = -Math.sin(this.fpYaw) * this._leanCurrent * 0.35;

        this.camera.position.set(
            playerPos.x + leanX,
            playerPos.y + this.eyeHeight,
            playerPos.z + leanZ,
        );
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.fpYaw;
        this.camera.rotation.x = this.fpPitch;
        this.camera.rotation.z = -this._leanCurrent * 0.18;  // roulis tête
    }

    getForward(_out) {
        _out.set(
            -Math.sin(this.fpYaw) * Math.cos(this.fpPitch),
            0,
            -Math.cos(this.fpYaw) * Math.cos(this.fpPitch),
        ).normalize();
    }
}
