// ═══════════════════════════════════════════════════════════════
//  CHAR-CONFIG.JS — Lecture des configs personnage depuis localStorage
//
//  Tous les personnages (joueur + PNJ) sont sauvegardés dans
//  localStorage['darkrpg_configs_v1'] par le char-builder.
//
//  Usage :
//    import { resolveCharConfig, getCharConfigByName } from './char-config.js';
//
//    // Joueur : lit darkrpg_character_v1
//    const cfg = resolveCharConfig();
//
//    // PNJ nommé : lit darkrpg_configs_v1 par nom
//    const cfg = resolveCharConfig('Elara');
// ═══════════════════════════════════════════════════════════════

const _P_OUTFIT = 'assets/characters/outfits/';
const _P_BODY   = {
    M: 'assets/characters/bodies/Superhero_Male_FullBody.gltf',
    F: 'assets/characters/bodies/Superhero_Female_FullBody.gltf',
};
const _P_HAIR = 'assets/characters/hair/';

/** Retourne toutes les configs sauvegardées dans le char-builder. */
export function getAllCharConfigs() {
    try { return JSON.parse(localStorage.getItem('darkrpg_configs_v1') || '[]'); }
    catch { return []; }
}

/** Retourne une config par nom exact, ou null si introuvable. */
export function getCharConfigByName(name) {
    return getAllCharConfigs().find(c => c.name === name) || null;
}

/**
 * Résout une config brute (depuis localStorage) en URLs utilisables par loadRetargeted.
 *
 * @param {string|null} name — nom du personnage (depuis darkrpg_configs_v1).
 *                             Si null/undefined, lit darkrpg_character_v1 (joueur).
 * @returns {object} { meshUrl, baseUrl, hairUrl, beardUrl, hairColor, eyeColor,
 *                     boneScaleBody, boneScaleOutfit, name }
 */
export function resolveCharConfig(name = null) {
    let c = null;

    if (name) {
        c = getCharConfigByName(name);
        if (!c) console.warn(`[CharConfig] Config "${name}" introuvable dans darkrpg_configs_v1`);
    } else {
        try { c = JSON.parse(localStorage.getItem('darkrpg_character_v1') || 'null'); }
        catch { c = null; }
    }

    const body       = c?.body       || 'M';
    const outfit     = (c?.outfit != null && c.outfit !== '') ? c.outfit : 'Male_Ranger';
    const texVariant = c?.texVariant || 1;

    // URL texture variante (null si variant 1 = défaut du gltf)
    const outfitType = outfit.replace(/^(Male|Female)_/, '').replace(/_Cloth$/, '');
    const texUrl = texVariant > 1
        ? _P_OUTFIT + 'T_' + outfitType + '_' + texVariant + '_BaseColor.png'
        : null;

    return {
        name           : c?.name || name || 'Joueur',
        meshUrl        : _P_OUTFIT + outfit + '.gltf',
        baseUrl        : _P_BODY[body] || _P_BODY['M'],
        hairUrl        : c?.hair  ? _P_HAIR + c.hair  + '.gltf' : null,
        beardUrl       : c?.beard ? _P_HAIR + c.beard + '.gltf' : null,
        texVariantUrl  : texUrl,
        hairColor      : c?.hairColor       || null,
        eyeColor       : c?.eyeColor        || null,
        skinColor      : c?.skinColor       || null, // null = texture naturelle
        boneScaleBody  : c?.boneScaleBody   || {},
        boneScaleOutfit: c?.boneScaleOutfit || {},
    };
}
