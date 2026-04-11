// ══════════════════════════════════════════════════════════
//  AUDIO.JS — Web Audio API procédural
//  Ambiances par région, sons joueur, musique adaptative
// ══════════════════════════════════════════════════════════

let _ctx = null;
let _masterGain = null;
let _ambiGain   = null;
let _ambiNodes  = [];   // nœuds actifs de l'ambiance courante
let _currentZone = '';

export function initAudio() {
    if (_ctx) return;
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = 0.7;
    _masterGain.connect(_ctx.destination);

    _ambiGain = _ctx.createGain();
    _ambiGain.gain.value = 0;
    _ambiGain.connect(_masterGain);
}

export function resumeAudio() {
    if (_ctx?.state === 'suspended') _ctx.resume();
}

// ── Bruit blanc (base de nombreux sons procéduraux) ───────
function _createNoise(duration = 2) {
    const frames = Math.ceil(_ctx.sampleRate * duration);
    const buf    = _ctx.createBuffer(1, frames, _ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buf;
}

// ── Ambiance Vent ─────────────────────────────────────────
function _startWind(intensity = 0.15) {
    const buf    = _createNoise(3);
    const src    = _ctx.createBufferSource();
    src.buffer   = buf;
    src.loop     = true;

    const bp     = _ctx.createBiquadFilter();
    bp.type      = 'bandpass';
    bp.frequency.value = 400;
    bp.Q.value   = 0.4;

    const gain   = _ctx.createGain();
    gain.gain.value = intensity;

    src.connect(bp); bp.connect(gain); gain.connect(_ambiGain);
    src.start();
    return [src, gain];
}

// ── Ambiance Forêt — craquements d'arbres ─────────────────
function _startForest() {
    return _startWind(0.08);
}

// ── Ambiance Marais — bourdonnement grave ──────────────────
function _startSwamp() {
    const osc  = _ctx.createOscillator();
    osc.type   = 'sawtooth';
    osc.frequency.value = 55;

    const lfo  = _ctx.createOscillator();
    lfo.type   = 'sine';
    lfo.frequency.value = 0.07;

    const lfoG = _ctx.createGain();
    lfoG.gain.value = 8;

    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);

    const gain = _ctx.createGain();
    gain.gain.value = 0.05;

    osc.connect(gain); gain.connect(_ambiGain);
    osc.start(); lfo.start();
    return [osc, lfo, gain];
}

// ── Ambiance Entrailles — drone profond ───────────────────
function _startUnderworld() {
    const osc  = _ctx.createOscillator();
    osc.type   = 'sine';
    osc.frequency.value = 38;

    const lfo  = _ctx.createOscillator();
    lfo.type   = 'sine';
    lfo.frequency.value = 0.03;

    const lfoG = _ctx.createGain();
    lfoG.gain.value = 4;

    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);

    const gain = _ctx.createGain();
    gain.gain.value = 0.12;

    const hp   = _ctx.createBiquadFilter();
    hp.type    = 'highpass';
    hp.frequency.value = 30;

    osc.connect(hp); hp.connect(gain); gain.connect(_ambiGain);
    osc.start(); lfo.start();
    return [osc, lfo, gain];
}

// ── Transition entre zones ────────────────────────────────
export function setZoneAmbience(zoneId) {
    if (!_ctx || zoneId === _currentZone) return;
    _currentZone = zoneId;

    // Fade out ambiance courante
    _ambiGain.gain.setTargetAtTime(0, _ctx.currentTime, 1.5);
    setTimeout(() => {
        _ambiNodes.forEach(n => { try { n.stop?.(); n.disconnect?.(); } catch(e){} });
        _ambiNodes = [];

        let nodes = [];
        if (zoneId === 'ashfen' || zoneId === 'marais_visages') {
            nodes = _startSwamp();
        } else if (['kaldrath','grimveld','grande_foret','duskmere','lande_pendus'].includes(zoneId)) {
            nodes = _startForest();
        } else if (zoneId === 'underworld') {
            nodes = _startUnderworld();
        } else {
            nodes = _startWind(0.1);
        }

        _ambiNodes = nodes;
        _ambiGain.gain.setTargetAtTime(0.8, _ctx.currentTime, 1.5);
    }, 2000);
}

// ── Pas du joueur ─────────────────────────────────────────
let _stepCooldown = 0;
export function playStep(surface = 'dirt', delta = 0.016) {
    if (!_ctx || _ctx.state !== 'running') return;
    _stepCooldown -= delta;
    if (_stepCooldown > 0) return;
    _stepCooldown = 0.35;

    const freq = surface === 'stone' ? 180 : surface === 'snow' ? 80 : 140;
    const dur  = 0.06;

    const buf  = _createNoise(dur);
    const src  = _ctx.createBufferSource();
    src.buffer = buf;

    const bp   = _ctx.createBiquadFilter();
    bp.type    = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 2;

    const gain = _ctx.createGain();
    gain.gain.setValueAtTime(0.18, _ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + dur);

    src.connect(bp); bp.connect(gain); gain.connect(_masterGain);
    src.start();
    src.stop(_ctx.currentTime + dur + 0.01);
}

// ── Son de saut / atterrissage ────────────────────────────
export function playLand(intensity = 1.0) {
    if (!_ctx) return;
    const buf  = _createNoise(0.15);
    const src  = _ctx.createBufferSource();
    src.buffer = buf;
    const lp   = _ctx.createBiquadFilter();
    lp.type    = 'lowpass'; lp.frequency.value = 200;
    const gain = _ctx.createGain();
    gain.gain.setValueAtTime(0.3 * intensity, _ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + 0.15);
    src.connect(lp); lp.connect(gain); gain.connect(_masterGain);
    src.start(); src.stop(_ctx.currentTime + 0.2);
}

export function setMasterVolume(v) {
    if (_masterGain) _masterGain.gain.setTargetAtTime(v, _ctx.currentTime, 0.3);
}
