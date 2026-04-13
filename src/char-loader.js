/**
 * src/char-loader.js — Mécanique partagée de chargement de personnage Quaternius
 *
 * Utilisé par : char-builder · grip-editor · character-preview · anim-inspect · asset-browser · world-builder
 *
 * Exports simples :
 *   UAL_PATHS           — chemins des 4 fichiers d'animation
 *   findIdleClip(clips) — trouve le clip idle (priorité stricte ^idle_loop$)
 *   isHeadRelatedMesh   — détection tête/yeux par os (char-builder)
 *   isFullBodyMesh      — détection mesh corps complet (spine + head)
 *   attachSkinned       — attache des SkinnedMesh sur un squelette cible
 *
 * Export principal :
 *   CharacterRenderer   — rendu dual-skeleton complet avec shader zones corps
 *                         (même qualité que char-builder — utiliser partout)
 */

import * as THREE from 'three';

// ════════════════════════════════════════════════════════════════
//  CONSTANTES
// ════════════════════════════════════════════════════════════════

export const UAL_PATHS = [
    'assets/characters/animations/UAL1_Standard.glb',
    'assets/characters/animations/UAL1_Source.glb',
    'assets/characters/animations/UAL2_Standard.glb',
    'assets/characters/animations/UAL2_Source.glb',
];

/**
 * Trouve le clip idle avec priorité stricte — source unique de vérité pour
 * l'animation par défaut dans tous les outils.
 *
 * Priorité :  ^idle_loop$  >  ^idle$  >  ^idle…  >  …idle…  >  premier clip
 *
 * Le test `^idle_loop$` (ancré) évite que "Climb_Idle_Loop" soit choisi.
 */
export function findIdleClip(clips) {
    return clips.find(c => /^idle_loop$/i.test(c.name))
        || clips.find(c => /^idle$/i.test(c.name))
        || clips.find(c => /^idle/i.test(c.name))
        || clips.find(c => /idle/i.test(c.name))
        || clips[0]
        || null;
}

// ════════════════════════════════════════════════════════════════
//  DÉTECTION DE MESH PAR OS
// ════════════════════════════════════════════════════════════════

// Mesh "lié à la tête" : a neck_01 ou Head dans son squelette.
// Inclut le corps complet ET les yeux/sourcils.
// → char-builder (dual-skeleton, jamais de z-fighting)
export function isHeadRelatedMesh(node) {
    return node.isSkinnedMesh &&
        node.skeleton?.bones.some(b => b.name === 'neck_01' || b.name === 'Head');
}

// Mesh "corps complet" : a spine + Head/neck_01.
// Distinct des accessoires (yeux, sourcils) qui n'ont pas de bones spinaux.
export function isFullBodyMesh(node) {
    if (!node.isSkinnedMesh || !node.skeleton) return false;
    const bones = new Set(node.skeleton.bones.map(b => b.name));
    return (bones.has('neck_01') || bones.has('Head')) &&
           (bones.has('spine_01') || bones.has('spine_02') || bones.has('spine_03'));
}

// ════════════════════════════════════════════════════════════════
//  ATTACH SKINNED — usage simple (sans dual-skeleton)
// ════════════════════════════════════════════════════════════════

// Attache des SkinnedMesh d'un GLTF sur un squelette cible.
// Pour un rendu complet avec zones, préférer CharacterRenderer.
export function attachSkinned(srcGltf, outfitRoot, meshFilter, useFallback = false) {
    const boneMap = {};
    outfitRoot.traverse(n => { if (n.isBone) boneMap[n.name] = n; });
    if (!Object.keys(boneMap).length) return;

    const fallback = useFallback
        ? (boneMap['Hips'] || boneMap['Root'] || Object.values(boneMap)[0])
        : null;

    srcGltf.scene.traverse(srcNode => {
        if (!srcNode.isSkinnedMesh) return;
        if (meshFilter && !meshFilter(srcNode)) return;

        const newBones = srcNode.skeleton.bones.map(b => boneMap[b.name] || fallback || null);
        if (newBones.some(b => !b)) {
            const missing = srcNode.skeleton.bones
                .filter(b => !boneMap[b.name]).map(b => b.name);
            console.warn('[CharLoader] os manquants pour', srcNode.name, missing.slice(0, 5));
            return;
        }

        const clonedMats = (Array.isArray(srcNode.material)
            ? srcNode.material : [srcNode.material])
            .map(m => {
                const c = m ? m.clone() : m;
                if (c) c.side = THREE.DoubleSide;
                return c;
            });

        const mesh = new THREE.SkinnedMesh(
            srcNode.geometry,
            Array.isArray(srcNode.material) ? clonedMats : clonedMats[0]
        );
        mesh.name      = srcNode.name;
        mesh.bindMode  = srcNode.bindMode;
        mesh.bind(
            new THREE.Skeleton(newBones, srcNode.skeleton.boneInverses),
            new THREE.Matrix4()
        );
        mesh.castShadow    = true;
        mesh.frustumCulled = false;
        outfitRoot.add(mesh);
    });
}

// ════════════════════════════════════════════════════════════════
//  INTERNALS — makeReboundMesh
// ════════════════════════════════════════════════════════════════

function _makeReboundMesh(srcNode, boneMap) {
    const newBones = srcNode.skeleton.bones.map(b => boneMap[b.name] || null);
    if (newBones.some(b => !b)) return null;

    const clonedMats = (Array.isArray(srcNode.material)
        ? srcNode.material : [srcNode.material]).map(m => m ? m.clone() : m);

    const mesh = new THREE.SkinnedMesh(
        srcNode.geometry,
        Array.isArray(srcNode.material) ? clonedMats : clonedMats[0]
    );
    mesh.name     = srcNode.name;
    mesh.bindMode = srcNode.bindMode;
    mesh.bind(
        new THREE.Skeleton(newBones, srcNode.skeleton.boneInverses),
        new THREE.Matrix4()
    );
    clonedMats.forEach(m => { if (m) m.side = THREE.DoubleSide; });
    mesh.castShadow    = true;
    mesh.frustumCulled = false;
    return mesh;
}

function _attachMeshes(srcGltf, boneMap, filterFn, root) {
    const attached = [];
    srcGltf.scene.traverse(srcNode => {
        if (!srcNode.isSkinnedMesh || !filterFn(srcNode)) return;
        const mesh = _makeReboundMesh(srcNode, boneMap);
        if (!mesh) {
            console.warn('[CharLoader] os manquants (skipped):', srcNode.name);
            return;
        }
        root.add(mesh);
        attached.push(mesh);
    });
    return attached;
}

// ════════════════════════════════════════════════════════════════
//  SHADER CORPS — zones de visibilité (identique char-builder)
//
//  Tête + Cou : TOUJOURS visibles (vNeckHeadW > 0.35).
//  Toutes les autres zones : cachées par défaut (valeur 0.0).
//  → La face reste visible quel que soit l'outfit.
//  → Les zones couvertes par l'outfit restent proprement cachées.
// ════════════════════════════════════════════════════════════════

function _injectBodyZoneShader(mesh) {
    const sk = mesh.skeleton.bones;
    const bi = n => sk.findIndex(b => b.name === n);
    if (bi('neck_01') < 0 && bi('Head') < 0) return;

    function treeIdx(boneName) {
        const out = [];
        function walk(name) {
            const i = bi(name); if (i < 0) return;
            out.push(i);
            sk[i].children.forEach(c => { if (c.isBone) walk(c.name); });
        }
        walk(boneName);
        return out;
    }

    function zoneExpr(indices) {
        if (!indices.length) return '0.0';
        const ck = v => '(' + indices.map(i => `${v}==${i}.0`).join('||') + ')';
        return `(${ck('ix')}?wx:0.0)+(${ck('iy')}?wy:0.0)+(${ck('iz')}?wz:0.0)+(${ck('iw')}?ww:0.0)`;
    }

    const si = (...names) => names.map(n => bi(n)).filter(i => i >= 0);
    const zones = {
        neckHead : si('neck_01','Head'),
        shoulder : si('clavicle_l','clavicle_r'),
        chest    : si('spine_01','spine_02','spine_03','pelvis'),
        arm      : si('upperarm_l','upperarm_r'),
        forearm  : si('lowerarm_l','lowerarm_r'),
        hand     : [...new Set([...treeIdx('hand_l'), ...treeIdx('hand_r')])],
        thigh    : [...new Set([...si('thigh_l','thigh_r','pelvis')])],
        calf     : si('calf_l','calf_r'),
        foot     : [...new Set([...treeIdx('foot_l'), ...treeIdx('foot_r')])],
    };

    // Toutes les zones cachées par défaut — Tête/Cou toujours visibles (shader)
    // uSkinColor/uSkinBlend : teinte peau optionnelle (identique char-builder)
    const bodyZoneUnis = {
        uShowShldr:  { value: 0.0 }, uShowChest:  { value: 0.0 },
        uShowArms:   { value: 0.0 }, uShowFArms:  { value: 0.0 },
        uShowHands:  { value: 0.0 }, uShowThighs: { value: 0.0 },
        uShowCalves: { value: 0.0 }, uShowFeet:   { value: 0.0 },
        uSkinColor:  { value: new THREE.Color(1, 1, 1) },
        uSkinBlend:  { value: 0.0 },
    };

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => {
        if (!m) return;
        m.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, bodyZoneUnis);

            shader.vertexShader = shader.vertexShader.replace(
                '#include <skinning_pars_vertex>',
`#include <skinning_pars_vertex>
varying float vNeckHeadW,vShldrW,vChestW,vArmW,vFArmW,vHndW,vThghW,vClfW,vFtW;`
            );

            shader.vertexShader = shader.vertexShader.replace(
                '#include <skinning_vertex>',
`#include <skinning_vertex>
{
float ix=float(skinIndex.x),iy=float(skinIndex.y),iz=float(skinIndex.z),iw=float(skinIndex.w);
float wx=skinWeight.x,wy=skinWeight.y,wz=skinWeight.z,ww=skinWeight.w;
vNeckHeadW=${zoneExpr(zones.neckHead)};
vShldrW   =${zoneExpr(zones.shoulder)};
vChestW   =${zoneExpr(zones.chest)};
vArmW     =${zoneExpr(zones.arm)};
vFArmW    =${zoneExpr(zones.forearm)};
vHndW     =${zoneExpr(zones.hand)};
vThghW    =${zoneExpr(zones.thigh)};
vClfW     =${zoneExpr(zones.calf)};
vFtW      =${zoneExpr(zones.foot)};
}`
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                'void main() {',
`varying float vNeckHeadW,vShldrW,vChestW,vArmW,vFArmW,vHndW,vThghW,vClfW,vFtW;
uniform float uShowShldr,uShowChest,uShowArms,uShowFArms,uShowHands,uShowThighs,uShowCalves,uShowFeet;
uniform vec3  uSkinColor;
uniform float uSkinBlend;
void main() {
float keep=0.;
if(vNeckHeadW>0.35) keep=1.;
if(uShowShldr >0.5&&vShldrW >0.25) keep=1.;
if(uShowChest >0.5&&vChestW >0.25) keep=1.;
if(uShowArms  >0.5&&vArmW   >0.25) keep=1.;
if(uShowFArms >0.5&&vFArmW  >0.25) keep=1.;
if(uShowHands >0.5&&vHndW   >0.25) keep=1.;
if(uShowThighs>0.5&&vThghW  >0.25) keep=1.;
if(uShowCalves>0.5&&vClfW   >0.25) keep=1.;
if(uShowFeet  >0.5&&vFtW    >0.25) keep=1.;
if(keep<0.5) discard;`
            );

            // Teinte peau après échantillonnage texture (identique char-builder)
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
`#include <map_fragment>
if(uSkinBlend>0.0){
 float lum=dot(diffuseColor.rgb,vec3(0.299,0.587,0.114));
 float sLum=max(dot(uSkinColor,vec3(0.299,0.587,0.114)),0.001);
 vec3 tinted=uSkinColor*(lum/sLum);
 tinted/=max(max(tinted.r,max(tinted.g,tinted.b)),1.0);
 diffuseColor.rgb=mix(diffuseColor.rgb,tinted,uSkinBlend);
}`
            );
        };
        m.userData.bodyZoneUniforms = bodyZoneUnis;
        m.needsUpdate = true;
    });
}

function _injectEyeShader(mesh) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => {
        if (!m) return;
        const eyeUniforms = {
            uIrisColor:   { value: new THREE.Color(0x4466aa) },
            uIrisEnabled: { value: 0.0 },
        };
        m.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, eyeUniforms);
            shader.fragmentShader = shader.fragmentShader.replace(
                'void main() {',
`uniform vec3  uIrisColor;
uniform float uIrisEnabled;
void main() {`
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
`#include <map_fragment>
if (uIrisEnabled > 0.5) {
    float lum  = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    float sLum = max(dot(uIrisColor,   vec3(0.299, 0.587, 0.114)), 0.001);
    vec3 tinted = uIrisColor * (lum / sLum);
    tinted /= max(max(tinted.r, max(tinted.g, tinted.b)), 1.0);
    float mask = 1.0 - smoothstep(0.08, 0.45, lum);
    diffuseColor.rgb = mix(diffuseColor.rgb, tinted, mask * 0.88);
}`
            );
        };
        m.userData.eyeUniforms = eyeUniforms;
        m.needsUpdate = true;
    });
}

// ════════════════════════════════════════════════════════════════
//  CharacterRenderer — rendu dual-skeleton complet
//
//  Même qualité que char-builder :
//    • outfitRoot — outfit + animations
//    • bodyRoot   — body/hair/beard avec shader zones corps
//    • Deux mixers synchronisés sur le même clip
//    • Face toujours visible, zones couvertes cachées (shader)
//
//  Usage :
//    const cr = new CharacterRenderer(scene, SkeletonUtils);
//    await cr.load(cfg, loadGLTF);
//    cr.play(clip);
//    // Dans la boucle d'animation :
//    cr.update(delta);
//    // Accès au squelette outfit pour attacher des armes :
//    const bone = cr.outfitRoot?.getObjectByName('hand_r');
// ════════════════════════════════════════════════════════════════

export class CharacterRenderer {
    constructor(scene, SkeletonUtils) {
        this._scene        = scene;
        this._SK           = SkeletonUtils;
        this._outfitRoot   = null;
        this._bodyRoot     = null;
        this.mixerOutfit   = null;
        this.mixerBody     = null;
        this._actionOutfit = null;
        this._actionBody   = null;
    }

    get outfitRoot() { return this._outfitRoot; }
    get bodyRoot()   { return this._bodyRoot; }

    // ── Charger un personnage (outfit + body + hair + beard) ─────
    async load(cfg, loadGLTF) {
        this.dispose();

        const urls = [cfg.meshUrl, cfg.baseUrl];
        if (cfg.hairUrl)  urls.push(cfg.hairUrl);
        if (cfg.beardUrl) urls.push(cfg.beardUrl);

        const gltfs = await Promise.all(urls.map(u => loadGLTF(u)));
        const [outfitGltf, bodyGltf] = gltfs;
        const hairGltf  = cfg.hairUrl  ? gltfs[2] : null;
        const beardGltf = cfg.beardUrl ? gltfs[cfg.hairUrl ? 3 : 2] : null;

        // ── outfitRoot : rend l'outfit ─────────────────────────────
        const outfitRoot = this._SK.clone(outfitGltf.scene);
        outfitRoot.traverse(c => {
            if (!c.isMesh) return;
            c.castShadow = true; c.receiveShadow = true; c.frustumCulled = false;
            (Array.isArray(c.material) ? c.material : [c.material])
                .forEach(m => { if (m) m.side = THREE.DoubleSide; });
        });
        // Mise à l'échelle 1.75 m
        const b0 = new THREE.Box3().setFromObject(outfitRoot);
        const h  = b0.max.y - b0.min.y;
        outfitRoot.scale.setScalar(h > 0 ? 1.75 / h : 1);
        const b1 = new THREE.Box3().setFromObject(outfitRoot);
        outfitRoot.position.y = -b1.min.y;

        this._scene.add(outfitRoot);
        this._outfitRoot = outfitRoot;
        this.mixerOutfit = new THREE.AnimationMixer(outfitRoot);

        // ── bodyRoot : squelette séparé pour body / hair / beard ──
        // Clone du même GLTF → rig identique → aucun os manquant
        const bodyRoot = this._SK.clone(outfitGltf.scene);
        bodyRoot.scale.copy(outfitRoot.scale);
        bodyRoot.position.copy(outfitRoot.position);
        bodyRoot.traverse(c => { if (c.isMesh) c.visible = false; });
        this._scene.add(bodyRoot);
        this._bodyRoot = bodyRoot;
        this.mixerBody = new THREE.AnimationMixer(bodyRoot);

        // Bone map du bodyRoot (rig identique → 100 % des os présents)
        const boneMapBody = {};
        bodyRoot.traverse(n => { if (n.isBone) boneMapBody[n.name] = n; });

        // Attacher body / hair / beard sur bodyRoot
        // On capture les listes pour appliquer les couleurs sans re-traverser :
        // isFullBodyMesh() retourne true pour les cheveux aussi (même squelette complet),
        // donc la distinction se fait uniquement par la source GLTF d'origine.
        const bodyMeshes  = _attachMeshes(bodyGltf,  boneMapBody, isHeadRelatedMesh, bodyRoot);
        const hairMeshes  = hairGltf  ? _attachMeshes(hairGltf,  boneMapBody, () => true, bodyRoot) : [];
        const beardMeshes = beardGltf ? _attachMeshes(beardGltf, boneMapBody, () => true, bodyRoot) : [];

        // Injecter shaders après attachment
        bodyMeshes.forEach(m => {
            const nameLc = m.name.toLowerCase();
            if (nameLc === 'eyes' || nameLc.includes('mi_eye')) {
                _injectEyeShader(m);
            } else if (isFullBodyMesh(m)) {
                _injectBodyZoneShader(m);
            }
        });

        // ── Appliquer les couleurs depuis la config ────────────────
        // Helper inline
        const _setColor = (meshes, color) => meshes.forEach(m =>
            (Array.isArray(m.material) ? m.material : [m.material])
                .forEach(mat => { if (mat) mat.color.set(color); }));

        // eyeColor — active le shader iris (source : bodyMeshes, filtrés par nom)
        if (cfg.eyeColor) {
            const ec = new THREE.Color(cfg.eyeColor);
            bodyMeshes.forEach(m => {
                const nl = m.name.toLowerCase();
                if (nl !== 'eyes' && !nl.includes('mi_eye')) return;
                (Array.isArray(m.material) ? m.material : [m.material]).forEach(mat => {
                    const u = mat?.userData?.eyeUniforms;
                    if (u) { u.uIrisColor.value.set(ec); u.uIrisEnabled.value = 1.0; }
                });
            });
        }

        // hairColor — cheveux/barbe (listes trackées) + sourcils (bodyMeshes)
        if (cfg.hairColor) {
            const hc = new THREE.Color(cfg.hairColor);
            _setColor(hairMeshes,  hc);
            _setColor(beardMeshes, hc);
            _setColor(bodyMeshes.filter(m => m.name.toLowerCase() === 'eyebrows'), hc);
        }

        // skinColor — teinte peau via bodyZoneUniforms (injecté plus haut)
        if (cfg.skinColor) {
            const sc = new THREE.Color(cfg.skinColor);
            bodyMeshes.forEach(m => {
                if (!isFullBodyMesh(m)) return;
                (Array.isArray(m.material) ? m.material : [m.material]).forEach(mat => {
                    const u = mat?.userData?.bodyZoneUniforms;
                    if (u) { u.uSkinColor.value.set(sc); u.uSkinBlend.value = 1.0; }
                });
            });
        }
    }

    // ── Jouer un clip sur les deux mixers ─────────────────────────
    play(clip) {
        if (this._actionOutfit) { try { this._actionOutfit.stop(); } catch {} }
        if (this._actionBody)   { try { this._actionBody.stop();   } catch {} }
        if (!clip || !this.mixerOutfit || !this.mixerBody) return;

        // Cloner le clip pour que chaque mixer ait sa propre instance
        const clone = c => THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(c));
        this._actionOutfit = this.mixerOutfit.clipAction(clone(clip));
        this._actionBody   = this.mixerBody.clipAction(clone(clip));
        this._actionOutfit.reset().play();
        this._actionBody.reset().play();
    }

    // ── Avancer les deux mixers (appeler dans requestAnimationFrame) ─
    update(delta) {
        this.mixerOutfit?.update(delta);
        this.mixerBody?.update(delta);
    }

    // ── Nettoyage complet ──────────────────────────────────────────
    dispose() {
        if (this._actionOutfit) { try { this._actionOutfit.stop(); } catch {} }
        if (this._actionBody)   { try { this._actionBody.stop();   } catch {} }
        if (this.mixerOutfit)   { try { this.mixerOutfit.stopAllActions(); } catch {} this.mixerOutfit = null; }
        if (this.mixerBody)     { try { this.mixerBody.stopAllActions();   } catch {} this.mixerBody   = null; }
        if (this._outfitRoot)   { this._scene.remove(this._outfitRoot); this._outfitRoot = null; }
        if (this._bodyRoot)     { this._scene.remove(this._bodyRoot);   this._bodyRoot   = null; }
        this._actionOutfit = null;
        this._actionBody   = null;
    }
}
