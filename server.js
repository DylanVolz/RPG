/**
 * Three.js Game Editor — serveur local
 * Lance avec :  node server.js
 *   ou        :  node server.js --assets-root <path>
 *   ou        :  TOOLS_WEB_ASSETS_ROOT=<path> node server.js
 * Compile en exe :  npx pkg server.js --target node18-win-x64 --output Studio.exe
 *
 * Two roots:
 *   /assets/*  → ASSETS_ROOT (bundled `./assets/` by default; overridable)
 *   anything else → TOOLS_ROOT (this directory)
 */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3000;
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

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js'  : 'application/javascript; charset=utf-8',
    '.css' : 'text/css; charset=utf-8',
    '.json': 'application/json',
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
    return { root: TOOLS_ROOT, rel: reqPath };
}

const server = http.createServer((req, res) => {
    // Décoder l'URL et ignorer les query strings
    let reqPath = decodeURIComponent(req.url.split('?')[0]);

    const { root, rel } = resolveRoot(reqPath);

    // Sécurité : empêcher la traversée de répertoire
    const absPath = path.normalize(path.join(root, rel));
    if (!absPath.startsWith(root)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    // Résolution du fichier :
    //   1. Chemin exact
    //   2. Chemin/index.html (dossier)
    //   3. Chemin + .html  (ex: /gameplay-test → gameplay-test.html)
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
    console.log('  ╔══════════════════════════════════╗');
    console.log('  ║    Three.js Game Editor          ║');
    console.log(`  ║  ${url}          ║`);
    console.log('  ╚══════════════════════════════════╝');
    console.log('');
    console.log(`  tools root : ${TOOLS_ROOT}`);
    console.log(`  assets root: ${ASSETS_ROOT}  [from: ${assetsRootSource}]`);
    console.log('');
    console.log('  Ctrl+C pour arrêter le serveur.');
    console.log('');
});

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n  Port ${PORT} déjà utilisé — ferme l'autre instance ou change le PORT.\n`);
    } else {
        console.error(err);
    }
    process.exit(1);
});
