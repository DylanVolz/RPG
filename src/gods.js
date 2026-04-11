// ═══════════════════════════════════════════════════════════════
//  GODS.JS — Système des 7 Dieux
//
//  Chaque dieu a un domaine, une couleur, une personnalité.
//  Ils murmurent au joueur via des textes flottants.
//  Ils se répondent entre eux. Ils se souviennent.
//  Dans les Entrailles (y < −5) : silence total.
// ═══════════════════════════════════════════════════════════════

export const GODS = {
    vareth: {
        id: 'vareth', name: 'Vareth',
        domain: 'Cupidité / Ambition',
        stat: 'ombre',          // stat qu'il surveille
        el: null,               // element DOM, initialisé dans init()
    },
    sorel: {
        id: 'sorel', name: 'Sorel',
        domain: 'Justice / Ordre',
        stat: 'volonte',
        el: null,
    },
    maren: {
        id: 'maren', name: 'Maren',
        domain: 'Compassion / Sacrifice',
        stat: 'eloquence',
        el: null,
    },
    dusk: {
        id: 'dusk', name: 'Dusk',
        domain: 'Tromperie / Ombres',
        stat: 'ombre',
        el: null,
    },
    brahl: {
        id: 'brahl', name: 'Brahl',
        domain: 'Guerre / Force',
        stat: 'force',
        el: null,
    },
    ylene: {
        id: 'ylene', name: 'Ylene',
        domain: 'Connaissance / Vérité',
        stat: 'intelligence',
        el: null,
    },
    orvane: {
        id: 'orvane', name: 'Orvane',
        domain: 'Chaos / Liberté',
        stat: null,     // Orvane commente les contrastes, pas une stat fixe
        el: null,
    },
};

// ── File d'attente des murmures ──────────────────────────────
const _queue    = [];
let   _active   = false;
let   _hideTimer = 0;
let   _currentEl = null;

// ── Mémoire des dieux — influence accumulée ──────────────────
const _influence = {
    vareth:0, sorel:0, maren:0,
    dusk:0,   brahl:0, ylene:0, orvane:0,
};

// ── Mode silence (Entrailles) ────────────────────────────────
let _silenced = false;

// ─────────────────────────────────────────────────────────────
export function initGods() {
    for (const god of Object.values(GODS)) {
        god.el = document.getElementById(`god-${god.id}`);
    }
}

/** Mettre les dieux en silence (Entrailles) */
export function setSilenced(val) {
    if (val === _silenced) return;
    _silenced = val;
    if (val) {
        // Cacher tous les éléments immédiatement
        for (const god of Object.values(GODS)) {
            if (god.el) god.el.classList.remove('visible');
        }
        _queue.length = 0;
        _active = false;
    }
}

/**
 * Faire parler un dieu.
 * @param {string} godId   — id du dieu (ex: 'vareth')
 * @param {string} text    — texte du murmure
 * @param {number} duration — durée d'affichage en ms (défaut 6000)
 * @param {number} delay   — délai avant affichage en ms (défaut 0)
 */
export function godSpeak(godId, text, duration = 6000, delay = 0) {
    if (_silenced) return;
    const god = GODS[godId];
    if (!god || !god.el) return;
    _queue.push({ god, text, duration, delay });
    if (!_active) _processQueue();
}

/**
 * Faire une séquence de murmures — les dieux se répondent.
 * @param {Array} sequence — [{id, text, duration?, delay?}, ...]
 */
export function godDialogue(sequence) {
    if (_silenced) return;
    for (const item of sequence) {
        godSpeak(item.id, item.text, item.duration || 6000, item.delay || 0);
    }
}

function _processQueue() {
    if (_queue.length === 0) { _active = false; return; }
    _active = true;

    const item = _queue.shift();
    setTimeout(() => {
        const { god, text, duration } = item;
        if (!god.el) return;

        // Cacher le précédent
        if (_currentEl && _currentEl !== god.el) {
            _currentEl.classList.remove('visible');
        }

        god.el.querySelector('.god-text').textContent = text;
        god.el.classList.add('visible');
        _currentEl = god.el;

        // Accumule l'influence
        _influence[god.id] = (_influence[god.id] || 0) + 1;

        // Programmer la disparition
        setTimeout(() => {
            god.el.classList.remove('visible');
            setTimeout(_processQueue, 800);  // gap entre murmures
        }, duration);

    }, item.delay);
}

// ── Dérive de stat observée — réaction possible des dieux ────
/**
 * Appelé par player.js quand une stat dérive.
 * Les dieux peuvent commenter.
 */
export function onStatDrift(statName, delta, playerStats) {
    if (_silenced) return;

    const up = delta > 0;

    // Brahl — surveille Force et Endurance
    if (statName === 'force' && !up) {
        godSpeak('brahl', "Tu ramollis. C'est une faiblesse.", 5000, 500);
    } else if (statName === 'force' && up) {
        // Brahl approuve silencieusement (rare)
        if (Math.random() < 0.3) godSpeak('brahl', "Bien.", 3000, 200);
    }

    // Maren — surveille Éloquence
    if (statName === 'eloquence' && up) {
        if (Math.random() < 0.4) godSpeak('maren', "Tu apprends à écouter.", 5500, 300);
    }

    // Dusk — surveille Ombre
    if (statName === 'ombre' && up) {
        if (Math.random() < 0.4) godSpeak('dusk', "Voilà comment on se déplace.", 5000, 200);
    }
    if (statName === 'ombre' && !up) {
        if (Math.random() < 0.3) godSpeak('dusk', "Tu deviens transparent. C'est pitoyable.", 5500, 400);
    }

    // Ylene — surveille Intelligence
    if (statName === 'intelligence' && !up) {
        if (Math.random() < 0.35) godSpeak('ylene', "Tu cesses d'observer. Tu deviens... ordinaire.", 6000, 600);
    }

    // Orvane — commente les contrastes (Force monte + Ombre monte = rare)
    if (Math.random() < 0.05) {
        const f = playerStats.force, o = playerStats.ombre;
        if (f > 65 && o > 55) {
            godSpeak('orvane', "Un guerrier qui se cache. J'adore ce monde.", 6000, 1000);
        }
    }
}

// ── Querelle entre dieux — déclenchée par events ─────────────
/**
 * Situations prédéfinies où les dieux se querellent.
 * Appelé par game.js selon les actions du joueur.
 */
export const GOD_QUARRELS = {

    // Joueur amorce un dialogue au lieu de combattre
    dialogue_instead_of_fight: () => godDialogue([
        { id:'brahl',  text:"Qu'est-ce que c'est que ça. Tu parles, maintenant ?", duration:5500 },
        { id:'dusk',   text:"Intéressant. Continue, c'est divertissant.",           duration:5500, delay:5200 },
        { id:'brahl',  text:"Reprends-toi. Tu sais ce que tu es.",                  duration:5500, delay:10400 },
        { id:'maren',  text:"Il y a peut-être quelque chose qui change en toi.",    duration:6000, delay:15900 },
    ]),

    // Joueur vole quelqu'un
    pickpocket: () => godDialogue([
        { id:'vareth', text:"Bien joué. Il ne l'aurait pas dépensé utilement.",  duration:5000 },
        { id:'sorel',  text:"...",                                                duration:3000, delay:4800 },
        { id:'dusk',   text:"Sorel se tait. Ça lui fait du bien.",               duration:5000, delay:8000 },
    ]),

    // Joueur aide quelqu'un sans raison apparente
    help_unprompted: () => godDialogue([
        { id:'maren',  text:"Voilà. C'est ça.",                                  duration:4000 },
        { id:'vareth', text:"Tu aurais pu demander quelque chose en échange.",   duration:5000, delay:4200 },
        { id:'maren',  text:"Tais-toi, Vareth.",                                 duration:3500, delay:9400 },
        { id:'vareth', text:"... D'accord.",                                     duration:3000, delay:13200 },
    ]),

    // Joueur entre dans les Entrailles pour la première fois
    entering_underworld: () => godDialogue([
        { id:'brahl',  text:"Je ne dirai pas 'ne vas pas là-dedans'. Mais sache que là-dessous... je ne peux plus te voir.", duration:8000 },
        { id:'maren',  text:"S'il te plaît.",                                    duration:4000, delay:8500 },
        { id:'dusk',   text:"Je n'ai pas de blague. C'est tout ce que tu as besoin de savoir.",  duration:7000, delay:13000 },
        { id:'orvane', text:"Je serais curieux de savoir ce que tu vas trouver. Si tu reviens, raconte-moi.", duration:8000, delay:20500 },
    ]),

    // Joueur ressort des Entrailles
    exiting_underworld: () => godDialogue([
        { id:'ylene',  text:"Tu es revenu. Quelque chose a changé.",             duration:6000 },
        { id:'maren',  text:"Tu es là.",                                         duration:3500, delay:6500 },
        { id:'orvane', text:"Alors ? Qu'est-ce qu'il y avait ?",                 duration:5000, delay:10500 },
    ]),
};

/** Retourner l'influence accumulée pour un dieu */
export function getInfluence(godId) { return _influence[godId] || 0; }

/** Dieu dominant (celui que le joueur a le plus suivi) */
export function getDominantGod() {
    let best = null, bestVal = -1;
    for (const [id, val] of Object.entries(_influence)) {
        if (val > bestVal) { bestVal = val; best = id; }
    }
    return best;
}
