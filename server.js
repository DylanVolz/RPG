/**
 * Three.js Game Editor — serveur local
 * Lance avec :  node server.js
 * Compile en exe :  npx pkg server.js --target node18-win-x64 --output Studio.exe
 */
'use strict';

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { exec } = require('child_process');

const PORT = 3000;
process.title = 'Three.js Game Editor';

// Quand compilé avec pkg, process.execPath = chemin du .exe
// Quand lancé avec node, __filename = chemin du script
const ROOT = path.dirname(
    typeof process.pkg !== 'undefined' ? process.execPath : __filename
);

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

const server = http.createServer((req, res) => {
    // Décoder l'URL et ignorer les query strings
    let reqPath = decodeURIComponent(req.url.split('?')[0]);

    // Sécurité : empêcher la traversée de répertoire
    const absPath = path.normalize(path.join(ROOT, reqPath));
    if (!absPath.startsWith(ROOT)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    // Résolution du fichier :
    //   1. Chemin exact
    //   2. Chemin + .html  (ex: /gameplay-test → gameplay-test.html)
    //   3. Chemin/index.html (dossier)
    function resolvePath(cb) {
        fs.access(absPath, fs.constants.F_OK, err0 => {
            if (!err0) { cb(absPath); return; }
            const withHtml = absPath + '.html';
            fs.access(withHtml, fs.constants.F_OK, err1 => {
                if (!err1) { cb(withHtml); return; }
                cb(path.join(absPath, 'index.html'));
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
    console.log('  Ctrl+C pour arrêter le serveur.');
    console.log('');

    // Ouvrir Chrome (ou navigateur par défaut)
    const open = `start "" "${url}"`;
    exec(open, err => {
        if (err) console.log(`  Ouvre manuellement : ${url}`);
    });
});

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n  Port ${PORT} déjà utilisé — ferme l'autre instance ou change le PORT.\n`);
    } else {
        console.error(err);
    }
    process.exit(1);
});
