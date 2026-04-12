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

// ── Détection de mesh lié à la tête ─────────────────────────────────────────
// Approche par os (indépendante du nom du mesh) — fonctionne avec tout pack Quaternius.
// Un mesh "tête" possède neck_01 ou Head dans son squelette.
export function isHeadRelatedMesh(node) {
    return node.isSkinnedMesh &&
        node.skeleton?.bones.some(b => b.name === 'neck_01' || b.name === 'Head');
}

// ── Attacher des SkinnedMesh d'un GLTF sur un squelette cible ───────────────
// Règles :
//   • Crée de nouveaux SkinnedMesh (ne mute JAMAIS le nœud source GLTF)
//   • Clone les matériaux (évite la contamination entre chargements successifs)
//   • Pas de bone fallback : si un os est absent du squelette cible, le mesh
//     est ignoré et un warning est émis en console.
//   • meshFilter(node) → boolean  (null = tout attacher)
export function attachSkinned(srcGltf, outfitRoot, meshFilter) {
    const boneMap = {};
    outfitRoot.traverse(n => { if (n.isBone) boneMap[n.name] = n; });
    if (!Object.keys(boneMap).length) return;

    srcGltf.scene.traverse(srcNode => {
        if (!srcNode.isSkinnedMesh) return;
        if (meshFilter && !meshFilter(srcNode)) return;

        const newBones = srcNode.skeleton.bones.map(b => boneMap[b.name] || null);
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
