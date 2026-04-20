/**
 * src/manifest-loader.js — Load a per-pack asset catalog from the
 * CSV produced by `tools/measure_gltf_pack.py --catalog`.
 *
 * The CSV lives at <repo>/docs/research/asset-inventories/<pack>.csv
 * and is served by server.js at /manifest/<pack>.csv.
 *
 * Usage:
 *   import { loadManifest } from './src/manifest-loader.js';
 *   const rows = await loadManifest('poly-mega-survival-tools');
 *   // rows is an array of objects with typed columns:
 *   //   { pack, path, name, category, variants,
 *   //     w_m, h_m, d_m, w_vx, h_vx, d_vx, h_over_player,
 *   //     vertices, faces, size_mb, materials: [...], has_anim, has_rig }
 *
 * The loader is deliberately tiny — no csv-parse dependency. Handles
 * the quoted `materials` column (only field we wrap in quotes) and
 * leaves other fields as raw strings until per-column coercion.
 */

/** Split a CSV line respecting "..." quoted fields. */
function splitCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += c;
            }
        } else {
            if (c === '"') {
                inQuotes = true;
            } else if (c === ',') {
                out.push(cur);
                cur = '';
            } else {
                cur += c;
            }
        }
    }
    out.push(cur);
    return out;
}

/** Per-column type coercion. Keep this in sync with CATALOG_HEADER in
 *  tools/measure_gltf_pack.py. */
function coerceRow(header, fields) {
    const row = {};
    for (let i = 0; i < header.length; i++) {
        const key = header[i];
        const val = fields[i];
        if (val === undefined) {
            row[key] = null;
            continue;
        }
        switch (key) {
            case 'w_m': case 'h_m': case 'd_m':
            case 'w_vx': case 'h_vx': case 'd_vx':
            case 'h_over_player': case 'size_mb':
                row[key] = parseFloat(val);
                break;
            case 'vertices': case 'faces':
                row[key] = parseInt(val, 10);
                break;
            case 'has_anim': case 'has_rig':
                row[key] = (val === 'true');
                break;
            case 'materials':
                row[key] = val ? val.split(';').filter(Boolean) : [];
                break;
            default:
                row[key] = val;
        }
    }
    return row;
}

/**
 * Fetch + parse a pack CSV manifest.
 * @param {string} packSlug  e.g. 'poly-mega-survival-tools'
 * @returns {Promise<object[]>}  parsed rows
 */
export async function loadManifest(packSlug) {
    const url = `/manifest/${packSlug}.csv`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`manifest ${packSlug}: HTTP ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(l => l.length && !l.startsWith('#'));
    if (lines.length === 0) return [];
    const header = splitCsvLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const fields = splitCsvLine(lines[i]);
        if (fields.length < header.length) continue;
        rows.push(coerceRow(header, fields));
    }
    return rows;
}

/**
 * Build the asset URL for a row. The `path` column is relative to the pack
 * root; our server exposes packs under /assets/<vendor>/<pack>/.
 * @param {string} vendor   e.g. 'animpicstudio'
 * @param {string} packSlug e.g. 'poly-mega-survival-tools'
 * @param {object} row      a parsed manifest row
 */
export function assetUrl(vendor, packSlug, row) {
    return `/assets/${vendor}/${packSlug}/${row.path}`;
}

/**
 * Convenience: group rows by their `category` column. Returns a Map.
 */
export function groupByCategory(rows) {
    const map = new Map();
    for (const r of rows) {
        const k = r.category || 'misc';
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(r);
    }
    return map;
}
