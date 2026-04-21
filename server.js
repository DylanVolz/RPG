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

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { spawn } = require('child_process');

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

// --- Task API sidecar (Python) ---------------------------------------------
// The Task Viewer page hits /api/tasks/* which this server proxies to a local
// Python HTTP server (tools/task_api_server.py in the main game repo). The
// sidecar is spawned as a child of this Node process and reaped on exit.
//
// Config resolution:
//   --task-api-port <n>    / TOOLS_WEB_TASK_API_PORT    (default 47824)
//   --task-api-script <p>  / TOOLS_WEB_TASK_API_SCRIPT  (default: derived from ASSETS_ROOT)
//   --no-task-api                                         disable the sidecar entirely
let TASK_API_PORT = 47824;
let TASK_API_DISABLED = false;
let taskApiScriptArg = null;
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--task-api-port' && process.argv[i + 1]) {
        TASK_API_PORT = parseInt(process.argv[i + 1], 10);
    }
    if (process.argv[i] === '--task-api-script' && process.argv[i + 1]) {
        taskApiScriptArg = process.argv[i + 1];
    }
    if (process.argv[i] === '--no-task-api') TASK_API_DISABLED = true;
}
if (process.env.TOOLS_WEB_TASK_API_PORT) {
    const n = parseInt(process.env.TOOLS_WEB_TASK_API_PORT, 10);
    if (Number.isFinite(n)) TASK_API_PORT = n;
}
if (!taskApiScriptArg && process.env.TOOLS_WEB_TASK_API_SCRIPT) {
    taskApiScriptArg = process.env.TOOLS_WEB_TASK_API_SCRIPT;
}
let TASK_API_SCRIPT;
if (taskApiScriptArg) {
    TASK_API_SCRIPT = path.resolve(process.cwd(), taskApiScriptArg);
} else {
    // Default: assume repo layout — ASSETS_ROOT is <repo>/client/game/assets,
    // task_api_server.py is <repo>/tools/task_api_server.py.
    TASK_API_SCRIPT = path.resolve(ASSETS_ROOT, '..', '..', '..', 'tools', 'task_api_server.py');
}
const TASK_API_URL_PREFIX = '/api/';

let taskApiChild = null;
let shuttingDown = false;
let taskApiRestartTimer = null;

function startTaskApi() {
    if (TASK_API_DISABLED) return;
    if (!fs.existsSync(TASK_API_SCRIPT)) {
        console.error(`  [task-api] script not found: ${TASK_API_SCRIPT} (disable with --no-task-api)`);
        return;
    }
    taskApiChild = spawn('python3', [
        TASK_API_SCRIPT,
        '--port', String(TASK_API_PORT),
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
    taskApiChild.on('exit', (code, signal) => {
        console.error(`  [task-api] child exited code=${code} signal=${signal}`);
        taskApiChild = null;
        if (!shuttingDown) {
            // Backoff 1s, then retry. Prevents tight loops on broken scripts.
            taskApiRestartTimer = setTimeout(() => {
                console.error('  [task-api] restarting...');
                startTaskApi();
            }, 1000);
        }
    });
    taskApiChild.on('error', (err) => {
        console.error(`  [task-api] spawn error: ${err.message}`);
    });
}

function proxyTaskApi(req, res) {
    if (TASK_API_DISABLED || !taskApiChild) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'task-api sidecar not running' }));
        return;
    }
    const opts = {
        host:    '127.0.0.1',
        port:    TASK_API_PORT,
        path:    req.url,
        method:  req.method,
        headers: req.headers,
    };
    const proxyReq = http.request(opts, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'task-api proxy failed: ' + err.message }));
    });
    req.pipe(proxyReq);
}

function shutdownTaskApi(cb) {
    shuttingDown = true;
    if (taskApiRestartTimer) clearTimeout(taskApiRestartTimer);
    if (!taskApiChild) { if (cb) cb(); return; }
    const child = taskApiChild;
    try { child.kill('SIGTERM'); } catch (_) {}
    // Wait up to 2s for graceful exit, then SIGKILL + exit.
    const hardTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
        if (cb) cb();
    }, 2000);
    child.once('exit', () => { clearTimeout(hardTimer); if (cb) cb(); });
}
function gracefulExit(code) {
    shutdownTaskApi(() => process.exit(code));
}
process.on('SIGINT',  () => gracefulExit(0));
process.on('SIGTERM', () => gracefulExit(0));
// Last-resort synchronous kill (process.on('exit') can't await async work,
// but sending a signal is synchronous + cheap).
process.on('exit', () => { if (taskApiChild) { try { taskApiChild.kill('SIGKILL'); } catch (_) {} } });

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

    // Task API proxy: /api/* → Python sidecar. Must check BEFORE file resolution
    // so the /api/ namespace doesn't fall through to disk lookup.
    if (reqPath.startsWith(TASK_API_URL_PREFIX)) {
        return proxyTaskApi(req, res);
    }

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
    if (TASK_API_DISABLED) {
        console.log(`  task api      : disabled (--no-task-api)`);
    } else {
        console.log(`  task api      : 127.0.0.1:${TASK_API_PORT}  [script: ${TASK_API_SCRIPT}]`);
    }
    console.log('');
    console.log('  Ctrl+C to stop the server.');
    console.log('');
    startTaskApi();
});

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n  Port ${PORT} already in use — close the other instance or set --port / TOOLS_WEB_PORT.\n`);
    } else {
        console.error(err);
    }
    process.exit(1);
});
