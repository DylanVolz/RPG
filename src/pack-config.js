/**
 * src/pack-config.js — Single source of truth for the AnimPicStudio pack
 * registry. Used by pack-browser.html (library dropdown + manifest loader)
 * and by the SPA shell (hub cards + tab labels).
 *
 * Adding a pack: append to PACKS, add a tab/card in index.html, drop the
 * manifest under client/game/assets/animpicstudio/<slug>/manifest.json.
 */

export const PACKS = [
    { slug: 'poly-mega-survival-construction-kit', vendor: 'animpicstudio', name: 'Construction Kit', icon: '🏗' },
    { slug: 'poly-farm',                            vendor: 'animpicstudio', name: 'Farm',             icon: '🌾' },
    { slug: 'poly-forest-village',                  vendor: 'animpicstudio', name: 'Forest Village',   icon: '🏘' },
    { slug: 'poly-mega-survival-medical-kit',       vendor: 'animpicstudio', name: 'Medical Kit',      icon: '💊' },
    { slug: 'poly-survival-melee-weapons',          vendor: 'animpicstudio', name: 'Melee Weapons',    icon: '🗡' },
    { slug: 'poly-nature-pack',                     vendor: 'animpicstudio', name: 'Nature Pack',      icon: '🌳' },
    { slug: 'poly-military-shooting-range',         vendor: 'animpicstudio', name: 'Shooting Range',   icon: '🎯' },
    { slug: 'poly-survival-subway',                 vendor: 'animpicstudio', name: 'Subway',           icon: '🚇' },
    { slug: 'poly-mega-survival-food',              vendor: 'animpicstudio', name: 'Food',             icon: '🥫' },
    { slug: 'poly-mega-survival-kit',               vendor: 'animpicstudio', name: 'Survival Kit',     icon: '🧰' },
    { slug: 'poly-mega-survival-tools',             vendor: 'animpicstudio', name: 'Survival Tools',   icon: '⚒' },
    { slug: 'poly-mega-vehicle-kit',                vendor: 'animpicstudio', name: 'Vehicle Kit',      icon: '🚚' },
    { slug: 'poly-mega-weapons-kit',                vendor: 'animpicstudio', name: 'Weapons Kit',      icon: '🔫' },
    { slug: 'poly-survival-workshop',               vendor: 'animpicstudio', name: 'Workshop',         icon: '🔧' },
];

export const PACKS_BY_SLUG = Object.fromEntries(PACKS.map(p => [p.slug, p]));

export const DEFAULT_PACK = PACKS[0].slug;

// Map from the pre-consolidation per-pack tool ids ("farm-browser",
// "workshop-browser", …) to their pack slug — kept so old SPA hash links
// like `#farm-browser` continue to resolve to pack-browser?pack=poly-farm.
export const LEGACY_TOOL_TO_PACK = {
    'construction-kit-browser': 'poly-mega-survival-construction-kit',
    'farm-browser':              'poly-farm',
    'forest-village-browser':    'poly-forest-village',
    'medical-kit-browser':       'poly-mega-survival-medical-kit',
    'melee-weapons-browser':     'poly-survival-melee-weapons',
    'nature-pack-browser':       'poly-nature-pack',
    'shooting-range-browser':    'poly-military-shooting-range',
    'subway-browser':            'poly-survival-subway',
    'survival-food-browser':     'poly-mega-survival-food',
    'survival-kit-browser':      'poly-mega-survival-kit',
    'survival-tools-browser':    'poly-mega-survival-tools',
    'vehicle-kit-browser':       'poly-mega-vehicle-kit',
    'weapons-kit-browser':       'poly-mega-weapons-kit',
    'workshop-browser':          'poly-survival-workshop',
};
