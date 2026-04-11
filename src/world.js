import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ═══════════════════════════════════════════════════════════════════
//  WORLD.JS — Carte complète, régions, zones sauvages, terrain chunks
//
//  Coordonnées : X ouest↔est, Z nord(−)↔sud(+), Y bas↔haut
//  Monde : −4000 à +4000 sur X et Z (8km × 8km ≈ taille Skyrim)
//  Chunk : 400×400 unités, 20 segments → 20×20 grille = 400 chunks total
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
//  NOISE (Perlin 2D + fBm) — aucune allocation dans les hot paths
// ─────────────────────────────────────────────────────────────────
const _p = new Uint8Array(512);
(function initNoise() {
    // PRNG déterministe (seed fixe) — le terrain doit être IDENTIQUE entre chaque
    // chargement de page pour que les clés de position (world deletions / transforms)
    // restent valides après un F5.  Ne jamais utiliser Math.random() ici.
    let s = 0x9b3f2c1a;
    function rnd() {
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        return (s >>> 0) / 4294967296;
    }
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = base[i]; base[i] = base[j]; base[j] = t;
    }
    for (let i = 0; i < 512; i++) _p[i] = base[i & 255];
})();

function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function _grad2(h, x, y) {
    const v = h & 3;
    const gx = v < 2 ? (v === 0 ? 1 : -1) : 0;
    const gy = v >= 2 ? (v === 2 ? 1 : -1) : 0;
    return gx * x + gy * y;
}
function _noise2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = _fade(xf), v = _fade(yf);
    const aa = _p[_p[X] + Y], ab = _p[_p[X] + Y + 1];
    const ba = _p[_p[X + 1] + Y], bb = _p[_p[X + 1] + Y + 1];
    const x1 = xf - 1, y1 = yf - 1;
    return (
        (1 - v) * ((1 - u) * _grad2(aa, xf, yf) + u * _grad2(ba, x1, yf)) +
              v  * ((1 - u) * _grad2(ab, xf, y1) + u * _grad2(bb, x1, y1))
    );
}
function _fbm(x, y, oct, lac, gain) {
    let val = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
        val += _noise2(x * freq, y * freq) * amp;
        norm += amp; amp *= gain; freq *= lac;
    }
    return val / norm;  // [-1, 1]
}

// ─────────────────────────────────────────────────────────────────
//  DÉFINITIONS DES RÉGIONS  (8 régions + 7 zones sauvages)
// ─────────────────────────────────────────────────────────────────
// Chaque zone définit :
//   id, name, xMin/xMax/zMin/zMax  ← bounds monde
//   base       ← hauteur de base (y)
//   amp        ← amplitude des reliefs
//   scale      ← fréquence spatiale du bruit (plus grand = plus lisse)
//   oct        ← octaves fBm (détail)
//   gain       ← persistence fBm
//   groundCol  ← couleur sol hex
//   rockCol    ← couleur roche/pente
//   snowLine   ← altitude neige (0 = pas de neige)
//   waterLine  ← altitude eau (0 = pas d'eau de surface)
//   wild       ← true si zone sauvage (pas de capitale)

export const ZONE_DEFS = [

    // ── RÉGIONS ────────────────────────────────────────────────────

    {   // Toundra nordique, fjords, neige
        id:'kaldrath', name:'Kaldrath', wild:false,
        xMin:-4000, xMax:-600,  zMin:-4000, zMax:-1600,
        base:18, amp:75, scale:800, oct:7, gain:0.52,
        groundCol:0x8899aa, rockCol:0x556677, snowLine:70,  waterLine:0,
    },
    {   // Forêt ancienne dense, brume, elfes
        id:'grimveld', name:'Grimveld', wild:false,
        xMin: 600,  xMax: 4000, zMin:-4000, zMax:-1600,
        base:8,  amp:35, scale:600, oct:6, gain:0.48,
        groundCol:0x2d4a2d, rockCol:0x3a5a3a, snowLine:0,   waterLine:0,
    },
    {   // Plaines agricoles, cœur humain
        id:'valdur', name:'Valdur', wild:false,
        xMin:-4000, xMax:-400,  zMin:-1400, zMax: 400,
        base:4,  amp:12, scale:1200, oct:4, gain:0.40,
        groundCol:0x6a7a40, rockCol:0x556030, snowLine:0,   waterLine:0,
    },
    {   // Carrefour commercial, côtes, toutes races
        id:'harncross', name:'Harncross', wild:false,
        xMin:-400,  xMax: 2000, zMin:-1400, zMax: 400,
        base:5,  amp:20, scale:900, oct:5, gain:0.45,
        groundCol:0x7a8a50, rockCol:0x8a7a60, snowLine:0,   waterLine:0,
    },
    {   // Landes crépusculaires, ruines anciennes
        id:'duskmere', name:'Duskmere', wild:false,
        xMin: 2000, xMax: 4000, zMin:-1400, zMax: 400,
        base:6,  amp:18, scale:700, oct:5, gain:0.50,
        groundCol:0x5a4a60, rockCol:0x443344, snowLine:0,   waterLine:0,
    },
    {   // Marécages orcs, brume acide
        id:'ashfen', name:'Ashfen', wild:false,
        xMin:-4000, xMax:-400,  zMin: 400,  zMax: 2600,
        base:-2, amp:8,  scale:800, oct:4, gain:0.38,
        groundCol:0x2a3a22, rockCol:0x1a2a18, snowLine:0,   waterLine:2,
    },
    {   // Montagnes naines, pics glacés
        id:'stonemark', name:'Stonemark', wild:false,
        xMin:-400,  xMax: 2400, zMin: 400,  zMax: 2600,
        base:30, amp:120,scale:600, oct:8, gain:0.55,
        groundCol:0x666070, rockCol:0x4a4455, snowLine:90,  waterLine:0,
    },
    {   // Wasteland calciné, désolation absolue
        id:'terres_brulees', name:'Terres Brûlées', wild:false,
        xMin:-2000, xMax: 2000, zMin: 2600, zMax: 4000,
        base:3,  amp:10, scale:500, oct:4, gain:0.42,
        groundCol:0x5a3322, rockCol:0x6a2211, snowLine:0,   waterLine:0,
    },

    // ── ZONES SAUVAGES ──────────────────────────────────────────────

    {   // Grande Forêt Sans Nom — entre Kaldrath et Grimveld
        id:'grande_foret', name:'Grande Forêt Sans Nom', wild:true,
        xMin:-600,  xMax: 600,  zMin:-4000, zMax:-1600,
        base:12, amp:45, scale:500, oct:7, gain:0.52,
        groundCol:0x1a3018, rockCol:0x223822, snowLine:0,   waterLine:0,
    },
    {   // Marais des Visages — entre Valdur et Ashfen
        id:'marais_visages', name:'Marais des Visages', wild:true,
        xMin:-1000, xMax:-200,  zMin: 200,  zMax: 700,
        base:-1, amp:5,  scale:400, oct:4, gain:0.40,
        groundCol:0x1e2e18, rockCol:0x172212, snowLine:0,   waterLine:1,
    },
    {   // Désert de Sel — entre Harncross et Terres Brûlées
        id:'desert_sel', name:'Désert de Sel', wild:true,
        xMin:-600,  xMax: 1800, zMin: 2200, zMax: 2800,
        base:2,  amp:4,  scale:1400,oct:3, gain:0.30,
        groundCol:0xd8d0b8, rockCol:0xb8b0a0, snowLine:0,   waterLine:0,
    },
    {   // Lande des Pendus — entre Grimveld et Duskmere
        id:'lande_pendus', name:'Lande des Pendus', wild:true,
        xMin: 1600, xMax: 2400, zMin:-600,  zMax: 200,
        base:7,  amp:14, scale:600, oct:5, gain:0.48,
        groundCol:0x4a3850, rockCol:0x382840, snowLine:0,   waterLine:0,
    },
    {   // Gorges de Pierre — entre Stonemark et Duskmere
        id:'gorges_pierre', name:'Gorges de Pierre', wild:true,
        xMin: 1800, xMax: 2800, zMin: 300,  zMax: 1000,
        base:20, amp:80, scale:400, oct:7, gain:0.58,
        groundCol:0x555060, rockCol:0x403a4a, snowLine:60,  waterLine:0,
    },
    {   // Côte Brisée — littoral nord
        id:'cote_brisee', name:'Côte Brisée', wild:true,
        xMin:-2500, xMax: 1200, zMin:-4200, zMax:-3600,
        base:5,  amp:30, scale:500, oct:6, gain:0.50,
        groundCol:0x667788, rockCol:0x445566, snowLine:0,   waterLine:3,
    },
    {   // L'Approche — transition vers les Terres Brûlées
        id:'approche', name:"L'Approche", wild:true,
        xMin:-2000, xMax: 2200, zMin: 2200, zMax: 2700,
        base:4,  amp:12, scale:700, oct:5, gain:0.44,
        groundCol:0x6a4a38, rockCol:0x5a3828, snowLine:0,   waterLine:0,
    },
];

// Index rapide par id
export const ZONE_BY_ID = Object.fromEntries(ZONE_DEFS.map(z => [z.id, z]));

// ─────────────────────────────────────────────────────────────────
//  HAUTEUR DU TERRAIN  getHeight(x, z) → y
//  Aucune allocation — vecteurs réutilisables au niveau module
// ─────────────────────────────────────────────────────────────────
const BLEND_MARGIN = 250;   // largeur de la zone de transition entre régions

/**
 * Retourne l'influence (0‒1) d'une zone en un point (x,z).
 * L'influence est 1 à l'intérieur, décroît sur BLEND_MARGIN vers les bords.
 */
function _zoneInfluence(z, x, wz) {
    const dx = Math.min(x - wz.xMin, wz.xMax - x);
    const dz = Math.min(z - wz.zMin, wz.zMax - z);
    const d  = Math.min(dx, dz);
    if (d < 0)              return 0;
    if (d >= BLEND_MARGIN)  return 1;
    const t = d / BLEND_MARGIN;
    return t * t * (3 - 2 * t);  // smoothstep
}

/** Hauteur d'une zone seule en (x, z) */
function _zoneHeight(def, x, z) {
    const s = 1 / def.scale;
    const n = _fbm(x * s, z * s, def.oct, 2.0, def.gain);
    return def.base + n * def.amp;
}

/** Hauteur brute (blend zones, sans override village) */
function _rawHeight(x, z) {
    let totalW = 0, totalH = 0;
    for (let i = 0, len = ZONE_DEFS.length; i < len; i++) {
        const def = ZONE_DEFS[i];
        const w   = _zoneInfluence(z, x, def);
        if (w <= 0) continue;
        totalH += _zoneHeight(def, x, z) * w;
        totalW += w;
    }
    return totalW > 0 ? totalH / totalW : 0;
}

// ── Plateau village ──────────────────────────────────────────────
// Centre du village (= START_X / START_Z de ce fichier)
const _VX      = -1800;
const _VZ      = -2800;
const _V_INNER = 125;   // rayon pleinement plat (couvre grass r=118 + marge)
const _V_OUTER = 400;   // rayon où le terrain redevient totalement naturel
// Hauteur fixe calculée une seule fois à l'init (bruit déjà seeded)
const _V_FLAT_Y = _rawHeight(_VX, _VZ);

/** getHeight — point d'entrée principal pour tout le monde */
export function getHeight(x, z) {
    const natural = _rawHeight(x, z);
    const dx = x - _VX, dz = z - _VZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist >= _V_OUTER) return natural;
    if (dist <= _V_INNER) return _V_FLAT_Y;
    // Transition smoothstep entre plateau plat et terrain naturel
    const t = (dist - _V_INNER) / (_V_OUTER - _V_INNER);
    const blend = t * t * (3 - 2 * t);
    return _V_FLAT_Y + blend * (natural - _V_FLAT_Y);
}

// ─────────────────────────────────────────────────────────────────
//  NORMALE + PENTE DU TERRAIN
// ─────────────────────────────────────────────────────────────────

const _NRM_EPS  = 1.2;   // distance d'échantillonnage pour la normale (mètres)
const _nrmOut   = new THREE.Vector3();   // vecteur réutilisable (pas d'allocation)

/**
 * Calcule la normale du terrain en (x, z) par différences finies.
 * Utilise 4 échantillons getHeight ± _NRM_EPS.
 *
 * @param {number} x
 * @param {number} z
 * @param {THREE.Vector3} [out]  — vecteur de sortie (optionnel, sinon interne)
 * @returns {THREE.Vector3}      — normale normalisée
 */
export function getTerrainNormal(x, z, out = _nrmOut) {
    const hL = getHeight(x - _NRM_EPS, z);
    const hR = getHeight(x + _NRM_EPS, z);
    const hB = getHeight(x, z - _NRM_EPS);
    const hF = getHeight(x, z + _NRM_EPS);
    // Tangentes :  dX = (2ε, hR-hL, 0)   dZ = (0, hF-hB, 2ε)
    // Normale = dX × dZ  (non normalisée puis .normalize())
    out.set(hL - hR, 2 * _NRM_EPS, hB - hF).normalize();
    return out;
}

/**
 * Retourne l'angle d'inclinaison du terrain en (x, z) en radians.
 * 0 = plat, π/2 = vertical.
 */
export function getTerrainSlope(x, z) {
    const n = getTerrainNormal(x, z);
    return Math.acos(Math.min(1, Math.abs(n.y)));
}

/** Zone dominante en (x, z) — pour le nom et l'ambiance */
export function getDominantZone(x, z) {
    let best = null, bestW = -1;
    for (let i = 0, len = ZONE_DEFS.length; i < len; i++) {
        const w = _zoneInfluence(z, x, ZONE_DEFS[i]);
        if (w > bestW) { bestW = w; best = ZONE_DEFS[i]; }
    }
    return best;
}

// ─────────────────────────────────────────────────────────────────
//  COULEUR DU TERRAIN  — vertex color par hauteur + biome
// ─────────────────────────────────────────────────────────────────
const _colA = new THREE.Color(), _colB = new THREE.Color(), _snowColor = new THREE.Color(0xeeeeff);

export function getTerrainColor(x, z, y, target) {
    // Zone dominante
    let bestDef = ZONE_DEFS[0], bestW = -1;
    for (let i = 0; i < ZONE_DEFS.length; i++) {
        const w = _zoneInfluence(z, x, ZONE_DEFS[i]);
        if (w > bestW) { bestW = w; bestDef = ZONE_DEFS[i]; }
    }

    _colA.setHex(bestDef.groundCol);
    _colB.setHex(bestDef.rockCol);

    // Mélange sol/roche selon hauteur relative
    const relH = (y - bestDef.base) / (bestDef.amp + 0.001);
    const rockT = Math.max(0, Math.min(1, (relH - 0.4) / 0.4));
    target.lerpColors(_colA, _colB, rockT);

    // Neige au-dessus de la snow line
    if (bestDef.snowLine > 0 && y > bestDef.snowLine) {
        const snowT = Math.min(1, (y - bestDef.snowLine) / 15);
        target.lerp(_snowColor, snowT * 0.9);
    }

    // Légère variation aléatoire (bruit fins détails)
    const micro = _noise2(x * 0.05, z * 0.05) * 0.06;
    target.r = Math.max(0, Math.min(1, target.r + micro));
    target.g = Math.max(0, Math.min(1, target.g + micro));
    target.b = Math.max(0, Math.min(1, target.b + micro));
}

// ─────────────────────────────────────────────────────────────────
//  SYSTÈME DE CHUNKS
//  Chunk 400×400 unités, 20×20 quads (21×21 vertices)
// ─────────────────────────────────────────────────────────────────
const CHUNK_SIZE    = 400;
const CHUNK_SEGS    = 20;       // quads par côté (full detail)
const CHUNK_SEGS_MED = 10;      // medium LOD
const CHUNK_SEGS_LOW = 5;       // low LOD
const RENDER_DIST   = 2800;     // distance max de rendu (7 chunks)
const LOD_MED_DIST  = 1200;
const LOD_LOW_DIST  = 2000;

const _chunkMap     = new Map();   // key "cx,cz" → mesh
const _chunkPool    = [];          // meshes à recycler
const _buildQueue   = [];          // chunks en attente de construction
let   _scene        = null;

/** Clé unique pour un chunk */
function _chunkKey(cx, cz) { return `${cx},${cz}`; }

/** Coordonnées monde → chunk */
function _worldToChunk(x, z) {
    return {
        cx: Math.floor((x + 4000) / CHUNK_SIZE),
        cz: Math.floor((z + 4000) / CHUNK_SIZE),
    };
}

/** Centre monde d'un chunk */
function _chunkCenter(cx, cz) {
    return {
        x: -4000 + cx * CHUNK_SIZE + CHUNK_SIZE * 0.5,
        z: -4000 + cz * CHUNK_SIZE + CHUNK_SIZE * 0.5,
    };
}

/** Construire la géométrie d'un chunk */
function _buildChunkGeo(cx, cz, segs) {
    const originX = -4000 + cx * CHUNK_SIZE;
    const originZ = -4000 + cz * CHUNK_SIZE;
    const step    = CHUNK_SIZE / segs;
    const verts   = segs + 1;
    const count   = verts * verts;

    const positions = new Float32Array(count * 3);
    const colors    = new Float32Array(count * 3);
    const indices   = [];

    const col = new THREE.Color();
    let idx = 0;

    for (let iz = 0; iz < verts; iz++) {
        for (let ix = 0; ix < verts; ix++) {
            const wx = originX + ix * step;
            const wz = originZ + iz * step;
            const wy = getHeight(wx, wz);

            positions[idx * 3]     = wx;
            positions[idx * 3 + 1] = wy;
            positions[idx * 3 + 2] = wz;

            getTerrainColor(wx, wz, wy, col);
            colors[idx * 3]     = col.r;
            colors[idx * 3 + 1] = col.g;
            colors[idx * 3 + 2] = col.b;

            idx++;
        }
    }

    // Indices
    for (let iz = 0; iz < segs; iz++) {
        for (let ix = 0; ix < segs; ix++) {
            const a = iz * verts + ix;
            const b = a + 1;
            const c = a + verts;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

/** Matériau terrain partagé — vertex color, pas de texture */
const _terrainMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
});

/** Crée ou recycle un mesh de chunk */
function _getChunkMesh() {
    if (_chunkPool.length > 0) return _chunkPool.pop();
    const mesh = new THREE.Mesh(undefined, _terrainMat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = false;
    mesh.castShadow    = false;
    return mesh;
}

/** Ajoute un chunk à la queue (construction différée) */
function _loadChunk(cx, cz, playerX, playerZ) {
    const key = _chunkKey(cx, cz);
    if (_chunkMap.has(key)) return;
    // Évite les doublons dans la queue
    if (_buildQueue.some(q => q.cx === cx && q.cz === cz)) return;

    const center = _chunkCenter(cx, cz);
    const dist   = Math.hypot(center.x - playerX, center.z - playerZ);
    _buildQueue.push({ cx, cz, dist });
}

/** Construit N chunks depuis la queue — appelé chaque frame */
export function processBuildQueue(playerX, playerZ, maxPerFrame = 3) {
    if (_buildQueue.length === 0) return;

    // Priorité aux chunks les plus proches
    _buildQueue.sort((a, b) => a.dist - b.dist);

    let built = 0;
    while (_buildQueue.length > 0 && built < maxPerFrame) {
        const { cx, cz } = _buildQueue.shift();
        const key = _chunkKey(cx, cz);
        if (_chunkMap.has(key)) continue;

        const center = _chunkCenter(cx, cz);
        const dist   = Math.hypot(center.x - playerX, center.z - playerZ);
        if (dist > RENDER_DIST + CHUNK_SIZE) continue;  // devenu hors portée

        const segs = dist < LOD_MED_DIST ? CHUNK_SEGS
                   : dist < LOD_LOW_DIST ? CHUNK_SEGS_MED
                   : CHUNK_SEGS_LOW;

        const mesh = _getChunkMesh();
        mesh.geometry?.dispose();
        mesh.geometry = _buildChunkGeo(cx, cz, segs);
        _scene.add(mesh);
        _chunkMap.set(key, { mesh, cx, cz, segs });
        _vegLoadChunk(cx, cz);
        built++;
    }
}

/** Décharge les chunks trop loin */
function _unloadFarChunks(playerX, playerZ) {
    for (const [key, chunk] of _chunkMap) {
        const center = _chunkCenter(chunk.cx, chunk.cz);
        const dist   = Math.hypot(center.x - playerX, center.z - playerZ);
        if (dist > RENDER_DIST + CHUNK_SIZE) {
            _vegHideChunk(chunk.cx, chunk.cz);
            _scene.remove(chunk.mesh);
            _chunkPool.push(chunk.mesh);
            _chunkMap.delete(key);
        }
    }
}

// Vecteur réutilisable pour updateChunks
const _chunkPlayerChunk = { cx: -9999, cz: -9999 };

/** Appeler chaque frame — met à jour les chunks autour du joueur */
export function updateChunks(playerX, playerZ) {
    const { cx: pcx, cz: pcz } = _worldToChunk(playerX, playerZ);

    // Évite de recalculer si le joueur n'a pas changé de chunk
    if (pcx === _chunkPlayerChunk.cx && pcz === _chunkPlayerChunk.cz) return;
    _chunkPlayerChunk.cx = pcx;
    _chunkPlayerChunk.cz = pcz;

    const radius = Math.ceil(RENDER_DIST / CHUNK_SIZE) + 1;
    for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const cx = pcx + dx, cz = pcz + dz;
            if (cx < 0 || cz < 0 || cx >= 20 || cz >= 20) continue;
            const center = _chunkCenter(cx, cz);
            const dist   = Math.hypot(center.x - playerX, center.z - playerZ);
            if (dist <= RENDER_DIST) _loadChunk(cx, cz, playerX, playerZ);
        }
    }

    _unloadFarChunks(playerX, playerZ);
}

// ─────────────────────────────────────────────────────────────────
//  VÉGÉTATION MONDIALE — InstancedMesh global par asset
//
//  Principe :
//  · 1 InstancedMesh par sous-mesh glTF (ex: BirchTree_1 → trunk + leaves)
//  · Toutes les instances du même asset = 1 draw call mondial
//  · Chunk charge  → slots alloués dans les InstancedMesh
//  · Chunk décharge → slots mis à scale(0,0,0) — libérés visuellement
//  · Templates glTF chargés une seule fois, réutilisés indéfiniment
// ─────────────────────────────────────────────────────────────────

const _NAT_PATH = 'assets/environment/nature/';
const _vegGLTF  = new GLTFLoader();

// ── Assets par biome ─────────────────────────────────────────────
const _ZONE_VEG = {
    kaldrath:       { density:0.25, trees:['DeadTree_1','DeadTree_2','DeadTree_3'],                              bushes:['Bush_Small'] },
    grimveld:       { density:1.0,  trees:['BirchTree_1','BirchTree_2','BirchTree_4','MapleTree_1','MapleTree_3'],bushes:['Bush','Bush_Large'] },
    valdur:         { density:0.45, trees:['MapleTree_1','MapleTree_2','MapleTree_3'],                           bushes:['Bush_Flowers','Bush_Small_Flowers'] },
    harncross:      { density:0.45, trees:['MapleTree_4','MapleTree_5','BirchTree_1'],                           bushes:['Bush','Bush_Flowers'] },
    duskmere:       { density:0.28, trees:['DeadTree_4','DeadTree_5','DeadTree_6'],                              bushes:['Bush_Small'] },
    ashfen:         { density:0.22, trees:['DeadTree_7','DeadTree_8','DeadTree_9'],                              bushes:['Bush_Small'] },
    stonemark:      { density:0.10, trees:['DeadTree_1','DeadTree_2'],                                           bushes:[] },
    terres_brulees: { density:0.07, trees:['DeadTree_9','DeadTree_10'],                                          bushes:[] },
    grande_foret:   { density:1.4,  trees:['BirchTree_1','BirchTree_2','BirchTree_3','BirchTree_5','MapleTree_2','MapleTree_4'],bushes:['Bush','Bush_Large','Bush_Small'] },
    marais_visages: { density:0.18, trees:['DeadTree_3','DeadTree_5','DeadTree_7'],                              bushes:['Bush_Small'] },
    desert_sel:     { density:0.0,  trees:[],                                                                    bushes:[] },
    lande_pendus:   { density:0.22, trees:['DeadTree_4','DeadTree_6','DeadTree_8'],                              bushes:['Bush_Small'] },
    gorges_pierre:  { density:0.10, trees:['DeadTree_1','DeadTree_3'],                                           bushes:[] },
    cote_brisee:    { density:0.35, trees:['BirchTree_1','BirchTree_3','BirchTree_5'],                           bushes:['Bush_Small'] },
    approche:       { density:0.18, trees:['DeadTree_9','DeadTree_10'],                                          bushes:[] },
};

const _VEG_TREES_BASE = 14;    // spots arbres à density=1.0 par chunk
const _VEG_BUSH_BASE  = 20;    // spots buissons à density=1.0 par chunk
const _VEG_SLOPE_MAX  = 0.45;  // rad — pas de végétation au-delà
const _VEG_EXCL_R     = 200;   // exclusion autour du village (px)
const _VEG_MAX_TREE   = 600;   // max instances globales par asset arbre
const _VEG_MAX_BUSH   = 900;   // max instances globales par asset buisson

const _vegDummy = new THREE.Object3D();

// templates : name → [{ geo:BufferGeometry, mat:Material }]
const _vegTemplates = new Map();
const _vegLoading   = new Set();
const _vegPending   = [];   // [{name, cb}] — callbacks attendant un template

// instanced : name → { imeshes:InstancedMesh[], nextSlot:number, slots:Map<key,[{start,cnt}]> }
const _vegInstanced = new Map();

/** Capacité max selon le type d'asset. */
function _vegMax(name) {
    return (name.includes('Tree') || name.startsWith('Dead')) ? _VEG_MAX_TREE : _VEG_MAX_BUSH;
}

/**
 * Extrait les [{ geo, mat }] du glTF.
 * La transform locale de chaque sous-mesh est baked dans la géométrie
 * (permet d'utiliser la même matrice d'instance pour trunk et feuilles).
 * Tous les matériaux sont convertis en MeshLambertMaterial pour éviter
 * le bug VALIDATE_STATUS false / context lost sur certains GPU.
 */
function _vegExtract(gltfScene) {
    gltfScene.updateMatrixWorld(true);
    const inv  = new THREE.Matrix4().copy(gltfScene.matrixWorld).invert();
    const defs = [];
    gltfScene.traverse(child => {
        if (!child.isMesh) return;
        const geo = child.geometry.clone();
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, child.matrixWorld));
        const src = Array.isArray(child.material) ? child.material[0] : child.material;
        // Convertir en Lambert — les shaders MeshStandard/MeshPhysical causent
        // VALIDATE_STATUS false + context lost sur certains GPU (même bug que le verre).
        const mat = new THREE.MeshLambertMaterial({
            color:      src.color?.clone() ?? new THREE.Color(0xffffff),
            map:        src.map        ?? null,
            transparent:src.transparent ?? false,
            opacity:    src.opacity    ?? 1.0,
            alphaTest:  src.alphaTest  ?? 0.1,
            side:       src.side       ?? THREE.FrontSide,
            depthWrite: src.depthWrite ?? true,
        });
        defs.push({ geo, mat });
    });
    return defs;
}

/** Crée les InstancedMesh globaux pour un asset et les ajoute à la scène. */
function _vegEnsureInstanced(name) {
    if (_vegInstanced.has(name)) return;
    const defs = _vegTemplates.get(name);
    if (!defs || defs.length === 0) return;
    const max = _vegMax(name);
    const imeshes = defs.map(({ geo, mat }) => {
        const im = new THREE.InstancedMesh(geo, mat, max);
        im.count          = 0;
        im.frustumCulled  = false;
        im.castShadow     = false;
        im.receiveShadow  = false;
        return im;
    });
    _vegInstanced.set(name, { imeshes, nextSlot: 0, slots: new Map() });
    if (_scene) imeshes.forEach(im => _scene.add(im));
}

/** Charge un template glTF une seule fois. Appelle cb() quand prêt. */
function _vegLoadTemplate(name, cb) {
    if (_vegTemplates.has(name)) { cb(); return; }
    if (_vegLoading.has(name))   { _vegPending.push({ name, cb }); return; }
    _vegLoading.add(name);
    _vegGLTF.load(`${_NAT_PATH}${name}.gltf`, gltf => {
        _vegTemplates.set(name, _vegExtract(gltf.scene));
        _vegLoading.delete(name);
        _vegEnsureInstanced(name);
        cb();
        for (let i = _vegPending.length - 1; i >= 0; i--) {
            if (_vegPending[i].name === name) { _vegPending[i].cb(); _vegPending.splice(i, 1); }
        }
    }, undefined, () => {
        _vegTemplates.set(name, []);  // échec → empêche retry infini
        _vegLoading.delete(name);
    });
}

/** RNG déterministe basé sur les coordonnées chunk. */
function _vegRng(cx, cz) {
    let s = ((cx * 73856093) ^ (cz * 19349663)) >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Génère les points de placement pour un chunk (pur calcul, pas de chargement). */
function _vegGenPoints(cx, cz) {
    const center  = _chunkCenter(cx, cz);
    let bestZone  = null, bestW = -1;
    for (const def of ZONE_DEFS) {
        const w = _zoneInfluence(center.z, center.x, def);
        if (w > bestW) { bestW = w; bestZone = def; }
    }
    const cfg = bestZone ? _ZONE_VEG[bestZone.id] : null;
    if (!cfg || cfg.density === 0) return [];

    const rng = _vegRng(cx, cz);
    const ox  = -4000 + cx * CHUNK_SIZE;
    const oz  = -4000 + cz * CHUNK_SIZE;
    const pts = [];

    const place = (n, assets) => {
        if (!assets.length) return;
        for (let i = 0; i < n; i++) {
            const x    = ox + rng() * CHUNK_SIZE;
            const z    = oz + rng() * CHUNK_SIZE;
            const ry   = rng() * Math.PI * 2;
            const sc   = 0.75 + rng() * 0.5;
            const name = assets[Math.floor(rng() * assets.length)];
            if (getTerrainSlope(x, z) > _VEG_SLOPE_MAX) continue;
            if (Math.hypot(x - _VX, z - _VZ) < _VEG_EXCL_R) continue;
            pts.push({ x, z, ry, sc, name });
        }
    };

    place(Math.round(_VEG_TREES_BASE * cfg.density), cfg.trees);
    place(Math.round(_VEG_BUSH_BASE  * cfg.density), cfg.bushes);
    return pts;
}

/** Place les instances dans les InstancedMesh (après chargement des templates). */
function _vegPlaceChunk(cx, cz, pts) {
    const key   = _chunkKey(cx, cz);
    const byName = new Map();
    for (const p of pts) {
        let arr = byName.get(p.name);
        if (!arr) { arr = []; byName.set(p.name, arr); }
        arr.push(p);
    }
    for (const [name, points] of byName) {
        const inst = _vegInstanced.get(name);
        if (!inst) continue;
        if (inst.nextSlot + points.length > _vegMax(name)) continue;

        const start = inst.nextSlot;
        const cnt   = points.length;
        for (let i = 0; i < cnt; i++) {
            const p = points[i];
            _vegDummy.position.set(p.x, getHeight(p.x, p.z), p.z);
            _vegDummy.rotation.set(0, p.ry, 0);
            _vegDummy.scale.setScalar(p.sc);
            _vegDummy.updateMatrix();
            inst.imeshes.forEach(im => im.setMatrixAt(start + i, _vegDummy.matrix));
        }
        inst.imeshes.forEach(im => {
            im.count = Math.max(im.count, start + cnt);
            im.instanceMatrix.needsUpdate = true;
        });
        if (!inst.slots.has(key)) inst.slots.set(key, []);
        inst.slots.get(key).push({ start, cnt });
        inst.nextSlot += cnt;
    }
}

const _vegZeroMat = new THREE.Matrix4().makeScale(0, 0, 0);

/** Cache les instances d'un chunk en les mettant à scale zéro. */
function _vegHideChunk(cx, cz) {
    const key = _chunkKey(cx, cz);
    for (const [, inst] of _vegInstanced) {
        const slotList = inst.slots.get(key);
        if (!slotList) continue;
        for (const { start, cnt } of slotList) {
            for (let i = 0; i < cnt; i++) {
                inst.imeshes.forEach(im => im.setMatrixAt(start + i, _vegZeroMat));
            }
        }
        inst.imeshes.forEach(im => im.instanceMatrix.needsUpdate = true);
        inst.slots.delete(key);
    }
}

/** Démarre le chargement des templates + placement pour un chunk. */
function _vegLoadChunk(cx, cz) {
    const pts = _vegGenPoints(cx, cz);
    if (!pts.length) return;
    const needed    = [...new Set(pts.map(p => p.name))];
    let   remaining = needed.length;
    const onLoaded  = () => { if (--remaining === 0) _vegPlaceChunk(cx, cz, pts); };
    for (const name of needed) _vegLoadTemplate(name, onLoaded);
}

// ─────────────────────────────────────────────────────────────────
//  EAU DE SURFACE  — plan unique centré sur le joueur
// ─────────────────────────────────────────────────────────────────
let _waterMesh = null;

function _buildWater(scene) {
    const geo = new THREE.PlaneGeometry(6000, 6000);
    const mat = new THREE.MeshLambertMaterial({
        color: 0x1a3a5a,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
    });
    _waterMesh = new THREE.Mesh(geo, mat);
    _waterMesh.rotation.x = -Math.PI / 2;
    _waterMesh.position.y = 0.5;  // niveau de la mer
    _waterMesh.renderOrder = 1;
    scene.add(_waterMesh);
}

/** Maintient l'eau centrée sur le joueur */
export function updateWater(playerX, playerZ) {
    if (_waterMesh) {
        _waterMesh.position.x = playerX;
        _waterMesh.position.z = playerZ;
    }
}


// ─────────────────────────────────────────────────────────────────
//  BROUILLARD — adapté à la zone
// ─────────────────────────────────────────────────────────────────
const _fogColor = new THREE.Color(0x1a1e2a);

export function updateFog(scene, playerX, playerZ) {
    const zone = getDominantZone(playerX, playerZ);
    if (!zone) return;

    // Couleur de brouillard par biome
    let fogHex = 0x1a1e2a;
    if (zone.id === 'ashfen' || zone.id === 'marais_visages') fogHex = 0x1a2218;
    else if (zone.id === 'grimveld' || zone.id === 'grande_foret')  fogHex = 0x181e18;
    else if (zone.id === 'kaldrath' || zone.id === 'stonemark')     fogHex = 0x1a2030;
    else if (zone.id === 'terres_brulees' || zone.id === 'approche')fogHex = 0x2a1810;
    else if (zone.id === 'desert_sel')                              fogHex = 0x2a2820;

    _fogColor.setHex(fogHex);
    // Ne pas toucher scene.background (géré par DayNightCycle)
    if (scene.fog) scene.fog.color.lerp(_fogColor, 0.02);
}

// ─────────────────────────────────────────────────────────────────
//  POINT DE DÉPART  — village de départ dans Kaldrath
// ─────────────────────────────────────────────────────────────────
export const START_X = -1800;
export const START_Z = -2800;

// ─────────────────────────────────────────────────────────────────
//  ENTRÉE PRINCIPALE
// ─────────────────────────────────────────────────────────────────
export function buildWorld(scene) {
    _scene = scene;

    // Fond de scène et brouillard
    scene.background = new THREE.Color(_fogColor);
    scene.fog        = new THREE.FogExp2(_fogColor, 0.0008);

    // Eau
    _buildWater(scene);

    // Les chunks sont générés dynamiquement via updateChunks()
    // Le premier appel dans game.js lance le chargement initial
}
