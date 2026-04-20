/**
 * Three.js Game Editor — local server
 * Run with:        node server.js
 *   or:            node server.js --assets-root <path>
 *   or:            TOOLS_WEB_ASSETS_ROOT=<path> node server.js
 * Compile to exe:  npx pkg server.js --target node18-win-x64 --output Studio.exe
 *
 * Three roots:
 *   /assets/*   → ASSETS_ROOT (bundled `./assets/` by default; overridable)
 *   /manifest/* → MANIFEST_ROOT (CSV catalogs from tools/measure_gltf_pack.py --catalog)
 *   anything else → TOOLS_ROOT (this directory)
 */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

// Port 3000 is taken by Grafana in this repo's Docker compose, and Docker's
// forwarder catches requests before this Node process even binds. Pick an
// unlikely-to-collide high port. Override with --port <n> or TOOLS_WEB_PORT.
let PORT = 47823;
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--port' && process.argv[i + 1]) {
        PORT = parseInt(process.argv[i + 1], 10);
        break;
    }
}
if (process.env.TOOLS_WEB_PORT) {
    const n = parseInt(process.env.TOOLS_WEB_PORT, 10);
    if (Number.isFinite(n)) PORT = n;
}
process.title = 'Three.js Game Editor';

// Quand compilé avec pkg, process.execPath = chemin du .exe
// Quand lancé avec node, __filename = chemin du script
const TOOLS_ROOT = path.dirname(
    typeof process.pkg !== 'undefined' ? process.execPath : __filename
);

// --- Asset root resolution -------------------------------------------------
// Priority: --assets-root <path>  >  $TOOLS_WEB_ASSETS_ROOT  >  bundled ./assets/
let assetsRootArg = null;
let assetsRootSource = 'bundled';
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--assets-root' && process.argv[i + 1]) {
        assetsRootArg = process.argv[i + 1];
        assetsRootSource = '--assets-root';
        break;
    }
}
if (!assetsRootArg && process.env.TOOLS_WEB_ASSETS_ROOT) {
    assetsRootArg = process.env.TOOLS_WEB_ASSETS_ROOT;
    assetsRootSource = 'TOOLS_WEB_ASSETS_ROOT';
}
const ASSETS_ROOT = assetsRootArg
    ? path.resolve(process.cwd(), assetsRootArg)
    : path.join(TOOLS_ROOT, 'assets');
const ASSETS_URL_PREFIX = '/assets/';

// Per-pack asset catalog CSVs, emitted by tools/measure_gltf_pack.py --catalog.
// Served at /manifest/<pack>.csv so the browser tools can fetch them as
// asset inventories without hard-coding file lists.
//
// Resolution order mirrors ASSETS_ROOT:
//   1. --manifest-root <path>
//   2. $TOOLS_WEB_MANIFEST_ROOT
//   3. derived from ASSETS_ROOT: <assets_root>/../../docs/research/asset-inventories
//      (works when assets_root is client/game/assets and the repo root is
//       two levels up — our standard layout)
//   4. bundled ./manifests/ inside TOOLS_ROOT
let manifestRootArg = null;
let manifestRootSource = 'derived';
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--manifest-root' && process.argv[i + 1]) {
        manifestRootArg = process.argv[i + 1];
        manifestRootSource = '--manifest-root';
        break;
    }
}
if (!manifestRootArg && process.env.TOOLS_WEB_MANIFEST_ROOT) {
    manifestRootArg = process.env.TOOLS_WEB_MANIFEST_ROOT;
    manifestRootSource = 'TOOLS_WEB_MANIFEST_ROOT';
}
let MANIFEST_ROOT;
if (manifestRootArg) {
    MANIFEST_ROOT = path.resolve(process.cwd(), manifestRootArg);
} else {
    const derived = path.resolve(ASSETS_ROOT, '..', '..', '..', 'docs', 'research', 'asset-inventories');
    if (fs.existsSync(derived)) {
        MANIFEST_ROOT = derived;
    } else {
        MANIFEST_ROOT = path.join(TOOLS_ROOT, 'manifests');
        manifestRootSource = 'bundled';
    }
}
const MANIFEST_URL_PREFIX = '/manifest/';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js'  : 'application/javascript; charset=utf-8',
    '.css' : 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.csv' : 'text/csv; charset=utf-8',
    '.glb' : 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin' : 'application/octet-stream',
    '.png' : 'image/png',
    '.jpg' : 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp3' : 'audio/mpeg',
    '.ogg' : 'audio/ogg',
    '.wav' : 'audio/wav',
    '.svg' : 'image/svg+xml',
    '.ico' : 'image/x-icon',
};

function resolveRoot(reqPath) {
    if (reqPath === ASSETS_URL_PREFIX.slice(0, -1) || reqPath.startsWith(ASSETS_URL_PREFIX)) {
        const rest = reqPath.slice(ASSETS_URL_PREFIX.length - 1); // keep leading '/'
        return { root: ASSETS_ROOT, rel: rest || '/' };
    }
    if (reqPath === MANIFEST_URL_PREFIX.slice(0, -1) || reqPath.startsWith(MANIFEST_URL_PREFIX)) {
        const rest = reqPath.slice(MANIFEST_URL_PREFIX.length - 1);
        return { root: MANIFEST_ROOT, rel: rest || '/' };
    }
    return { root: TOOLS_ROOT, rel: reqPath };
}

const server = http.createServer((req, res) => {
    // Decode URL and ignore query strings.
    let reqPath = decodeURIComponent(req.url.split('?')[0]);

    const { root, rel } = resolveRoot(reqPath);

    // Security: prevent directory traversal.
    const absPath = path.normalize(path.join(root, rel));
    if (!absPath.startsWith(root)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    // File resolution order:
    //   1. Exact path
    //   2. path/index.html (directory)
    //   3. path + .html (e.g. /gameplay-test → gameplay-test.html)
    function resolvePath(cb) {
        fs.stat(absPath, (err0, stat0) => {
            if (!err0 && stat0.isFile()) { cb(absPath); return; }
            const indexHtml = path.join(absPath, 'index.html');
            fs.stat(indexHtml, (err1, stat1) => {
                if (!err1 && stat1.isFile()) { cb(indexHtml); return; }
                const withHtml = absPath + '.html';
                fs.stat(withHtml, (err2, stat2) => {
                    cb((!err2 && stat2.isFile()) ? withHtml : absPath);
                });
            });
        });
    }

    resolvePath(filePath => {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end(`404 — ${reqPath}`);
            return;
        }
        const ext  = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type'  : mime,
            'Cache-Control' : 'no-cache',
        });
        res.end(data);
    });
    }); // resolvePath
});

server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║    Three.js Game Editor              ║');
    console.log(`  ║  ${url.padEnd(36)}║`);
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  tools root    : ${TOOLS_ROOT}`);
    console.log(`  assets root   : ${ASSETS_ROOT}  [from: ${assetsRootSource}]`);
    console.log(`  manifest root : ${MANIFEST_ROOT}  [from: ${manifestRootSource}]`);
    console.log('');
    console.log('  Ctrl+C to stop the server.');
    console.log('');
});

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n  Port ${PORT} already in use — close the other instance or set --port / TOOLS_WEB_PORT.\n`);
    } else {
        console.error(err);
    }
    process.exit(1);
});
