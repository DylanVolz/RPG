import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════
//  DAYNIGHT.JS — Cycle jour/nuit + ciel vivant
//
//  24h in-game = 9600s réelles
//  dayTime : 0.0 = minuit  |  0.25 = aube  |  0.5 = midi  |  0.75 = crépuscule
// ═══════════════════════════════════════════════════════════════

const DAY_DURATION = 9600;

// ── Timeline ─────────────────────────────────────────────────
// sky    = couleur horizon du dôme
// skyZen = couleur zénith du dôme
const TIMELINE = [
    { t:0.00, sky:0x03050f, skyZen:0x01020a, fog:0x060810, ambCol:0x1a2040, sunCol:0x000000, sunInt:0.0,  ambInt:0.15 },
    { t:0.18, sky:0x060a18, skyZen:0x020510, fog:0x080c1a, ambCol:0x1a2040, sunCol:0x000000, sunInt:0.0,  ambInt:0.18 },
    { t:0.23, sky:0x1a0e22, skyZen:0x0a0818, fog:0x180c20, ambCol:0x2a1a38, sunCol:0x402810, sunInt:0.05, ambInt:0.25 },
    { t:0.27, sky:0x7a2a10, skyZen:0x2a1040, fog:0x6a2210, ambCol:0x5a3020, sunCol:0xe87030, sunInt:0.7,  ambInt:0.55 },
    { t:0.32, sky:0x7a8aaa, skyZen:0x3a5a8a, fog:0x8090b0, ambCol:0x9090a0, sunCol:0xf0c060, sunInt:1.1,  ambInt:0.80 },
    { t:0.42, sky:0x5a7ab8, skyZen:0x2a4a88, fog:0x6080c0, ambCol:0xa0a8c0, sunCol:0xfff0d0, sunInt:1.3,  ambInt:0.95 },
    { t:0.50, sky:0x4a70b8, skyZen:0x1a3880, fog:0x5078c0, ambCol:0xb0b8d0, sunCol:0xfffae8, sunInt:1.5,  ambInt:1.10 },
    { t:0.58, sky:0x4a70b8, skyZen:0x1a3880, fog:0x507ab8, ambCol:0xa8b0c8, sunCol:0xfff0c0, sunInt:1.3,  ambInt:1.00 },
    { t:0.68, sky:0x6a7898, skyZen:0x2a3868, fog:0x607088, ambCol:0x9090a8, sunCol:0xf0c860, sunInt:1.0,  ambInt:0.85 },
    { t:0.73, sky:0x8a3a12, skyZen:0x2a1040, fog:0x7a3010, ambCol:0x603020, sunCol:0xe06020, sunInt:0.65, ambInt:0.60 },
    { t:0.77, sky:0x28102e, skyZen:0x100818, fog:0x220e28, ambCol:0x2a1a30, sunCol:0x401828, sunInt:0.10, ambInt:0.30 },
    { t:0.82, sky:0x080a18, skyZen:0x020510, fog:0x060810, ambCol:0x141830, sunCol:0x000000, sunInt:0.0,  ambInt:0.18 },
    { t:1.00, sky:0x03050f, skyZen:0x01020a, fog:0x060810, ambCol:0x1a2040, sunCol:0x000000, sunInt:0.0,  ambInt:0.15 },
];

// Vecteurs réutilisables — aucune allocation dans les hot paths
const _skyCol = new THREE.Color();
const _skyZen = new THREE.Color();
const _fogCol = new THREE.Color();
const _ambCol = new THREE.Color();
const _sunCol = new THREE.Color();
const _colA   = new THREE.Color();
const _colB   = new THREE.Color();
const _white  = new THREE.Color(0xffffff);
const _tmpV   = new THREE.Vector3();
const _camDir = new THREE.Vector3();

function _sampleTimeline(t) {
    let i0 = 0;
    for (let i = 0; i < TIMELINE.length - 1; i++) {
        if (t >= TIMELINE[i].t && t <= TIMELINE[i + 1].t) { i0 = i; break; }
    }
    const a = TIMELINE[i0], b = TIMELINE[i0 + 1];
    const len = b.t - a.t;
    const f   = len > 0 ? (t - a.t) / len : 0;
    const sf  = f * f * (3 - 2 * f);   // smoothstep

    _skyCol.setHex(a.sky).lerp   (_colB.setHex(b.sky),    sf);
    _skyZen.setHex(a.skyZen).lerp(_colA.setHex(b.skyZen), sf);
    _fogCol.setHex(a.fog).lerp   (_colA.setHex(b.fog),    sf);
    _ambCol.setHex(a.ambCol).lerp(_colA.setHex(b.ambCol), sf);
    _sunCol.setHex(a.sunCol).lerp(_colA.setHex(b.sunCol), sf);

    return {
        skyCol: _skyCol, skyZen: _skyZen,
        fogCol: _fogCol, ambCol: _ambCol, sunCol: _sunCol,
        sunInt: a.sunInt + (b.sunInt - a.sunInt) * sf,
        ambInt: a.ambInt + (b.ambInt - a.ambInt) * sf,
    };
}

// ── Génération textures canvas ────────────────────────────────

function _makeCloudTex(type) {
    const S   = 256;
    const cv  = document.createElement('canvas');
    cv.width  = cv.height = S;
    const ctx = cv.getContext('2d');

    // Configurations de blobs par type de nuage
    const blobSets = [
        // 0 — Cumulus (gonflé, vertical)
        [ {x:128,y:125,r:82}, {x:75, y:152,r:62}, {x:180,y:148,r:68},
          {x:128,y:88, r:52}, {x:55, y:128,r:48}, {x:202,y:128,r:52}, {x:128,y:170,r:42} ],
        // 1 — Stratus (plat, large)
        [ {x:128,y:158,r:108}, {x:52, y:152,r:72}, {x:204,y:150,r:78},
          {x:22, y:146,r:52},  {x:234,y:146,r:58}, {x:128,y:142,r:52} ],
        // 2 — Cirrus (effilé, haut)
        [ {x:78, y:128,r:72}, {x:148,y:124,r:68}, {x:48, y:132,r:48},
          {x:202,y:126,r:62}, {x:118,y:130,r:44} ],
    ];

    for (const b of (blobSets[type] ?? blobSets[0])) {
        const g   = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        const top = b.y < 148;  // partie haute = plus brillante
        g.addColorStop(0,    top ? 'rgba(255,255,255,0.92)' : 'rgba(215,225,245,0.82)');
        g.addColorStop(0.38, top ? 'rgba(248,250,255,0.58)' : 'rgba(200,215,238,0.50)');
        g.addColorStop(0.72, 'rgba(220,228,245,0.18)');
        g.addColorStop(1.0,  'rgba(210,220,240,0.00)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
    }
    return new THREE.CanvasTexture(cv);
}

function _makeSunGlowTex() {
    const S   = 256;
    const cv  = document.createElement('canvas');
    cv.width  = cv.height = S;
    const ctx = cv.getContext('2d');
    const c   = S / 2;
    const g   = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0.00, 'rgba(255,255,230,1.00)');
    g.addColorStop(0.06, 'rgba(255,245,190,0.88)');
    g.addColorStop(0.18, 'rgba(255,210,120,0.52)');
    g.addColorStop(0.38, 'rgba(255,170, 60,0.20)');
    g.addColorStop(0.62, 'rgba(255,130, 20,0.07)');
    g.addColorStop(1.00, 'rgba(255,100,  0,0.00)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(cv);
}

function _makeMoonGlowTex() {
    const S   = 128;
    const cv  = document.createElement('canvas');
    cv.width  = cv.height = S;
    const ctx = cv.getContext('2d');
    const c   = S / 2;
    const g   = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0.00, 'rgba(220,235,255,0.80)');
    g.addColorStop(0.20, 'rgba(180,210,255,0.35)');
    g.addColorStop(0.55, 'rgba(140,180,240,0.10)');
    g.addColorStop(1.00, 'rgba(100,150,220,0.00)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(cv);
}

function _makeLensFlareTex() {
    const S   = 256;
    const cv  = document.createElement('canvas');
    cv.width  = cv.height = S;
    const ctx = cv.getContext('2d');
    const c   = S / 2;

    // 8 rayons (croix + diagonales)
    ctx.save();
    ctx.translate(c, c);
    for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate((i / 8) * Math.PI * 2);
        const isMain = i % 2 === 0;
        const len    = isMain ? c * 0.95 : c * 0.65;
        const g      = ctx.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0.00, 'rgba(255,255,220,0.92)');
        g.addColorStop(0.12, 'rgba(255,255,200,0.52)');
        g.addColorStop(0.45, 'rgba(255,240,180,0.18)');
        g.addColorStop(1.00, 'rgba(255,220,150,0.00)');
        ctx.strokeStyle = g;
        ctx.lineWidth   = isMain ? 2.8 : 1.4;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0);
        ctx.stroke();
        ctx.restore();
    }
    ctx.restore();

    // Halo central doux
    const gc = ctx.createRadialGradient(c, c, 0, c, c, c * 0.3);
    gc.addColorStop(0, 'rgba(255,255,255,0.88)');
    gc.addColorStop(1, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = gc;
    ctx.fillRect(0, 0, S, S);

    return new THREE.CanvasTexture(cv);
}

// ─────────────────────────────────────────────────────────────
//  CLASSE PRINCIPALE
// ─────────────────────────────────────────────────────────────
export class DayNightCycle {
    constructor(scene, renderer) {
        this.scene    = scene;
        this.renderer = renderer;

        this.dayTime  = 0.33;
        this._elapsed = this.dayTime * DAY_DURATION;

        // ── Fond sombre (fallback sous le dôme) ──────────────
        scene.background = new THREE.Color(0x010208);

        // ── Lumières ─────────────────────────────────────────
        this.ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        scene.add(this.ambientLight);

        this.sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
        this.sunLight.castShadow = false;
        scene.add(this.sunLight);

        this.fillLight = new THREE.DirectionalLight(0x8899cc, 0.25);
        this.fillLight.position.set(100, 200, -400);
        scene.add(this.fillLight);

        // ── Dôme céleste ──────────────────────────────────────
        this._skyDome = this._buildSkyDome();
        scene.add(this._skyDome);

        // ── Étoiles ───────────────────────────────────────────
        this._stars = this._buildStars();
        scene.add(this._stars);

        // ── Soleil & Lune ─────────────────────────────────────
        this._sunMesh  = this._buildSunMesh();
        this._moonMesh = this._buildMoonMesh();
        scene.add(this._sunMesh);
        scene.add(this._moonMesh);

        // ── Nuages ────────────────────────────────────────────
        this._cloudTextures = [ _makeCloudTex(0), _makeCloudTex(1), _makeCloudTex(2) ];
        this._clouds = this._buildClouds();
        this._clouds.forEach(c => scene.add(c));

        // ── Glow solaire ──────────────────────────────────────
        this._sunGlow = this._buildGlowSprite(_makeSunGlowTex(), 680, 680);
        scene.add(this._sunGlow);

        // ── Glow lunaire ──────────────────────────────────────
        this._moonGlow = this._buildGlowSprite(_makeMoonGlowTex(), 200, 200);
        scene.add(this._moonGlow);

        // ── Lens flare ────────────────────────────────────────
        this._lensFlare = this._buildLensFlare();
        scene.add(this._lensFlare);

        this._applyLighting(this.dayTime);
    }

    // ── Dôme céleste (gradient horizon → zénith) ─────────────
    _buildSkyDome() {
        const geo = new THREE.SphereGeometry(3800, 32, 16);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uHorizon: { value: new THREE.Color(0x4a70b8) },
                uZenith:  { value: new THREE.Color(0x1a3880) },
            },
            vertexShader: `
                varying vec3 vNorm;
                void main() {
                    vNorm = normalize((modelMatrix * vec4(position, 0.0)).xyz);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uHorizon;
                uniform vec3 uZenith;
                varying vec3 vNorm;
                void main() {
                    float h = clamp(vNorm.y, 0.0, 1.0);
                    float t = h * h * (3.0 - 2.0 * h);
                    gl_FragColor = vec4(mix(uHorizon, uZenith, t), 1.0);
                }
            `,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder   = -2;
        mesh.frustumCulled = false;
        return mesh;
    }

    // ── Étoiles (hémisphère supérieure seulement) ────────────
    _buildStars() {
        const N   = 2000;
        const pos = new Float32Array(N * 3);
        const R   = 3600;
        for (let i = 0; i < N; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(Math.random());   // hémisphère haute
            pos[i*3]   = R * Math.sin(phi) * Math.cos(theta);
            pos[i*3+1] = R * Math.cos(phi);
            pos[i*3+2] = R * Math.sin(phi) * Math.sin(theta);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
            color: 0xeeeeff, size: 3.5,
            sizeAttenuation: false, depthWrite: false, fog: false,
            transparent: true, opacity: 0,
        });
        const stars = new THREE.Points(geo, mat);
        stars.renderOrder = -1;
        return stars;
    }

    // ── Soleil ────────────────────────────────────────────────
    _buildSunMesh() {
        const geo = new THREE.SphereGeometry(55, 10, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0xfff8e0, fog: false });
        const m   = new THREE.Mesh(geo, mat);
        m.renderOrder = -1;
        return m;
    }

    // ── Lune ──────────────────────────────────────────────────
    _buildMoonMesh() {
        const geo = new THREE.SphereGeometry(30, 10, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0xd0d8e8, fog: false });
        const m   = new THREE.Mesh(geo, mat);
        m.renderOrder = -1;
        return m;
    }

    // ── Glow sprite générique ─────────────────────────────────
    _buildGlowSprite(tex, sw, sh) {
        const mat = new THREE.SpriteMaterial({
            map: tex, transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false, fog: false, opacity: 0,
        });
        const s = new THREE.Sprite(mat);
        s.scale.set(sw, sh, 1);
        s.renderOrder = 1;
        return s;
    }

    // ── Lens flare ────────────────────────────────────────────
    _buildLensFlare() {
        const mat = new THREE.SpriteMaterial({
            map: _makeLensFlareTex(), transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false, fog: false, opacity: 0,
        });
        const s = new THREE.Sprite(mat);
        s.scale.set(520, 520, 1);
        s.renderOrder = 2;
        return s;
    }

    // ── 42 nuages (3 types, vent global, wrap) ────────────────
    _buildClouds() {
        const clouds = [];
        for (let i = 0; i < 42; i++) {
            // 50% cumulus, 35% stratus, 15% cirrus
            const type = i < 21 ? 0 : i < 36 ? 1 : 2;
            const mat  = new THREE.SpriteMaterial({
                map: this._cloudTextures[type],
                transparent: true, opacity: 0,
                depthWrite: false, fog: false,
            });
            const s  = new THREE.Sprite(mat);
            s._ox    = (Math.random() - 0.5) * 2800;
            s._oz    = (Math.random() - 0.5) * 2800;
            s._alt   = (type === 2 ? 380 : 260) + Math.random() * 110;
            s._vx    = (Math.random() - 0.5) * 1.5;
            s._vz    = (Math.random() - 0.5) * 0.8;
            s._type  = type;

            const sw = type === 0 ? 380 + Math.random() * 280
                     : type === 1 ? 520 + Math.random() * 320
                     :              640 + Math.random() * 420;
            s.scale.set(sw, sw * (type === 0 ? 0.44 : type === 1 ? 0.24 : 0.14), 1);
            clouds.push(s);
        }
        return clouds;
    }

    // ── Offset sphérique soleil/lune ─────────────────────────
    // Retourne un vecteur RELATIF (à ajouter à la position caméra)
    _sunOffset(dayTime, radius) {
        const angle = dayTime * Math.PI * 2;
        return new THREE.Vector3(
            Math.sin(angle)  * radius * 0.8,
            -Math.cos(angle) * radius,
            -0.4 * radius,
        );
    }

    // ── Application de l'éclairage ────────────────────────────
    _applyLighting(t) {
        const s = _sampleTimeline(t);

        // Dôme
        this._skyDome.material.uniforms.uHorizon.value.copy(s.skyCol);
        this._skyDome.material.uniforms.uZenith.value.copy(s.skyZen);

        // Brouillard
        if (this.scene.fog) this.scene.fog.color.copy(s.fogCol);

        // Ambient
        this.ambientLight.color.copy(s.ambCol);
        this.ambientLight.intensity = s.ambInt;

        // Soleil
        this.sunLight.color.copy(s.sunCol);
        this.sunLight.intensity = s.sunInt;
        this.sunLight.position.copy(this._sunOffset(t, 2600));

        // Exposition dynamique
        const dayness = Math.max(0, Math.min(1, (s.ambInt - 0.15) / 0.95));
        this.renderer.toneMappingExposure = 1.6 + dayness * 1.0;

        // Étoiles
        const isNight = s.ambInt < 0.35;
        this._stars.material.opacity = isNight
            ? Math.min(1, (0.35 - s.ambInt) / 0.2) : 0;

        // Couleur soleil mesh
        const sunElev = -Math.cos(t * Math.PI * 2);
        if (sunElev > 0) this._sunMesh.material.color.copy(s.sunCol);

        // Nuages — couleur tintée par le soleil (lever/coucher = orange)
        const cloudOpacity = Math.max(0, Math.min(1, (s.ambInt - 0.25) / 0.38));
        _colA.copy(s.sunCol).lerp(_white, 0.72);
        for (const c of this._clouds) {
            c.material.opacity = cloudOpacity * (c._type === 2 ? 0.52 : 0.82);
            c.material.color.copy(_colA);
        }

        // Glow solaire de base
        const baseGlow = sunElev > 0 ? Math.min(1, sunElev * 2.5) * 0.78 : 0;
        this._sunGlow.material.opacity = baseGlow;

        // Glow lunaire
        const moonElev = Math.cos(t * Math.PI * 2);  // inverse du soleil
        const nightFactor = Math.max(0, Math.min(1, (0.35 - s.ambInt) / 0.2));
        this._moonGlow.material.opacity = moonElev > 0 ? nightFactor * 0.60 : 0;
    }

    // ── Update chaque frame ───────────────────────────────────
    update(delta, camera) {
        this._elapsed = (this._elapsed + delta) % DAY_DURATION;
        this.dayTime  = this._elapsed / DAY_DURATION;
        this._applyLighting(this.dayTime);

        const px = camera?.position.x ?? 0;
        const pz = camera?.position.z ?? 0;

        // ── Dôme + étoiles suivent la caméra ─────────────────
        if (camera) {
            this._skyDome.position.copy(camera.position);
            this._stars.position.copy(camera.position);
        }

        // ── Positions soleil / lune ───────────────────────────
        const sunOff  = this._sunOffset(this.dayTime, 2600);
        const moonOff = this._sunOffset((this.dayTime + 0.5) % 1, 2600);
        const sunElev = -Math.cos(this.dayTime * Math.PI * 2);

        this._sunMesh.position.set(px + sunOff.x,  camera ? camera.position.y + sunOff.y  : sunOff.y,  pz + sunOff.z);
        this._moonMesh.position.set(px + moonOff.x, camera ? camera.position.y + moonOff.y : moonOff.y, pz + moonOff.z);
        this._sunGlow.position.copy(this._sunMesh.position);
        this._moonGlow.position.copy(this._moonMesh.position);
        this._lensFlare.position.copy(this._sunMesh.position);

        this._sunMesh.visible  = sunElev > -0.05;
        this._moonMesh.visible = sunElev < 0.05;

        // ── Vent + dérive des nuages ──────────────────────────
        const WIND_X  =  3.5, WIND_Z = 1.2;
        const CLOUD_R = 1600;

        for (const c of this._clouds) {
            c._ox += (WIND_X + c._vx) * delta;
            c._oz += (WIND_Z + c._vz) * delta;
            // Wrap invisible (loin du joueur)
            if (c._ox >  CLOUD_R) c._ox -= CLOUD_R * 2;
            if (c._ox < -CLOUD_R) c._ox += CLOUD_R * 2;
            if (c._oz >  CLOUD_R) c._oz -= CLOUD_R * 2;
            if (c._oz < -CLOUD_R) c._oz += CLOUD_R * 2;
            c.position.set(px + c._ox, c._alt, pz + c._oz);
        }

        // ── Lens flare (regarde vers le soleil) ──────────────
        if (camera && this._sunMesh.visible) {
            _tmpV.copy(this._sunMesh.position).sub(camera.position).normalize();
            _camDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
            const dot = _camDir.dot(_tmpV);

            // Seuil : ~15° autour du soleil
            const lf  = dot > 0.93 ? ((dot - 0.93) / 0.07) ** 2 : 0;
            this._lensFlare.material.opacity = lf * 0.88;

            // Le glow augmente quand on fixe le soleil
            const baseGlow = sunElev > 0 ? Math.min(1, sunElev * 2.5) * 0.78 : 0;
            this._sunGlow.material.opacity = baseGlow + lf * 0.35;
        } else {
            this._lensFlare.material.opacity = 0;
        }
    }

    // ── Helpers heure ─────────────────────────────────────────
    getHour()   { return Math.floor(this.dayTime * 24); }
    getMinute() { return Math.floor((this.dayTime * 24 * 60) % 60); }
    getTimeString() {
        return `${this.getHour().toString().padStart(2,'0')}:${this.getMinute().toString().padStart(2,'0')}`;
    }
    setHour(hour) {
        this.dayTime  = (hour % 24) / 24;
        this._elapsed = this.dayTime * DAY_DURATION;
        this._applyLighting(this.dayTime);
    }
}
