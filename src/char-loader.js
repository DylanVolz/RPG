/**
 * src/char-loader.js — Mécanique partagée de chargement de personnage Quaternius
 *
 * Utilisé par : char-builder · grip-editor · character-preview · anim-inspect · asset-browser
 *
 * Exports :
 *   UAL_PATHS           — chemins des libs d'animation (UAL1 + UAL2, Standard + Source)
 *   isHeadRelatedMesh   — détecte les meshes tête/yeux par os du squelette
 *   attachSkinned       — attache des SkinnedMesh d'un GLTF sur un squelette cible
 */

import * as THREE from 'three';

// ── Chemins des librairies d'animation ───────────────────────────────────────
// Promise.allSettled est recommandé pour les charger : les variantes Source
// peuvent ne pas exister (tier Patreon). Les clips sont fusionnés par nom.
export const UAL_PATHS = [
    'assets/characters/animations/UAL1_Standard.glb',
    'assets/characters/animations/UAL1_Source.glb',
    'assets/characters/animations/UAL2_Standard.glb',
    'assets/characters/animations/UAL2_Source.glb',
];

// ── Détection de mesh par os du squelette ────────────────────────────────────
// Approche indépendante du nom du mesh — fonctionne avec tout pack Quaternius.

// Mesh "lié à la tête" : a neck_01 ou Head dans son squelette.
// Inclut le mesh corps complet (qui a aussi spine) ET les yeux/sourcils.
// → Utilisé par char-builder (dual-skeleton, pas de z-fighting).
export function isHeadRelatedMesh(node) {
    return node.isSkinnedMesh &&
        node.skeleton?.bones.some(b => b.name === 'neck_01' || b.name === 'Head');
}

// Mesh "tête uniquement" : a neck_01/Head SANS spine.
// Correspond aux meshes yeux, sourcils et tête seule (pas le body complet).
// → Utilisé par les outils preview (grip-editor, character-preview) qui
//   attachent body sur le skeleton outfit : exclut le mesh corps plein
//   pour éviter le z-fighting outfit/skin.
export function isHeadOnlyMesh(node) {
    if (!node.isSkinnedMesh || !node.skeleton) return false;
    const bones = new Set(node.skeleton.bones.map(b => b.name));
    return (bones.has('neck_01') || bones.has('Head')) &&
           !bones.has('spine_01') && !bones.has('spine_02') && !bones.has('spine_03');
}

// ── Attacher des SkinnedMesh d'un GLTF sur un squelette cible ───────────────
//
// Deux modes selon le contexte :
//
// Strict (useFallback = false, défaut) — pour char-builder où les deux
//   squelettes sont séparés et toujours complets.
//   • Os absent → mesh ignoré + warning console.
//
// Fallback (useFallback = true) — pour les outils de preview (grip-editor,
//   character-preview) où le body GLTF est attaché sur le skeleton de l'outfit.
//   Les bones twist spécifiques au body (lowerarm_twist_01_l…) n'existent pas
//   dans l'outfit → sans fallback le mesh corps entier serait ignoré.
//   • Os absent → Hips utilisé à la place (légère approximation, invisible
//     en pratique pour les preview).
//
// Règles communes :
//   • Crée de nouveaux SkinnedMesh (ne mute JAMAIS le nœud source GLTF)
//   • Clone les matériaux (évite la contamination entre chargements successifs)
//   • meshFilter(node) → boolean  (null = tout attacher)
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
