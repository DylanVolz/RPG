// ═══════════════════════════════════════════════════════════════
//  COLLISION.JS — Surfaces solides statiques
//
//  Trois primitives :
//    Floor  : surface marchable (topY)
//    Ceiling: plafond (bottomY) — bloque la tête / empêche de sauter
//    Wall   : obstacle vertical AABB — repousse le joueur
//    Ramp   : sol incliné (interpolation linéaire sur un axe)
// ═══════════════════════════════════════════════════════════════

const _floors   = [];
const _ceilings = [];
const _walls    = [];
const _ramps    = [];
const _dynWalls = new Map(); // id → { cx, cz, hw, hd, bottomY, topY }

// ── Enregistrement ─────────────────────────────────────────────

export function addFloor(cx, cz, w, d, topY) {
    _floors.push({ cx, cz, hw: w * 0.5, hd: d * 0.5, topY });
}

export function addCeiling(cx, cz, w, d, bottomY) {
    _ceilings.push({ cx, cz, hw: w * 0.5, hd: d * 0.5, bottomY });
}

/**
 * Mur solide — AABB vertical.
 * bottomY / topY = étendue verticale de l'obstacle.
 */
export function addWall(cx, cz, w, d, bottomY, topY) {
    _walls.push({ cx, cz, hw: w * 0.5, hd: d * 0.5, bottomY, topY });
}

/**
 * Rampe inclinée.
 * axis 'z' : y0 au zMin, y1 au zMax.
 * axis 'x' : y0 au xMin, y1 au xMax.
 */
export function addRamp(cx, cz, w, d, y0, y1, axis = 'z') {
    _ramps.push({ cx, cz, hw: w * 0.5, hd: d * 0.5, y0, y1, axis });
}

export function clearAll() {
    _floors.length = _ceilings.length = _walls.length = _ramps.length = 0;
}

/** Mur dynamique ajouté/retiré en runtime (ex: porte fermée). */
export function addDynamicWall(id, cx, cz, w, d, bottomY, topY) {
    _dynWalls.set(id, { cx, cz, hw: w * 0.5, hd: d * 0.5, bottomY, topY });
}

export function removeDynamicWall(id) {
    _dynWalls.delete(id);
}

// ── Requêtes ───────────────────────────────────────────────────

/**
 * Hauteur du sol structurel le plus haut en (x, z).
 *
 * @param {number} playerY — position Y courante du joueur (pieds).
 *   Seuls les floors ≤ playerY + 3.0 sont pris en compte.
 *   Évite que les toits surélevés (inaccessibles) influencent le sol perçu.
 *   Valeur par défaut Infinity = comportement sans filtrage (rétrocompatible).
 */
export function getStructureHeight(x, z, playerY = Infinity) {
    let best = -Infinity;
    const ceiling = playerY + 3.0;   // marge : saut max ~2.5m

    for (let i = 0; i < _floors.length; i++) {
        const b = _floors[i];
        if (b.topY > ceiling) continue;           // floor trop haut → ignorer
        if (x >= b.cx - b.hw && x <= b.cx + b.hw &&
            z >= b.cz - b.hd && z <= b.cz + b.hd) {
            if (b.topY > best) best = b.topY;
        }
    }

    for (let i = 0; i < _ramps.length; i++) {
        const r = _ramps[i];
        if (x < r.cx - r.hw || x > r.cx + r.hw ||
            z < r.cz - r.hd || z > r.cz + r.hd) continue;  // hors zone XZ
        let t = r.axis === 'z'
            ? (z - (r.cz - r.hd)) / (r.hd * 2)
            : (x - (r.cx - r.hw)) / (r.hw * 2);
        t = Math.max(0, Math.min(1, t));
        const y = r.y0 + (r.y1 - r.y0) * t;
        if (y > ceiling) continue;  // hauteur interpolée trop haute → ignorer
        if (y > best) best = y;
    }

    return best;
}

/** Hauteur du plafond le plus bas (bas du plafond) en (x, z). */
export function getCeilingHeight(x, z) {
    let best = Infinity;
    for (let i = 0; i < _ceilings.length; i++) {
        const c = _ceilings[i];
        if (x >= c.cx - c.hw && x <= c.cx + c.hw &&
            z >= c.cz - c.hd && z <= c.cz + c.hd) {
            if (c.bottomY < best) best = c.bottomY;
        }
    }
    return best;
}

/**
 * Repousse pos hors des murs solides.
 * radius  = rayon du joueur (~0.35)
 * footY   = position.y du joueur (pieds)
 * headH   = hauteur du joueur (1.85 debout, 1.0 accroupi)
 */
export function resolveWallCollision(pos, radius, footY, headH) {
    const playerTop = footY + headH;

    for (let i = 0; i < _walls.length; i++) {
        const w = _walls[i];

        // Ignore si le joueur est au-dessus ou en dessous de ce mur
        if (footY >= w.topY || playerTop <= w.bottomY) continue;

        const minX = w.cx - w.hw - radius;
        const maxX = w.cx + w.hw + radius;
        const minZ = w.cz - w.hd - radius;
        const maxZ = w.cz + w.hd + radius;

        if (pos.x <= minX || pos.x >= maxX || pos.z <= minZ || pos.z >= maxZ) continue;

        // Chevauchement — trouver la sortie minimale
        const dRight = maxX - pos.x;
        const dLeft  = pos.x - minX;
        const dFwd   = maxZ - pos.z;
        const dBack  = pos.z - minZ;

        const min = Math.min(dRight, dLeft, dFwd, dBack);
        const EPS = 0.02;
        if      (min === dRight) pos.x = maxX + EPS;
        else if (min === dLeft)  pos.x = minX - EPS;
        else if (min === dFwd)   pos.z = maxZ + EPS;
        else                     pos.z = minZ - EPS;
    }

    // Murs dynamiques (portes fermées, etc.)
    for (const w of _dynWalls.values()) {
        if (footY >= w.topY || playerTop <= w.bottomY) continue;

        const minX = w.cx - w.hw - radius;
        const maxX = w.cx + w.hw + radius;
        const minZ = w.cz - w.hd - radius;
        const maxZ = w.cz + w.hd + radius;

        if (pos.x <= minX || pos.x >= maxX || pos.z <= minZ || pos.z >= maxZ) continue;

        const dRight = maxX - pos.x;
        const dLeft  = pos.x - minX;
        const dFwd   = maxZ - pos.z;
        const dBack  = pos.z - minZ;

        const min = Math.min(dRight, dLeft, dFwd, dBack);
        const EPS = 0.02;
        if      (min === dRight) pos.x = maxX + EPS;
        else if (min === dLeft)  pos.x = minX - EPS;
        else if (min === dFwd)   pos.z = maxZ + EPS;
        else                     pos.z = minZ - EPS;
    }
}
