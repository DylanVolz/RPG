import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Vecteurs/quaternions réutilisables pour l'inclinaison terrain (zéro allocation)
const _charUp         = new THREE.Vector3(0, 1, 0);

// ── Bone scaling isolé (même algo que char-builder) ─────────────────────
// Objectif : worldScale(bone sans override) = 1.0 malgré les parents scalés
function applyIsolatedScales(root, overrides, restPos) {
    if (!root) return;
    // Passe 1 — reset à l'état de repos (évite accumulation entre frames)
    root.traverse(n => {
        if (!n.isBone) return;
        n.scale.set(1, 1, 1);
        const rp = restPos[n.name];
        if (rp) n.position.copy(rp);
    });
    if (!Object.keys(overrides).length) return;
    // Passe 2 — overrides + counter-scale/position pour les bones sans override
    const wsMap = {};
    root.traverse(node => {
        if (!node.isBone) return;
        const pWS = (node.parent?.isBone) ? (wsMap[node.parent.name] ?? 1) : 1;
        const s   = overrides[node.name];
        if (pWS !== 1) {
            const rp = restPos[node.name];
            if (rp) node.position.copy(rp).multiplyScalar(1 / pWS);
        }
        if (s !== undefined) {
            node.scale.setScalar(s);
            wsMap[node.name] = pWS * s;
        } else if (pWS !== 1) {
            node.scale.setScalar(1 / pWS); // counter-scale → worldScale = 1
            wsMap[node.name] = 1;
        } else {
            wsMap[node.name] = 1;
        }
    });
}
// ── Shader corps : garder seulement neck_01 + Head visible ──────────────
// Même logique que char-builder — évite que la peau dépasse de l'outfit.
function _injectBodyShader(mesh) {
    const sk = mesh.skeleton?.bones;
    if (!sk) return;
    const iNeck = sk.findIndex(b => b.name === 'neck_01');
    const iHead = sk.findIndex(b => b.name === 'Head');
    if (iNeck < 0 && iHead < 0) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => {
        if (!m) return;
        m.onBeforeCompile = shader => {
            shader.uniforms.uINeck = { value: iNeck };
            shader.uniforms.uIHead = { value: iHead };
            shader.vertexShader = shader.vertexShader.replace(
                '#include <skinning_pars_vertex>',
                `#include <skinning_pars_vertex>
uniform float uINeck,uIHead;
varying float vKeepW;`
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <skinning_vertex>',
                `#include <skinning_vertex>
{float n=uINeck,h=uIHead;
 vKeepW  =(skinIndex.x==n||skinIndex.x==h)?skinWeight.x:0.0;
 vKeepW +=(skinIndex.y==n||skinIndex.y==h)?skinWeight.y:0.0;
 vKeepW +=(skinIndex.z==n||skinIndex.z==h)?skinWeight.z:0.0;
 vKeepW +=(skinIndex.w==n||skinIndex.w==h)?skinWeight.w:0.0;}`
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                'void main() {',
                `varying float vKeepW;
void main() {
if(vKeepW < 0.15) discard;`
            );
        };
        m.needsUpdate = true;
    });
}

// ── Shader iris yeux ─────────────────────────────────────────────────────
function _injectEyeShader(mesh, hexColor) {
    if (!hexColor) return;
    const col = new THREE.Color(hexColor);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => {
        if (!m) return;
        m.onBeforeCompile = shader => {
            shader.uniforms.uIrisColor = { value: col };
            shader.fragmentShader = shader.fragmentShader.replace('void main() {',
                `uniform vec3 uIrisColor;\nvoid main() {`);
            shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
                `#include <map_fragment>
{float lum=dot(diffuseColor.rgb,vec3(0.299,0.587,0.114));
 float mask=1.0-smoothstep(0.08,0.45,lum);
 diffuseColor.rgb=mix(diffuseColor.rgb,uIrisColor,mask*0.88);}`
            );
        };
        m.needsUpdate = true;
    });
}

const _charTiltQuat   = new THREE.Quaternion();
const _charYawQuat    = new THREE.Quaternion();
const _charTargetQuat = new THREE.Quaternion();

// ═══════════════════════════════════════════════════════════════
//  CHARACTER.JS — Chargeur GLB + AnimationMixer + State Machine
//
//  Usage :
//    const char = new CharacterController(scene);
//    await char.load(url, clipMap);         // charger le GLB
//    char.update(delta, playerState);       // chaque frame
//
//  playerState = {
//    position   : THREE.Vector3,
//    rotationY  : number,
//    isGrounded : bool,
//    isMoving   : bool,
//    isSprinting: bool,
//    isCrouching: bool,
//    vy         : number,   // vélocité verticale
//  }
//
//  clipMap = {
//    idle        : 'NomDuClip',    // obligatoire
//    walk        : 'NomDuClip',
//    run         : 'NomDuClip',
//    crouch_idle : 'NomDuClip',    // optionnel → fallback auto
//    crouch_walk : 'NomDuClip',    // optionnel → fallback auto
//    jump        : 'NomDuClip',    // optionnel → fallback auto
//    fall        : 'NomDuClip',    // optionnel → fallback auto
//    land        : 'NomDuClip',    // optionnel → one-shot
//    attack      : 'NomDuClip',    // optionnel → one-shot
//    death       : 'NomDuClip',    // optionnel → one-shot
//  }
//
//  Si un état n'a pas de clip dans le GLB,
//  un fallback logique est utilisé automatiquement.
// ═══════════════════════════════════════════════════════════════

// États one-shot (pas en boucle, clamp à la fin)
const ONE_SHOT_STATES = new Set(['jump', 'land', 'attack', 'death']);

// Fallbacks logiques par état manquant
const FALLBACKS = {
    crouch_idle : ['idle'],
    crouch_walk : ['walk', 'idle'],
    fall        : ['idle'],
    jump        : ['run', 'walk', 'idle'],
    land        : ['idle'],
    attack      : ['idle'],
    death       : ['idle'],
};

export class CharacterController {

    constructor(scene) {
        this._scene        = scene;
        this._root         = null;
        this._mixer        = null;
        this._actions      = {};      // état → AnimationAction
        this._active       = null;    // action en cours
        this._state        = null;    // nom d'état en cours
        this._yOffset      = 0;       // offset pieds (calibration GLB)
        this._rotOffset    = 0;       // correction orientation du modèle
        this._targetHeight  = 1.75;    // hauteur cible (pour le clip plane)
        this._bodyClipPlane = null;   // plan de découpe pour la tête (corps de base)
        this._headBone      = null;   // os head pour ancrer le clip plane à l'animation
        this._headBoneWP    = new THREE.Vector3(); // zéro allocation

        this._boneOverrides = {};     // boneName → scale (fusionné body+outfit depuis char-builder)
        this._boneRestPos   = {};     // positions de repos T-Pose pour contre-ajustement

        this.isLoaded = false;
    }

    // ── Chargement ─────────────────────────────────────────────
    /**
     * Charge le GLB, calibre la taille à 1.75m, crée les actions.
     *
     * @param {string} url          — chemin vers le .glb
     * @param {object} clipMap      — { etat: 'NomClipDansGLB', ... }
     * @param {object} opts
     *   targetHeight {number}      — hauteur cible en mètres (défaut 1.75)
     *   rotationOffset {number}    — correction orientation (défaut Math.PI * 1.5)
     * @returns {Promise<CharacterController>}
     */
    load(url, clipMap, { targetHeight = 1.75, rotationOffset = 0 } = {}) {
        this._rotOffset = rotationOffset;

        return new Promise((resolve, reject) => {
            new GLTFLoader().load(url, (gltf) => {

                const root = gltf.scene;

                // Ombres + frustum + double face (évite le vide sous la capuche)
                root.traverse(c => {
                    if (c.isMesh) {
                        c.castShadow    = true;
                        c.receiveShadow = true;
                        c.frustumCulled = false;
                        const mats = Array.isArray(c.material) ? c.material : [c.material];
                        for (const m of mats) if (m) m.side = THREE.DoubleSide;
                    }
                });

                // Calibration : scale → targetHeight
                root.position.set(0, 0, 0);
                root.rotation.set(0, 0, 0);
                const box    = new THREE.Box3().setFromObject(root);
                const height = box.max.y - box.min.y;
                root.scale.setScalar(targetHeight / height);
                box.setFromObject(root);
                this._yOffset = -box.min.y;

                this._root  = root;
                this._mixer = new THREE.AnimationMixer(root);
                this._scene.add(root);

                // Index des clips disponibles dans le GLB
                const available = {};
                for (const clip of gltf.animations) {
                    available[clip.name] = clip;
                }

                // Construire la table état → action
                for (const [state, clipName] of Object.entries(clipMap)) {
                    const clip = available[clipName];
                    if (clip) {
                        this._actions[state] = this._mixer.clipAction(clip);
                        // Configurer les one-shots
                        if (ONE_SHOT_STATES.has(state)) {
                            this._actions[state].setLoop(THREE.LoopOnce, 1);
                            this._actions[state].clampWhenFinished = true;
                        }
                    } else {
                        console.warn(`[Character] Clip introuvable pour l'état "${state}" : "${clipName}"`);
                    }
                }

                this.isLoaded = true;
                this._playState('idle', 0);

                console.log('[Character] Chargé ✓  États disponibles :', Object.keys(this._actions));
                resolve(this);

            }, undefined, (err) => {
                console.error('[Character] Erreur chargement :', err);
                reject(err);
            });
        });
    }

    // ── Chargement mesh + animations séparés (retargeting) ────────
    /**
     * Charge un mesh (outfit gltf) + une ou plusieurs bibliothèques d'animations.
     * Les os sont matchés par nom (même rig Quaternius pour tous les packs).
     *
     * @param {string}          meshUrl     — outfit .gltf
     * @param {string|string[]} animUrls    — UAL .glb (un ou plusieurs)
     * @param {object}          clipMap     — { etat: 'NomClip', ... }
     * @param {object}          opts
     *   targetHeight {number}              — hauteur cible en mètres (défaut 1.75)
     *   rotationOffset {number}            — correction orientation (défaut 0)
     *   baseBodyUrl {string|null}          — corps de base pour attacher la tête
     */
    loadRetargeted(meshUrl, animUrls, clipMap,
                   { targetHeight = 1.75, rotationOffset = 0, baseBodyUrl = null,
                     hairUrl = null, beardUrl = null, hairColor = null, eyeColor = null,
                     boneScaleBody = {}, boneScaleOutfit = {} } = {}) {
        this._rotOffset     = rotationOffset;
        this._targetHeight  = targetHeight;
        this._eyeColor      = eyeColor;
        const loader    = new GLTFLoader();

        const urlArr = Array.isArray(animUrls) ? animUrls : [animUrls];

        const pMesh  = new Promise((res, rej) => loader.load(meshUrl, res, undefined, rej));
        const pAnims = Promise.all(urlArr.map(u => new Promise((res, rej) => loader.load(u, res, undefined, rej))));
        const pBase  = baseBodyUrl
            ? new Promise((res, rej) => loader.load(baseBodyUrl, res, undefined, rej))
            : Promise.resolve(null);
        const pHair  = hairUrl  ? new Promise((res, rej) => loader.load(hairUrl,  res, undefined, rej)) : Promise.resolve(null);
        const pBeard = beardUrl ? new Promise((res, rej) => loader.load(beardUrl, res, undefined, rej)) : Promise.resolve(null);

        return Promise.all([pMesh, pAnims, pBase, pHair, pBeard]).then(([meshGltf, animGltfs, baseGltf, hairGltf, beardGltf]) => {
            const root = meshGltf.scene;

            root.traverse(c => {
                if (c.isMesh) {
                    c.castShadow    = true;
                    c.receiveShadow = true;
                    c.frustumCulled = false;
                    const mats = Array.isArray(c.material) ? c.material : [c.material];
                    for (const m of mats) if (m) m.side = THREE.DoubleSide;
                }
            });

            // Calibration → targetHeight
            root.position.set(0, 0, 0);
            root.rotation.set(0, 0, 0);
            const box    = new THREE.Box3().setFromObject(root);
            const height = box.max.y - box.min.y;
            root.scale.setScalar(targetHeight / height);
            box.setFromObject(root);
            this._yOffset = -box.min.y;

            this._root  = root;
            this._mixer = new THREE.AnimationMixer(root);
            this._scene.add(root);

            // Proportions depuis char-builder : fusionner body+outfit (outfit prioritaire)
            // et capturer les positions T-Pose avant tout override
            this._boneOverrides = { ...boneScaleBody, ...boneScaleOutfit };
            this._boneRestPos   = {};
            root.traverse(n => { if (n.isBone) this._boneRestPos[n.name] = n.position.clone(); });

            // Fusion clips — UAL1 d'abord, UAL2 par-dessus (override si même nom)
            const available = {};
            for (const animGltf of animGltfs) {
                for (const clip of animGltf.animations) {
                    available[clip.name] = clip;
                }
            }
            const clipNames = Object.keys(available);
            console.log(`[Character] ${clipNames.length} clips disponibles (${urlArr.length} source(s))`);

            // Mots-clés de recherche par état (fallback insensible à la casse)
            const KEYWORDS = {
                idle        : ['idle_loop', 'idle'],
                walk        : ['walk_loop', 'walk_forward', 'walk'],
                run         : ['sprint_loop', 'jog_fwd', 'run_forward', 'run'],
                crouch_idle : ['crouch_idle_loop', 'crouch_idle', 'crouch'],
                crouch_walk : ['crouch_fwd_loop', 'crouch_fwd', 'crouch_walk'],
                jump        : ['jump_start', 'jump'],
                fall        : ['jump_loop', 'fall_idle', 'fall'],
            };

            for (const [state, clipName] of Object.entries(clipMap)) {
                let clip = available[clipName];
                if (!clip) {
                    const lo = clipName.toLowerCase();
                    clip = available[clipNames.find(n => n.toLowerCase() === lo)];
                }
                if (!clip && KEYWORDS[state]) {
                    for (const kw of KEYWORDS[state]) {
                        const found = clipNames.find(n => n.toLowerCase().includes(kw));
                        if (found) { clip = available[found]; break; }
                    }
                }
                if (clip) {
                    this._actions[state] = this._mixer.clipAction(clip);
                    if (ONE_SHOT_STATES.has(state)) {
                        this._actions[state].setLoop(THREE.LoopOnce, 1);
                        this._actions[state].clampWhenFinished = true;
                    }
                    console.log(`[Character] "${state}" → "${clip.name}"`);
                } else {
                    console.warn(`[Character] Aucun clip trouvé pour "${state}"`);
                }
            }

            if (!this._actions['idle'] && clipNames.length > 0) {
                this._actions['idle'] = this._mixer.clipAction(available[clipNames[0]]);
                console.warn(`[Character] Idle forcé sur "${clipNames[0]}"`);
            }

            // Attacher la tête du corps de base si fourni
            if (baseGltf)  this._attachHead(baseGltf.scene, root);
            if (hairGltf)  this._attachHairSlot(hairGltf.scene);
            if (beardGltf) this._attachHairSlot(beardGltf.scene);
            if (hairColor) this._applyHairColor(hairColor);

            this.isLoaded = true;
            this._playState('idle', 0);
            console.log('[Character] Retargeted ✓  États actifs :', Object.keys(this._actions));
            return this;
        }).catch(err => {
            console.error('[Character] Erreur loadRetargeted :', err);
            throw err;
        });
    }

    // ── Attachement tête (Universal Base Characters) ───────────
    /**
     * Extrait Eyebrows + Eyes du corps de base et les rebinde
     * sur le squelette de l'outfit (os de même nom → compatible Quaternius).
     */
    _attachHead(baseRoot, outfitRoot) {
        // Table des os de l'outfit (nom → Bone)
        const outfitBones = {};
        outfitRoot.traverse(node => {
            if (node.isBone) outfitBones[node.name] = node;
        });

        // Détection générique par bones — fonctionne avec n'importe quel pack Quaternius
        // Mesh "tête-lié" : a neck_01 ou Head dans son squelette
        const _isHeadRelated = n => n.isSkinnedMesh &&
            n.skeleton?.bones.some(b => b.name === 'neck_01' || b.name === 'Head');
        // Mesh "corps complet" : a aussi des bones spine → reçoit le shader neck+head
        const _isBodyMesh = n => {
            if (!n.skeleton) return false;
            const names = new Set(n.skeleton.bones.map(b => b.name));
            return (names.has('neck_01') || names.has('Head')) &&
                   (names.has('spine_01') || names.has('spine_02') || names.has('spine_03'));
        };

        // 1re passe : collecter sans modifier l'arbre
        const toAttach = [];
        baseRoot.traverse(node => {
            if (_isHeadRelated(node)) toAttach.push(node);
        });

        // 2e passe : rebind + ajout (l'arbre n'est plus en cours de traversal)
        for (const node of toAttach) {
            const newBones = node.skeleton.bones.map(b => outfitBones[b.name]);
            if (newBones.some(b => !b)) {
                console.warn('[Character] _attachHead : os manquant pour', node.name);
                continue;
            }

            const newSkeleton = new THREE.Skeleton(newBones, node.skeleton.boneInverses);
            node.position.set(0, 0, 0);
            node.rotation.set(0, 0, 0);

            const isBody = _isBodyMesh(node);

            node.scale.setScalar(1.0);
            node.bind(newSkeleton, new THREE.Matrix4());

            // Corps de base : clipping plane ancré sur l'os head → suit l'animation exactement
            if (isBody) {
                if (!this._bodyClipPlane) {
                    this._bodyClipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                    this._headBone = outfitBones['head'] || outfitBones['Head'] || null;
                    if (this._headBone) console.log('[Character] Head bone trouvé :', this._headBone.name);
                    else console.warn('[Character] Head bone introuvable — clip plane fixe');
                }
                // Cloner les matériaux pour éviter que le clip plane affecte d'autres instances
                const cloned = (Array.isArray(node.material) ? node.material : [node.material])
                    .map(m => m ? m.clone() : m);
                node.material = Array.isArray(node.material) ? cloned : cloned[0];
                for (const m of cloned) if (m) {
                    m.side = THREE.DoubleSide;
                    m.clippingPlanes = [this._bodyClipPlane];
                }
                // Shader : ne garder visible que les vertices cou + tête
                _injectBodyShader(node);
            } else {
                const mats = Array.isArray(node.material) ? node.material : [node.material];
                for (const m of mats) if (m) m.side = THREE.DoubleSide;
                // Couleur iris : détecté par nom "eyes" (insensible à la casse)
                // Les nouveaux packs Quaternius utilisent toujours ce nom pour les yeux
                if (node.name.toLowerCase() === 'eyes') _injectEyeShader(node, this._eyeColor);
            }

            node.renderOrder   = 0;
            node.castShadow    = true;
            node.frustumCulled = false;

            this._root.add(node);
            console.log('[Character] Tête attachée :', node.name);
        }
    }

    // ── Attachement cheveux / barbe ────────────────────────────
    /**
     * Prend tous les SkinnedMesh d'un GLTF cheveux/barbe et les rebinde
     * sur le squelette de l'outfit (même rig Quaternius → os de même nom).
     */
    _attachHairSlot(hairScene) {
        if (!this._root) return;
        const outfitBones = {};
        this._root.traverse(n => { if (n.isBone) outfitBones[n.name] = n; });

        const toAttach = [];
        hairScene.traverse(node => { if (node.isSkinnedMesh) toAttach.push(node); });

        for (const node of toAttach) {
            const newBones = node.skeleton.bones.map(b => outfitBones[b.name]);
            if (newBones.some(b => !b)) {
                console.warn('[Character] _attachHairSlot : os manquant pour', node.name);
                continue;
            }
            // Cloner les matériaux pour isoler la couleur de cette instance
            const clonedMats = (Array.isArray(node.material) ? node.material : [node.material])
                .map(m => m ? m.clone() : m);
            node.material = Array.isArray(node.material) ? clonedMats : clonedMats[0];
            for (const m of clonedMats) if (m) m.side = THREE.DoubleSide;

            node.bind(new THREE.Skeleton(newBones, node.skeleton.boneInverses), new THREE.Matrix4());
            node.castShadow    = true;
            node.frustumCulled = false;
            this._root.add(node);
            console.log('[Character] Cheveux/barbe attaché :', node.name);
        }
    }

    /** Applique une couleur aux meshes cheveux, barbe et sourcils de ce personnage. */
    _applyHairColor(hexColor) {
        this._root.traverse(node => {
            if (!node.isSkinnedMesh) return;
            const name = node.name.toLowerCase();
            if (!name.startsWith('hair_') && name !== 'eyebrows') return;
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            for (const m of mats) if (m) m.color.set(hexColor);
        });
    }

    // ── State machine ──────────────────────────────────────────

    /** Détermine l'état cible à partir du playerState. */
    _resolveState(ps) {
        if (!ps.isGrounded) return ps.vy > 0.5 ? 'jump' : 'fall';
        if (ps.isCrouching) return ps.isMoving ? 'crouch_walk' : 'crouch_idle';
        if (ps.isMoving)    return ps.isSprinting ? 'run' : 'walk';
        return 'idle';
    }

    /** Retourne l'action pour un état, avec fallback automatique. */
    _getAction(state) {
        if (this._actions[state]) return this._actions[state];
        for (const fb of (FALLBACKS[state] ?? [])) {
            if (this._actions[fb]) return this._actions[fb];
        }
        return Object.values(this._actions)[0] ?? null;
    }

    /** Transition vers un état avec crossfade. */
    _playState(name, crossfade = 0.15) {
        const action = this._getAction(name);
        if (!action || action === this._active) return;

        if (this._active) this._active.fadeOut(crossfade);
        action.reset().fadeIn(crossfade).play();
        this._active = action;
        this._state  = name;
    }

    /**
     * Jouer une action one-shot depuis l'extérieur (attaque, mort...).
     * Reprend l'état idle automatiquement à la fin.
     */
    playOnce(name, returnTo = 'idle') {
        if (!this.isLoaded) return;
        const action = this._actions[name];
        if (!action) return;

        if (this._active) this._active.fadeOut(0.1);
        action.reset().fadeIn(0.1).play();
        this._active = action;
        this._state  = name;

        const onFinish = (e) => {
            if (e.action === action) {
                this._mixer.removeEventListener('finished', onFinish);
                this._playState(returnTo);
            }
        };
        this._mixer.addEventListener('finished', onFinish);
    }

    // ── Update (appelé chaque frame depuis player.js) ──────────
    update(delta, ps) {
        if (!this.isLoaded || !this._root) return;

        // Résolution état → transition si changé
        const target = this._resolveState(ps);
        if (target !== this._state) this._playState(target);

        // Synchronisation position
        this._root.position.set(
            ps.position.x,
            ps.position.y + this._yOffset,
            ps.position.z
        );

        // Clip plane tête : ancré sur l'os head → suit l'animation (pas de pop au chin)
        if (this._bodyClipPlane) {
            if (this._headBone) {
                this._headBone.getWorldPosition(this._headBoneWP);
                // Si neck_01 est caché (< 0.01), remonter le clip à 0.10 pour masquer
                // la déformation des vertices à poids mixtes neck/head
                const neckHidden = (this._boneOverrides['neck_01'] ?? 1) < 0.01;
                this._bodyClipPlane.constant = -(this._headBoneWP.y - (neckHidden ? 0.10 : 0.22));
            } else {
                this._bodyClipPlane.constant = -(ps.position.y + this._targetHeight * 0.79);
            }
        }

        // ── Orientation : yaw + inclinaison terrain ────────────
        const yaw = ps.rotationY + this._rotOffset;

        if (ps.terrainNormal && ps.isGrounded) {
            const slope = Math.acos(Math.min(1, ps.terrainNormal.y));
            if (slope < 0.87) {
                // Tilt : aligner l'axe Y du modèle sur la normale terrain
                _charTiltQuat.setFromUnitVectors(_charUp, ps.terrainNormal);
                _charYawQuat.setFromAxisAngle(_charUp, yaw);
                _charTargetQuat.multiplyQuaternions(_charTiltQuat, _charYawQuat);
                this._root.quaternion.slerp(_charTargetQuat, Math.min(1, 8 * delta));
            } else {
                // Pente trop forte → rester vertical
                _charYawQuat.setFromAxisAngle(_charUp, yaw);
                this._root.quaternion.slerp(_charYawQuat, Math.min(1, 8 * delta));
            }
        } else {
            // En l'air ou pas de normale → yaw seul
            this._root.rotation.y = yaw;
        }

        // Mise à jour mixer
        this._mixer.update(delta);

        // Réappliquer les proportions APRÈS le mixer (il écrase les scales)
        if (Object.keys(this._boneOverrides).length) {
            applyIsolatedScales(this._root, this._boneOverrides, this._boneRestPos);
        }
    }

    // ── Visibilité (FPS = caché) ───────────────────────────────
    setVisible(v) {
        if (this._root) this._root.visible = v;
    }

    get visible() {
        return this._root ? this._root.visible : false;
    }
}
