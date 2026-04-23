/**
 * src/thumbnail-cache.js — Persistent thumbnail cache for tools-web asset browsers.
 *
 * Renders a square thumbnail of a glTF asset using a shared offscreen Three.js
 * renderer and caches the resulting PNG blob in IndexedDB, keyed by asset URL
 * + render size + device pixel ratio. Subsequent requests for the same asset
 * return the cached blob without reopening the GLB or touching the GPU.
 *
 * Typical usage:
 *   import { getThumbnail, clearCache, cacheStats } from './src/thumbnail-cache.js';
 *   imgEl.src = await getThumbnail('/assets/animpicstudio/poly-farm/Apple.gltf');
 *
 * The store name carries a schema version — bump STORE_NAME when the render
 * pipeline changes so old entries are ignored automatically.
 *
 * Cache entries do NOT expire on their own: URL is the only cache key. If an
 * asset file changes on disk, call clearCache() to force re-render.
 *
 * Concurrent requests for the same key are deduplicated so the GLB is only
 * parsed + rendered once even when many grid cells kick off loads in parallel.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DB_NAME = 'tools-web-thumbnails';
const DB_VERSION = 1;
// Bump the store name when the rendering pipeline changes (lighting, framing,
// format) so stale entries are effectively invalidated without needing every
// user to manually clear the cache.
const STORE_NAME = 'thumbs_v1';

// TODO(T-0200): expose as tunable (thumbnail render size in CSS pixels).
const DEFAULT_SIZE = 256;
// TODO(T-0200): expose as tunable (neutral-dark background for the offscreen
// scene; matches the kit-browser viewport palette).
const DEFAULT_BG = 0x14181d;
// TODO(T-0200): expose as tunable (render DPR; 1 keeps PNGs small — callers
// that need retina crispness pass dpr: 2).
const DEFAULT_DPR = 1;
// TODO(T-0200): expose as tunable (fit padding: 1.0 = tight, 1.3 = 30% room
// around the bounding box so nothing kisses the frame).
const FIT_PADDING = 1.3;

// -----------------------------------------------------------------------------
// IndexedDB helpers (stdlib API; no extra deps).
// -----------------------------------------------------------------------------

let _dbPromise = null;

function _openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    return _dbPromise;
}

function _tx(db, mode) {
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

async function _dbGet(key) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
        const req = _tx(db, 'readonly').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

async function _dbPut(key, value) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
        const t = db.transaction(STORE_NAME, 'readwrite');
        t.objectStore(STORE_NAME).put(value, key);
        t.oncomplete = () => resolve();
        t.onerror    = () => reject(t.error);
        t.onabort    = () => reject(t.error);
    });
}

async function _dbClear() {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
        const t = db.transaction(STORE_NAME, 'readwrite');
        t.objectStore(STORE_NAME).clear();
        t.oncomplete = () => resolve();
        t.onerror    = () => reject(t.error);
        t.onabort    = () => reject(t.error);
    });
}

async function _dbCount() {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
        const req = _tx(db, 'readonly').count();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

// -----------------------------------------------------------------------------
// Offscreen Three.js renderer (lazy singleton; reconfigured on size change).
// -----------------------------------------------------------------------------

let _rendererState = null;
let _loader = null;

function _ensureLoader() {
    if (!_loader) _loader = new GLTFLoader();
    return _loader;
}

function _ensureRenderer(size, dpr) {
    if (_rendererState && _rendererState.size === size && _rendererState.dpr === dpr) {
        return _rendererState;
    }
    if (_rendererState) {
        _rendererState.renderer.dispose();
        _rendererState = null;
    }
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        preserveDrawingBuffer: true,
        alpha: false,
    });
    renderer.setPixelRatio(dpr);
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(DEFAULT_BG);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 8, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x667788, 0.6);
    fill.position.set(-4, 3, -4);
    scene.add(fill);

    // FOV=35° gives a mildly tele look that keeps perspective distortion low
    // on small thumbnails. Aspect stays 1 (square output).
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);

    _rendererState = { renderer, scene, camera, size, dpr };
    return _rendererState;
}

function _frameAndRender(obj) {
    const { scene, camera, renderer } = _rendererState;

    const box = new THREE.Box3().setFromObject(obj);
    const ctr = box.getCenter(new THREE.Vector3());
    obj.position.sub(ctr);

    const dims = box.getSize(new THREE.Vector3());
    const maxSide = Math.max(dims.x, dims.y, dims.z, 0.001);
    const fovRad = (camera.fov * Math.PI) / 180;
    const dist = (maxSide * FIT_PADDING) / (2 * Math.tan(fovRad / 2));

    // Three-quarter view so shapes read better than a pure front-on.
    camera.position.set(dist * 0.8, dist * 0.7, dist);
    camera.lookAt(0, 0, 0);
    camera.near = Math.max(0.01, dist * 0.01);
    camera.far  = dist * 20;
    camera.updateProjectionMatrix();

    scene.add(obj);
    try {
        renderer.render(scene, camera);
    } finally {
        scene.remove(obj);
    }
}

function _disposeObject(obj) {
    obj.traverse(c => {
        if (!c.isMesh) return;
        c.geometry?.dispose?.();
        const mats = Array.isArray(c.material) ? c.material : (c.material ? [c.material] : []);
        for (const m of mats) {
            for (const prop of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
                m[prop]?.dispose?.();
            }
            m.dispose?.();
        }
    });
}

function _canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('canvas.toBlob returned null'));
        }, 'image/png');
    });
}

// -----------------------------------------------------------------------------
// Public API.
// -----------------------------------------------------------------------------

// Map<cacheKey, Promise<string>> — dedupes concurrent requests.
const _inflight = new Map();

/**
 * Get a cached or freshly-rendered thumbnail blob URL for `url`.
 *
 * @param {string} url  - GLB/GLTF asset URL served by the tools-web server.
 * @param {object} [opts]
 * @param {number} [opts.size=256]  Thumbnail width/height in CSS pixels.
 * @param {number} [opts.dpr=1]     Device pixel ratio to render at.
 * @returns {Promise<string>} A `blob:` URL pointing to a PNG. Callers that
 *   aggressively churn thumbnails (e.g. virtualised grids) should call
 *   `URL.revokeObjectURL(blobUrl)` when they detach the image to free memory;
 *   the underlying Blob stays in IndexedDB regardless.
 */
export async function getThumbnail(url, opts = {}) {
    const size = opts.size ?? DEFAULT_SIZE;
    const dpr  = opts.dpr  ?? DEFAULT_DPR;
    const key  = `${url}|${size}|${dpr}`;

    const existing = _inflight.get(key);
    if (existing) return existing;

    const p = (async () => {
        const cached = await _dbGet(key);
        if (cached instanceof Blob) return URL.createObjectURL(cached);

        const state = _ensureRenderer(size, dpr);
        const loader = _ensureLoader();
        const gltf = await loader.loadAsync(url);
        const obj = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (!obj) throw new Error(`thumbnail: no scene in gltf: ${url}`);

        try {
            _frameAndRender(obj);
            const blob = await _canvasToPngBlob(state.renderer.domElement);
            try {
                await _dbPut(key, blob);
            } catch (e) {
                // Cache miss on write is survivable — we still return the
                // freshly rendered blob, we just won't persist it this time.
                console.warn('thumbnail-cache: put failed for', url, e);
            }
            return URL.createObjectURL(blob);
        } finally {
            _disposeObject(obj);
        }
    })();

    _inflight.set(key, p);
    try {
        return await p;
    } finally {
        _inflight.delete(key);
    }
}

/**
 * True if a thumbnail for `url` (at the given size/dpr) is already cached.
 * Useful for UIs that want to distinguish "instant" vs "will-render" paths.
 */
export async function hasCached(url, opts = {}) {
    const size = opts.size ?? DEFAULT_SIZE;
    const dpr  = opts.dpr  ?? DEFAULT_DPR;
    const key  = `${url}|${size}|${dpr}`;
    const v = await _dbGet(key);
    return v instanceof Blob;
}

/** Wipe every cached thumbnail. */
export async function clearCache() {
    return _dbClear();
}

/** Returns `{ entries }` — total rows in the active thumbnail store. */
export async function cacheStats() {
    return { entries: await _dbCount() };
}
