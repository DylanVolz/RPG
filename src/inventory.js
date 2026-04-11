import * as THREE from 'three';

// ─────────────────────────────────────────────────────────
//  DONNÉES
// ─────────────────────────────────────────────────────────

const RARITY = {
    common:    { color:'#9a9a9a', border:'#3a3a3a', label:'Commun'     },
    uncommon:  { color:'#4caf50', border:'#2a7a2a', label:'Peu commun' },
    rare:      { color:'#5c9be0', border:'#2a50aa', label:'Rare'       },
    epic:      { color:'#c060e0', border:'#8030b0', label:'Épique'     },
    legendary: { color:'#e8a020', border:'#a06010', label:'Légendaire' },
};

const SLOT_DEFS = {
    head:   'Tête',
    neck:   'Cou',
    weapon: 'Arme',
    shield: 'Bouclier',
    ring_l: 'Anneau G.',
    feet:   'Bottes',
    chest:  'Armure',
    back:   'Cape',
    gloves: 'Gants',
    legs:   'Jambières',
    ring_r: 'Anneau D.',
    belt:   'Ceinture',
};

// ─────────────────────────────────────────────────────────
//  ICÔNES CANVAS (54×54)
// ─────────────────────────────────────────────────────────

function drawIcon(item) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 54;
    const c = cv.getContext('2d');
    const r = RARITY[item.rarity] || RARITY.common;

    c.fillStyle = '#080606';
    c.fillRect(0, 0, 54, 54);
    c.fillStyle = r.color + '14';
    c.fillRect(1, 1, 52, 52);
    c.strokeStyle = r.border;
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, 53, 53);

    c.strokeStyle = r.color;
    c.fillStyle   = r.color + '50';
    c.lineWidth   = 1.8;
    c.lineCap = 'round';
    c.lineJoin = 'round';

    const t = item.type;
    if (t === 'weapon') {
        c.beginPath(); c.moveTo(27,6); c.lineTo(27,42); c.stroke();
        c.beginPath(); c.moveTo(14,21); c.lineTo(40,21); c.stroke();
        c.beginPath(); c.moveTo(27,42); c.lineTo(23,49); c.moveTo(27,42); c.lineTo(31,49); c.stroke();
        c.beginPath(); c.arc(27,6,2,0,Math.PI*2); c.fill();
    } else if (t === 'shield') {
        c.beginPath();
        c.moveTo(27,7); c.lineTo(43,16); c.lineTo(43,30); c.lineTo(27,46); c.lineTo(11,30); c.lineTo(11,16);
        c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(27,12); c.lineTo(27,41); c.moveTo(17,22); c.lineTo(37,22); c.stroke();
    } else if (t === 'head') {
        c.beginPath(); c.arc(27,24,14,Math.PI,0); c.lineTo(41,37); c.lineTo(13,37); c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(18,30); c.lineTo(36,30); c.stroke();
        c.fillStyle = '#080606'; c.fillRect(20,30,14,7);
        c.strokeStyle = r.color; c.strokeRect(20,30,14,7);
    } else if (t === 'chest') {
        c.fillRect(12,11,30,32); c.strokeRect(12,11,30,32);
        c.fillStyle = '#080606';
        c.fillRect(14,13,26,10); c.fillRect(14,25,26,16);
        c.strokeStyle = r.color;
        c.strokeRect(14,13,26,10); c.strokeRect(14,25,26,16);
        c.beginPath(); c.moveTo(27,11); c.lineTo(27,43); c.stroke();
    } else if (t === 'legs') {
        c.fillRect(13,9,12,26); c.strokeRect(13,9,12,26);
        c.fillRect(29,9,12,26); c.strokeRect(29,9,12,26);
        c.beginPath(); c.moveTo(13,9); c.lineTo(41,9); c.stroke();
        c.beginPath(); c.moveTo(13,35); c.lineTo(25,35); c.moveTo(29,35); c.lineTo(41,35); c.stroke();
    } else if (t === 'gloves') {
        c.fillRect(13,23,28,20); c.strokeRect(13,23,28,20);
        for (let i = 0; i < 4; i++) { c.fillRect(14+i*7,12,6,13); c.strokeRect(14+i*7,12,6,13); }
    } else if (t === 'feet') {
        c.beginPath();
        c.moveTo(10,20); c.lineTo(10,39); c.lineTo(38,39); c.lineTo(44,33); c.lineTo(44,25); c.lineTo(30,20);
        c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(10,29); c.lineTo(44,29); c.stroke();
    } else if (t === 'belt') {
        c.fillRect(7,21,40,12); c.strokeRect(7,21,40,12);
        c.fillStyle = '#080606'; c.fillRect(24,19,6,16); c.strokeStyle = r.color; c.strokeRect(24,19,6,16);
        c.beginPath(); c.arc(27,27,2,0,Math.PI*2); c.fill();
    } else if (t === 'neck') {
        c.beginPath(); c.arc(27,19,11,0.4,Math.PI-0.4); c.stroke();
        c.beginPath(); c.arc(27,37,6,0,Math.PI*2); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(18,25); c.lineTo(17,31); c.moveTo(36,25); c.lineTo(37,31); c.stroke();
    } else if (t === 'ring') {
        c.lineWidth = 3.5;
        c.beginPath(); c.arc(27,31,12,0,Math.PI*2); c.stroke();
        c.lineWidth = 1.8;
        c.fillStyle = r.color; c.beginPath(); c.arc(27,17,5,0,Math.PI*2); c.fill();
        c.strokeStyle = r.border; c.stroke();
    } else if (t === 'back') {
        c.beginPath();
        c.moveTo(19,7); c.quadraticCurveTo(40,7,37,46); c.lineTo(17,46); c.quadraticCurveTo(14,7,19,7);
        c.fill(); c.stroke();
        c.fillStyle = '#080606'; c.fillRect(21,9,12,8);
    } else if (t === 'consumable') {
        c.fillStyle = '#0a200f';
        c.beginPath();
        c.moveTo(22,19); c.bezierCurveTo(11,26,10,38,18,43); c.lineTo(36,43);
        c.bezierCurveTo(44,38,43,26,32,19); c.closePath();
        c.fill();
        c.strokeStyle = '#3aaa5a'; c.stroke();
        c.strokeStyle = r.color; c.strokeRect(22,10,10,11);
        c.beginPath(); c.moveTo(25,10); c.lineTo(29,10); c.stroke();
        c.fillStyle = '#1a6030';
        c.beginPath(); c.ellipse(27,34,6,9,0,0,Math.PI*2); c.fill();
    } else {
        c.beginPath();
        c.moveTo(27,8); c.lineTo(46,27); c.lineTo(27,46); c.lineTo(8,27);
        c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(27,16); c.lineTo(38,27); c.lineTo(27,38); c.lineTo(16,27); c.closePath(); c.stroke();
    }

    return cv;
}

// ─────────────────────────────────────────────────────────
//  ITEMS DE DÉPART
// ─────────────────────────────────────────────────────────

function makeStarting() {
    const eq = [
        { id:'exile_blade',    name:"Lame d'exilé",        type:'weapon',     slot:'weapon',  rarity:'common',
          stats:{'Dégâts':'4–8','Vitesse':'Normal'},          desc:"Une épée oubliée. Elle a tué avant toi." },
        { id:'leather_chest',  name:'Cuirasse de cuir',     type:'chest',      slot:'chest',   rarity:'common',
          stats:{'Armure':'12','Poids':'Léger'},               desc:"Tannée à la sueur et au sel." },
        { id:'iron_helm',      name:'Heaume de fer',        type:'head',       slot:'head',    rarity:'uncommon',
          stats:{'Armure':'8','Résistance Froid':'+5%'},       desc:"Porte une marque qu'on ne reconnaît plus." },
        { id:'travel_boots',   name:'Bottes de voyage',     type:'feet',       slot:'feet',    rarity:'common',
          stats:{'Armure':'4','Endurance':'+2'},                desc:"Usées par mille lieues." },
        { id:'worn_belt',      name:'Ceinture de soldat',   type:'belt',       slot:'belt',    rarity:'common',
          stats:{'Poche':'+4 rapide'},                          desc:"Cuir tressé, boucle brisée." },
    ];
    const bag = [
        { id:'health_vial', name:'Fiole de sève noire', type:'consumable', slot:null, rarity:'common',   qty:3,
          stats:{'Soin':'+8 Endurance'},  desc:"Amère. Efficace." },
        { id:'eitr_shard',  name:"Éclat d'Eitr",        type:'misc',       slot:null, rarity:'rare',     qty:1,
          stats:{'Magie':'+2'},            desc:'"Il ne devrait pas exister."' },
        { id:'bone_ring',   name:"Anneau d'os",          type:'ring',       slot:'ring_l', rarity:'uncommon', qty:1,
          stats:{'Habileté':'+1','Magie':'+1'}, desc:"Taillé dans quelque chose qu'on ne taille pas." },
        { id:'old_dagger',  name:'Dague rouillée',       type:'weapon',     slot:'shield', rarity:'common',  qty:1,
          stats:{'Dégâts':'1–4','Parade':'+3'}, desc:"Une lame courte. Assez pour une gorge." },
    ];
    return { eq, bag };
}

// ─────────────────────────────────────────────────────────
//  SYSTÈME D'INVENTAIRE
// ─────────────────────────────────────────────────────────

export class InventorySystem {
    constructor(playerRef) {
        this.player   = playerRef;
        this.equipped = Object.fromEntries(Object.keys(SLOT_DEFS).map(k => [k, null]));
        this.bag      = new Array(24).fill(null);
        this.quick    = new Array(4).fill(null);
        this.isOpen   = false;

        this._drag          = null;
        this._previewAngle  = 0;
        this._previewRen    = null;
        this._previewScene  = null;
        this._previewCam    = null;
        this._charMesh      = null;
        this._eitrGlow      = null;

        this._buildDOM();
        this._init3D();
        this._populate();
        this._refreshStats();
    }

    // ─── DOM ────────────────────────────────────────────────
    _buildDOM() {
        this._root = document.createElement('div');
        this._root.id = 'inventory';

        this._root.innerHTML = `
<div class="inv-panel">

  <!-- ── En-tête ── -->
  <div class="inv-header">
    <div class="inv-title-wrap">
      <span class="inv-title">Inventaire</span>
      <span class="inv-title-sub">— Guerrier Exilé —</span>
    </div>
    <button class="inv-close-btn" id="inv-close-btn">✕ Fermer</button>
  </div>

  <!-- ── Corps : 3 colonnes ── -->
  <div class="inv-body">

    <!-- COLONNE GAUCHE : Skills + Sac -->
    <div class="inv-col-left">

      <div class="inv-sec-hdr">Compétences</div>
      <div class="inv-skills-grid">
        <div class="inv-skill-slot"><span class="skill-ico">⚔</span></div>
        <div class="inv-skill-slot"><span class="skill-ico">🛡</span></div>
        <div class="inv-skill-slot"><span class="skill-ico">🏃</span></div>
        <div class="inv-skill-slot"><span class="skill-ico">✦</span></div>
        <div class="inv-skill-slot"><span class="skill-ico">🗡</span></div>
        <div class="inv-skill-slot"><span class="skill-ico">⚡</span></div>
        <div class="inv-skill-slot"><span class="skill-ico">🔮</span></div>
        <div class="inv-skill-slot"><span class="skill-ico">♦</span></div>
      </div>

      <div class="inv-hr"></div>

      <div class="inv-sec-hdr">Sac à dos</div>
      <div class="inv-bag-wrap">
        <div class="inv-bag-grid" id="inv-bag"></div>
      </div>

    </div>

    <!-- COLONNE CENTRE : Paperdoll -->
    <div class="inv-col-center">

      <div class="inv-sec-hdr" style="width:100%">Équipement</div>

      <div class="inv-paperdoll">

        <!-- Canvas 3D personnage (en dessous des slots) -->
        <canvas id="inv-3d" width="150" height="290"></canvas>

        <!-- Slots absolus autour du personnage (au-dessus du canvas) -->
        <div class="inv-slot inv-eq-slot" data-slot="head"><span class="slot-lbl">Tête</span></div>
        <div class="inv-slot inv-eq-slot" data-slot="neck"><span class="slot-lbl">Cou</span></div>
        <div class="inv-slot inv-eq-slot" data-slot="chest"><span class="slot-lbl">Armure</span></div>
        <div class="inv-slot inv-eq-slot" data-slot="weapon"><span class="slot-lbl">Arme</span></div>
        <div class="inv-slot inv-eq-slot" data-slot="back"><span class="slot-lbl">Cape</span></div>
        <div class="inv-slot inv-eq-slot" data-slot="shield"><span class="slot-lbl">Bouclier</span></div>
        <div class="inv-slot inv-eq-slot" data-slot="gloves"><span class="slot-lbl">Gants</span></div>
        <div class="inv-slot inv-eq-slot" data-slot="ring_l"><span class="slot-lbl">Ann. G.</span></div>
        <div class="inv-slot inv-eq-slot" data-slot="legs"><span class="slot-lbl">Jambes</span></div>
        <div class="inv-slot inv-eq-slot" data-slot="ring_r"><span class="slot-lbl">Ann. D.</span></div>
        <div class="inv-slot inv-eq-slot" data-slot="feet"><span class="slot-lbl">Bottes</span></div>
        <div class="inv-slot inv-eq-slot" data-slot="belt"><span class="slot-lbl">Ceinture</span></div>

      </div>

      <div class="inv-char-name" id="inv-char-name">— Guerrier —</div>

    </div>

    <!-- COLONNE DROITE : Infos + Stats -->
    <div class="inv-col-right">

      <div class="inv-sec-hdr">Personnage</div>
      <div class="inv-char-info">
        <div class="inv-char-bigname">Exilé</div>
        <div class="inv-char-class">Niveau 1 · Guerrier</div>
      </div>

      <div class="inv-sec-hdr">Caractéristiques</div>
      <div class="inv-stats-list" id="inv-stats-bar"></div>

    </div>

  </div>

  <!-- ── Pied : ceinture rapide ── -->
  <div class="inv-footer">
    <div class="inv-sec-hdr" style="flex-shrink:0;padding:0 10px 0 0;border:none;background:none">
      Ceinture rapide
    </div>
    <div class="inv-quick-row" id="inv-quick"></div>
    <div class="inv-quick-hint">Touches 1 – 4</div>
  </div>

</div>

<div class="inv-tooltip" id="inv-tooltip"></div>
<div class="inv-ghost" id="inv-ghost"></div>
`;
        document.body.appendChild(this._root);

        // Bag grid 6×4
        const bagGrid = document.getElementById('inv-bag');
        for (let i = 0; i < 24; i++) {
            const s = document.createElement('div');
            s.className = 'inv-slot inv-bag-slot';
            s.dataset.bagIdx = i;
            bagGrid.appendChild(s);
        }

        // Quick belt 4 slots
        const quickRow = document.getElementById('inv-quick');
        for (let i = 0; i < 4; i++) {
            const s = document.createElement('div');
            s.className = 'inv-slot inv-quick-slot';
            s.dataset.quickIdx = i;
            const badge = document.createElement('span');
            badge.className = 'inv-quick-badge';
            badge.textContent = i + 1;
            s.appendChild(badge);
            quickRow.appendChild(s);
        }

        document.getElementById('inv-close-btn').addEventListener('click', () => this.close());
        this._tooltip = document.getElementById('inv-tooltip');
        this._ghost   = document.getElementById('inv-ghost');

        this._bindInteraction();
    }

    // ─── 3D Preview ─────────────────────────────────────────
    _init3D() {
        const canvas = document.getElementById('inv-3d');

        this._previewRen = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true });
        this._previewRen.setSize(150, 290);
        this._previewRen.setClearColor(0x000000, 0);
        this._previewRen.toneMapping         = THREE.ACESFilmicToneMapping;
        this._previewRen.toneMappingExposure = 2.0;

        this._previewScene = new THREE.Scene();

        this._previewCam = new THREE.PerspectiveCamera(40, 150/290, 0.1, 50);
        this._previewCam.position.set(0, 1.1, 3.4);
        this._previewCam.lookAt(0, 0.9, 0);

        this._previewScene.add(new THREE.AmbientLight(0x201808, 3));
        const key = new THREE.DirectionalLight(0xc8a882, 4);
        key.position.set(2, 5, 3);
        this._previewScene.add(key);
        const fill = new THREE.DirectionalLight(0x0a1828, 1.5);
        fill.position.set(-3, 2, -2);
        this._previewScene.add(fill);
        const rim = new THREE.PointLight(0x00cc44, 1.2, 8);
        rim.position.set(0, 0.5, -2);
        this._previewScene.add(rim);
        this._eitrGlow = rim;

        this._charMesh = this._buildCharMesh();
        this._previewScene.add(this._charMesh);

        // Sol
        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(1.4, 40),
            new THREE.MeshStandardMaterial({ color:0x060404, roughness:0.9, metalness:0.3,
                transparent:true, opacity:0.7 })
        );
        floor.rotation.x = -Math.PI / 2;
        this._previewScene.add(floor);

        // Lueur verte sous les pieds
        const footGlow = new THREE.PointLight(0x00ff66, 0.5, 4);
        footGlow.position.set(0, 0.1, 0);
        this._previewScene.add(footGlow);
    }

    _buildCharMesh() {
        // Joueur — armure de cuir médiévale organique, haute poly
        // Canvas 150×290, caméra z=3.4, lookAt y=0.9
        // tick() fixe isTorso à y=0.97 et isHead à y=1.67
        const g   = new THREE.Group();
        const PI  = Math.PI;
        const S   = 10;

        const skin    = new THREE.MeshStandardMaterial({ color: 0x2a1e14, roughness: 0.90 });
        const leather = new THREE.MeshStandardMaterial({ color: 0x1a1208, roughness: 0.92 });
        const metal   = new THREE.MeshStandardMaterial({ color: 0x1e1a12, roughness: 0.70,
                             metalness: 0.45, emissive: 0x050402, emissiveIntensity: 0.25 });
        const dark    = new THREE.MeshStandardMaterial({ color: 0x0e0b08, roughness: 0.95 });

        const addCyl = (mat, x, y, z, rT, rB, h, seg = S, rx = 0, rz = 0) => {
            const m = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, seg), mat);
            m.position.set(x, y, z);
            m.rotation.x = rx; m.rotation.z = rz;
            g.add(m); return m;
        };
        const addSph = (mat, x, y, z, r, seg = 8) => {
            const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat);
            m.position.set(x, y, z);
            g.add(m); return m;
        };
        const addBox = (mat, x, y, z, w, h, d, rx = 0, rz = 0) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            m.position.set(x, y, z);
            m.rotation.x = rx; m.rotation.z = rz;
            g.add(m); return m;
        };

        // ── Pieds (bottes de cuir allongées) ──────────────────
        addBox(dark, -0.112, 0.046,  0.04,  0.130, 0.075, 0.26);
        addBox(dark,  0.112, 0.046,  0.04,  0.130, 0.075, 0.26);
        addBox(dark, -0.112, 0.038,  0.120, 0.110, 0.055, 0.09);  // orteils
        addBox(dark,  0.112, 0.038,  0.120, 0.110, 0.055, 0.09);

        // ── Sphères de cheville ────────────────────────────────
        addSph(leather, -0.115, 0.132, 0, 0.054);
        addSph(leather,  0.115, 0.132, 0, 0.054);

        // ── Tibias (jambières) — centre y=0.305, h=0.34
        //    bas à 0.135, haut à 0.475
        addCyl(leather, -0.115, 0.305, 0, 0.063, 0.080, 0.34, S).userData.isLeg = true;
        addCyl(leather,  0.115, 0.305, 0, 0.063, 0.080, 0.34, S).userData.isLeg = true;

        // ── Sphères de genou (métal) ───────────────────────────
        addSph(metal, -0.115, 0.475, 0, 0.074);
        addSph(metal,  0.115, 0.475, 0, 0.074);

        // ── Cuisses — centre y=0.635, h=0.32
        //    bas à 0.475, haut à 0.795
        addCyl(leather, -0.120, 0.635, 0, 0.085, 0.075, 0.32, S).userData.isLeg = true;
        addCyl(leather,  0.120, 0.635, 0, 0.085, 0.075, 0.32, S).userData.isLeg = true;

        // ── Sphères de hanche ──────────────────────────────────
        addSph(leather, -0.120, 0.795, 0, 0.090);
        addSph(leather,  0.120, 0.795, 0, 0.090);

        // ── Jupe/Pelvis (cotte de mailles évasée) ─────────────
        addCyl(leather, 0, 0.790, 0, 0.172, 0.252, 0.29, 8);

        // ── Torse bas (cuirasse principale — isTorso) ──────────
        //    centre y=0.97, h=0.36, bas à 0.79, haut à 1.15
        const torso = addCyl(leather, 0, 0.970, 0, 0.186, 0.178, 0.36, S);
        torso.userData.isTorso = true;
        torso.userData.baseY   = 0.97;

        // ── Torse haut / poitrine ──────────────────────────────
        //    centre y=1.185, h=0.27, bas à 1.05, haut à 1.32
        addCyl(leather, 0, 1.185, 0, 0.200, 0.187, 0.27, S);

        // Détails métalliques plastron
        addBox(metal, 0, 1.105, 0.197,  0.340, 0.088, 0.04);
        addBox(metal, 0, 0.970, 0.187,  0.300, 0.088, 0.04);

        // ── Sphères d'épaule — chevauchent le torse ET le bras ──
        // Torse radius ≈ 0.194 au niveau y=1.185 ; bras à x=±0.265
        // Sphère centrée entre les deux pour les souder visuellement
        addSph(leather, -0.245, 1.195, 0, 0.092);
        addSph(leather,  0.245, 1.195, 0, 0.092);

        // ── Pauldrons (demi-sphère métallique par-dessus) ─────
        const pGeo = new THREE.SphereGeometry(0.100, S, 7, 0, PI * 2, 0, PI * 0.65);
        const pL   = new THREE.Mesh(pGeo, metal);
        pL.position.set(-0.248, 1.235, 0); pL.rotation.z =  PI / 2; g.add(pL);
        const pR   = new THREE.Mesh(pGeo, metal);
        pR.position.set( 0.248, 1.235, 0); pR.rotation.z = -PI / 2; g.add(pR);

        // ── Bras hauts — rapprochés du corps (x=±0.265)
        //    torse edge ≈ 0.194, bras edge intérieure ≈ 0.207 → gap quasi nul
        addCyl(leather, -0.265, 1.055, 0, 0.058, 0.068, 0.28, S, 0,  0.06).userData.isLeg = true;
        addCyl(leather,  0.265, 1.055, 0, 0.058, 0.068, 0.28, S, 0, -0.06).userData.isLeg = true;

        // ── Sphères de coude (métal) ───────────────────────────
        addSph(metal, -0.273, 0.910, 0, 0.062);
        addSph(metal,  0.273, 0.910, 0, 0.062);

        // ── Avant-bras — centre y=0.788, h=0.24
        //    haut à 0.910, bas à 0.670
        addCyl(leather, -0.270, 0.788, 0, 0.046, 0.057, 0.24, S, 0,  0.04);
        addCyl(leather,  0.270, 0.788, 0, 0.046, 0.057, 0.24, S, 0, -0.04);

        // ── Sphères de poignet ─────────────────────────────────
        addSph(skin, -0.275, 0.662, 0, 0.050);
        addSph(skin,  0.275, 0.662, 0, 0.050);

        // ── Mains ─────────────────────────────────────────────
        addSph(skin, -0.275, 0.608, 0, 0.055, S);
        addSph(skin,  0.275, 0.608, 0, 0.055, S);

        // ── Cou ───────────────────────────────────────────────
        addCyl(skin, 0, 1.357, 0, 0.063, 0.073, 0.13, S);

        // ── Tête ──────────────────────────────────────────────
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.172, S, 8), skin);
        head.position.set(0, 1.67, 0);
        head.userData.isHead = true;
        g.add(head);

        // ── Heaume (dôme partiel) ─────────────────────────────
        const helm = new THREE.Mesh(
            new THREE.SphereGeometry(0.190, S, 7, 0, PI * 2, 0, PI * 0.52), dark);
        helm.position.set(0, 1.67, 0); g.add(helm);

        // Cerclage métallique du heaume
        addCyl(metal, 0, 1.590, 0, 0.193, 0.193, 0.026, S);

        // Nasal du heaume
        addBox(dark, 0, 1.648, 0.187,  0.028, 0.12, 0.028);

        return g;
    }

    // ─── Items de départ ────────────────────────────────────
    _populate() {
        const { eq, bag } = makeStarting();
        eq.forEach(item => {
            this.equipped[item.slot] = item;
            this._renderEqSlot(item.slot);
        });
        bag.forEach((item, i) => {
            this.bag[i] = item;
            this._renderBagSlot(i);
        });
    }

    // ─── Rendu slots ────────────────────────────────────────
    _renderEqSlot(slotName) {
        const el = this._root.querySelector(`.inv-eq-slot[data-slot="${slotName}"]`);
        if (!el) return;
        const item = this.equipped[slotName];
        el.innerHTML = item ? '' : `<span class="slot-lbl">${SLOT_DEFS[slotName]}</span>`;
        if (item) el.appendChild(drawIcon(item));
    }

    _renderBagSlot(idx) {
        const el = this._root.querySelector(`.inv-bag-slot[data-bag-idx="${idx}"]`);
        if (!el) return;
        const item = this.bag[idx];
        el.innerHTML = '';
        if (item) {
            el.appendChild(drawIcon(item));
            if (item.qty > 1) {
                const q = document.createElement('span');
                q.className = 'inv-qty'; q.textContent = item.qty;
                el.appendChild(q);
            }
        }
    }

    _renderQuickSlot(idx) {
        const el = this._root.querySelector(`.inv-quick-slot[data-quick-idx="${idx}"]`);
        if (!el) return;
        const badge = el.querySelector('.inv-quick-badge');
        const item = this.quick[idx];
        el.innerHTML = '';
        if (badge) el.appendChild(badge);
        if (item) {
            const cv = drawIcon(item);
            cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
            el.appendChild(cv);
        }
    }

    // ─── Stats ──────────────────────────────────────────────
    _refreshStats() {
        const bar = document.getElementById('inv-stats-bar');
        if (!bar) return;
        let armor = 0, dmg = '4–8';
        Object.values(this.equipped).forEach(item => {
            if (!item) return;
            if (item.stats?.Armure) armor += parseInt(item.stats.Armure) || 0;
            if (item.stats?.Dégâts) dmg = item.stats.Dégâts;
        });
        const p = this.player;
        const row = (label, val) =>
            `<div class="inv-stat-row"><span>${label}</span><b>${val}</b></div>`;
        bar.innerHTML =
            row('Vie',       `${Math.round(p.hp)} / ${p.maxHp}`) +
            row('Endurance', `${Math.round(p.stamina)} / ${p.maxStamina}`) +
            row('Armure',    armor) +
            row('Dégâts',   dmg);
    }

    // ─── Drag & Drop + Tooltip ──────────────────────────────
    _bindInteraction() {
        const root = this._root;

        root.addEventListener('mousedown', e => {
            const el = e.target.closest('[data-slot],[data-bag-idx],[data-quick-idx]');
            if (!el) return;
            const { item, src } = this._itemAt(el);
            if (!item) return;
            e.preventDefault();

            this._drag = { item, src };
            el.classList.add('inv-dragging');

            this._ghost.innerHTML = '';
            this._ghost.appendChild(drawIcon(item));
            this._ghost.style.cssText = `display:block;left:${e.clientX-27}px;top:${e.clientY-27}px`;
        });

        document.addEventListener('mousemove', e => {
            if (!this._drag) return;
            this._ghost.style.left = (e.clientX - 27) + 'px';
            this._ghost.style.top  = (e.clientY - 27) + 'px';
            this._tooltip.style.display = 'none';
        });

        document.addEventListener('mouseup', e => {
            if (!this._drag) return;
            const target = e.target.closest('[data-slot],[data-bag-idx],[data-quick-idx]');
            if (target) this._drop(this._drag.item, this._drag.src, target);
            this._drag = null;
            this._ghost.style.display = 'none';
            root.querySelectorAll('.inv-dragging').forEach(el => el.classList.remove('inv-dragging'));
        });

        // Tooltip
        root.addEventListener('mouseover', e => {
            if (this._drag) return;
            const el = e.target.closest('[data-slot],[data-bag-idx],[data-quick-idx]');
            if (!el) { this._tooltip.style.display = 'none'; return; }
            const { item } = this._itemAt(el);
            if (item) this._showTip(item, e);
            else this._tooltip.style.display = 'none';
        });

        root.addEventListener('mousemove', e => {
            if (this._tooltip.style.display !== 'none') this._moveTip(e);
        });

        root.addEventListener('mouseout', e => {
            if (!e.relatedTarget?.closest?.('#inventory')) {
                this._tooltip.style.display = 'none';
            }
        });

        // Double-clic : équiper depuis sac / déséquiper vers sac
        root.addEventListener('dblclick', e => {
            const el = e.target.closest('[data-slot],[data-bag-idx],[data-quick-idx]');
            if (!el) return;
            const { item, src } = this._itemAt(el);
            if (!item) return;
            if (src.type === 'bag' || src.type === 'quick') {
                this._autoEquip(item, src);
            } else if (src.type === 'equip') {
                this._autoUnequip(item, src.slot);
            }
        });
    }

    _itemAt(el) {
        if (el.dataset.slot !== undefined) {
            const slot = el.dataset.slot;
            return { item: this.equipped[slot] || null, src: { type:'equip', slot } };
        }
        if (el.dataset.bagIdx !== undefined) {
            const i = +el.dataset.bagIdx;
            return { item: this.bag[i] || null, src: { type:'bag', index:i } };
        }
        if (el.dataset.quickIdx !== undefined) {
            const i = +el.dataset.quickIdx;
            return { item: this.quick[i] || null, src: { type:'quick', index:i } };
        }
        return { item: null, src: null };
    }

    _drop(item, src, targetEl) {
        let dst;
        if (targetEl.dataset.slot !== undefined)     dst = { type:'equip', slot: targetEl.dataset.slot };
        else if (targetEl.dataset.bagIdx !== undefined)  dst = { type:'bag',   index: +targetEl.dataset.bagIdx };
        else if (targetEl.dataset.quickIdx !== undefined) dst = { type:'quick', index: +targetEl.dataset.quickIdx };
        else return;

        // Même destination que source → rien
        if (src.type === dst.type && (src.slot === dst.slot || src.index === dst.index)) return;

        // Vérification compatibilité équipement
        if (dst.type === 'equip') {
            const s = dst.slot;
            const ringSlot = s === 'ring_l' || s === 'ring_r';
            const ok = (item.type === s) || (ringSlot && item.type === 'ring') || (item.slot === s);
            if (!ok) { this._flashBad(targetEl); return; }
        }

        // Récupère l'existant dans la destination
        const existing = this._getAt(dst);

        // Retire l'item de la source
        this._setAt(src, null);

        // Place l'item dans la destination
        this._setAt(dst, item);

        // Remet l'existant dans la source (swap)
        if (existing) this._setAt(src, existing);

        this._rerenderAt(src);
        this._rerenderAt(dst);
        this._refreshStats();
    }

    _getAt(loc) {
        if (loc.type === 'equip') return this.equipped[loc.slot];
        if (loc.type === 'bag')   return this.bag[loc.index];
        if (loc.type === 'quick') return this.quick[loc.index];
    }

    _setAt(loc, item) {
        if (loc.type === 'equip') this.equipped[loc.slot]   = item;
        if (loc.type === 'bag')   this.bag[loc.index]       = item;
        if (loc.type === 'quick') this.quick[loc.index]     = item;
    }

    _rerenderAt(loc) {
        if (loc.type === 'equip') this._renderEqSlot(loc.slot);
        if (loc.type === 'bag')   this._renderBagSlot(loc.index);
        if (loc.type === 'quick') this._renderQuickSlot(loc.index);
    }

    _autoEquip(item, src) {
        // Trouve le bon slot
        let slot = item.slot;
        if (item.type === 'ring') slot = !this.equipped.ring_l ? 'ring_l' : 'ring_r';
        if (!slot || !SLOT_DEFS[slot]) return;
        const existing = this.equipped[slot];
        this._setAt(src, existing);
        this.equipped[slot] = item;
        this._rerenderAt(src);
        this._renderEqSlot(slot);
        this._refreshStats();
    }

    _autoUnequip(item, slot) {
        const freeIdx = this.bag.findIndex(s => s === null);
        if (freeIdx === -1) return; // sac plein
        this.equipped[slot] = null;
        this.bag[freeIdx] = item;
        this._renderEqSlot(slot);
        this._renderBagSlot(freeIdx);
        this._refreshStats();
    }

    _flashBad(el) {
        el.style.boxShadow = 'inset 0 0 0 2px #aa2020';
        setTimeout(() => { el.style.boxShadow = ''; }, 350);
    }

    // ─── Tooltip ────────────────────────────────────────────
    _showTip(item, e) {
        const r = RARITY[item.rarity] || RARITY.common;
        const statsHtml = Object.entries(item.stats || {})
            .map(([k,v]) => `<div class="tt-row"><span>${k}</span><b>${v}</b></div>`)
            .join('');
        this._tooltip.innerHTML =
            `<div class="tt-name" style="color:${r.color}">${item.name}</div>` +
            `<div class="tt-rar" style="color:${r.color}88">${r.label}${(item.qty||1)>1?' ×'+item.qty:''}</div>` +
            statsHtml +
            (item.desc ? `<div class="tt-desc">${item.desc}</div>` : '');
        this._tooltip.style.display = 'block';
        this._moveTip(e);
    }

    _moveTip(e) {
        const tt = this._tooltip;
        let x = e.clientX + 14, y = e.clientY + 14;
        if (x + 230 > window.innerWidth)  x = e.clientX - 240;
        if (y + tt.offsetHeight > window.innerHeight) y = e.clientY - tt.offsetHeight - 10;
        tt.style.left = x + 'px'; tt.style.top = y + 'px';
    }

    // ─── Helper HUD : retourne un canvas icône pour le slot ceinture i ──
    _renderQuickIconForHUD(i) {
        const item = this.quick[i];
        if (!item) return null;
        return drawIcon(item);
    }

    // ─── Open / Close ────────────────────────────────────────
    open() {
        this.isOpen = true;
        this._root.classList.add('visible');
        this._refreshStats();
    }

    close() {
        this.isOpen = false;
        this._root.classList.remove('visible');
        this._tooltip.style.display = 'none';
    }

    // ─── Tick (animation 3D) ────────────────────────────────
    tick(delta) {
        if (!this.isOpen || !this._previewRen) return;

        this._previewAngle += delta * 0.55;

        if (this._charMesh) {
            this._charMesh.rotation.y = this._previewAngle;
            const t = Date.now() * 0.001;
            // Respiration
            this._charMesh.children.forEach(c => {
                if (c.userData.isTorso) c.position.y = 0.97 + Math.sin(t * 0.9) * 0.008;
                if (c.userData.isHead)  c.position.y = 1.67 + Math.sin(t * 0.9) * 0.008;
            });
        }

        if (this._eitrGlow) {
            this._eitrGlow.intensity = 1.0 + Math.sin(Date.now() * 0.002) * 0.3;
        }

        this._previewRen.render(this._previewScene, this._previewCam);
    }
}
