# Three.js Game Editor

> **Work in progress** — things may be incomplete, change without notice, or break unexpectedly.
> Feedback, suggestions, and contributions are welcome — feel free to open an issue or start a discussion!

A collection of browser-based tools for working with **[Quaternius](https://quaternius.com)** 3D assets in Three.js.
No build step, no bundler — runs entirely in the browser.

> **3D assets (Quaternius) are not included** — see the Setup section below.

---

## Quick Start

### Option A — Studio.exe (recommended, Windows only)

**No Node.js or Python required.**

**1. [Download Studio.exe](https://github.com/ixtrem16-netizen/RPG/releases/latest)** from the Releases page and place it in the project folder (next to `assets/`, `src/`, etc.).

**2. Clone or download the repository** (code + structure, without the assets)
```bash
git clone https://github.com/ixtrem16-netizen/RPG.git
```

**3. Download the Quaternius assets** — see [Required Assets](#setup--required-assets) below and place them in `assets/`.

**4. Launch**

Double-click `Studio.exe` — the browser opens on `http://localhost:3000` automatically.

> `Studio.exe` embeds the Node.js runtime (~36 MB). It is not included in the repository — download it from the [Releases page](https://github.com/ixtrem16-netizen/RPG/releases/latest).
>
> **Developers:** to rebuild the exe after modifying `server.js`, run `npm run build` (requires Node.js).

---

### Option B — Local server (any OS)

```bash
npx serve . -p 3000
```
Then open **http://localhost:3000** in Chrome or Firefox.

> Any static file server works. Alternatively:
> ```bash
> python -m http.server 3000
> ```

---

### Option C — Bundled server with external assets

```bash
node server.js                                  # bundled ./assets/
node server.js --assets-root /path/to/assets    # external asset tree
TOOLS_WEB_ASSETS_ROOT=/path/to/assets node server.js
```

The `/assets/*` URL root resolves against whichever path is supplied; everything
else (HTML pages, `src/*`) is served from the directory that contains
`server.js`. Useful when embedding these tools in a larger project that owns
its own asset tree — the tools see `/assets/<pack>/<file>.glb` regardless of
where those assets live on disk.

Priority: `--assets-root` > `TOOLS_WEB_ASSETS_ROOT` > bundled `./assets/`.

---

## Navigation

Every tool page has a **`≡` button** (bottom-right corner) that opens a quick-switch menu to jump between tools without going back to the hub.

---

## Tools

### `index.html` — Hub
Central launcher — cards for every tool, grouped by category.

---

### `gameplay-test.html` — Gameplay Prototype
Full gameplay prototype — locomotion, combat, physics, town.

| Key | Action |
|-----|--------|
| W / A / S / D | Move |
| Shift | Sprint |
| Space | Jump |
| C | Crouch / Slide (while sprinting) |
| R | Roll |
| Q | Guard / Block (hold) — lean camera left |
| Shift + Q / E | Dodge left / right |
| F | Interact / Climb |
| K | Kick |
| 1–4 | Combat mode (Sword / Fists / Magic / Bow) |
| 0 | Unequip |
| G | Emote wheel |
| Tab | Camera lock-on |
| V | Camera mode (3rd person / shoulder) |
| I | Inventory |
| Escape | Pause |

---

### `char-builder.html` — Character Builder
Assemble modular characters from Quaternius outfit parts with per-zone color shaders.

- **Right-click + drag** — orbit camera
- **Scroll wheel** — zoom
- Left panel: switch body, outfit, texture, hair, beard
- Save / load character configs by name
- Export config for use in your own project

---

### `character-preview.html` — Character Preview
Preview a fully assembled character (outfit, hair, beard) with animations playing.

- **Right-click + drag** — orbit camera
- **Scroll wheel** — zoom
- Left panel: switch between saved characters
- Animations play automatically (Idle, Walk, Run, Jump, Attack…)

---

### `anim-inspect.html` — Animation Inspector
Browse and preview all animation clips (UAL1 + UAL2 merged into a single unified library).

- Click any clip name to preview it on the character
- Duration is shown under each clip name

---

### `asset-browser.html` — Asset Browser
Browse all loaded Quaternius assets (characters, props, environment).

- **Left panel** — filter by category / search by name
- **Right panel** — 3D preview with orbit controls
- **Right-click + drag** — orbit · **Scroll** — zoom

---

### `grip-editor.html` — Grip Editor
Fine-tune the position, rotation, and scale of each equipped weapon or tool on the character skeleton.

- Select a saved character and a weapon from the left panel
- Adjust grip with sliders (position X/Y/Z, rotation X/Y/Z, scale)
- **Right-click + drag** — orbit · **Scroll** — zoom
- Changes are saved automatically and shared with **Gameplay Test**

---

### `village-browser.html` — Village Browser
Browse and preview all Medieval Village MegaKit pieces.

- **Right-click + drag** — orbit · **Scroll** — zoom

---

### `nature-browser.html` — Nature Browser
Browse and preview nature assets (trees, rocks, vegetation).

- **Right-click + drag** — orbit · **Scroll** — zoom

---

### `soldier-test.html` — Soldier Test
Quick character + animation test scene.

- **Right-click + drag** — orbit · **Scroll** — zoom

---

## Setup — Required Assets

### Pack overview

All 3D assets come from **[Quaternius](https://quaternius.com)**.
Some packs are **free**, others require a **Patreon** subscription (Source tier).

| Pack | Tier | Used for |
|------|------|----------|
| Universal Animation Library (UAL) | Free or Source | Main character animations |
| Universal Animation Library 2 (UAL2) | Free or Source | Parkour / advanced animations |
| Modular Character Outfits - Fantasy | Source (Patreon) | Body, outfits, hair, modular parts |
| Medieval Village MegaKit | Free or Source | Buildings, props, vegetation |

> **Free** = downloadable directly on quaternius.com.  
> **Source** = .blend files + max resolution — Patreon subscription required.  
> The tools work with the **free Standard versions** for animations.

---

### Directory structure

After downloading the packs, place the files as follows:

```
assets/
├── characters/
│   ├── animations/
│   │   ├── UAL1_Standard.glb       ← Universal Animation Library (UAL pack)
│   │   ├── UAL1_Source.glb         ← (optional — Patreon Source version)
│   │   ├── UAL2_Standard.glb       ← Universal Animation Library 2 (UAL2 pack)
│   │   └── UAL2_Source.glb         ← (optional — Patreon Source version)
│   │
│   ├── bodies/
│   │   ├── Superhero_Male_FullBody.gltf    ← Modular Character Outfits - Fantasy
│   │   └── Superhero_Female_FullBody.gltf
│   │
│   ├── outfits/
│   │   └── *.gltf / *.bin          ← Modular Character Outfits - Fantasy
│   │
│   ├── hair/
│   │   └── *.gltf / *.bin          ← Modular Character Outfits - Fantasy
│   │
│   └── modular/
│       └── *.gltf / *.bin          ← Modular Character Outfits - Fantasy
│
└── environment/
    ├── village/
    │   └── *.gltf / *.bin          ← Medieval Village MegaKit
    │
    ├── props/
    │   └── *.gltf / *.bin          ← Medieval Village MegaKit
    │
    └── nature/
        └── *.gltf / *.bin          ← Medieval Village MegaKit
```

---

## Source files

| File | Description |
|------|-------------|
| `server.js` | Static file server — used by Studio.exe |
| `src/nav.js` | Floating nav widget injected in every tool page |
| `src/character.js` | CharacterController — loadRetargeted, AnimationMixer, state machine |
| `src/char-config.js` | Character config hub — outfit, hair, body per character name |
| `src/shaders.js` | Post-processing shaders (color grade) |
| `src/camera.js` | Witcher-style orbit camera — lean, lock-on, 1st/3rd person |
| `src/player.js` | Player movement, physics, stats |
| `src/collision.js` | AABB collision — floors, walls, ramps |
| `src/world.js` | Procedural terrain, chunks, biomes |
| `src/builder.js` | Procedural building blocks (room, torch, light) |
| `src/npc.js` | NPC class — outfit loading, wander AI, terrain tilt |
| `src/town.js` | Town assembly (Valcrest) |
| `src/daynight.js` | Day/night cycle, sky dome, sun/moon |
| `src/audio.js` | Footsteps, ambient sounds per zone |
| `src/ui.js` | HUD — hp, stamina, clock |
| `src/inventory.js` | Inventory system |
| `src/gods.js` | Narrative deity system |
| `src/build_mode.js` | In-game build mode (WIP) |
| `src/buildings/` | Prefab buildings (small house, tower, town hall) |

---

## License

Source code: **MIT** — free to use, modify, and redistribute.  
3D Assets: property of **Quaternius** — subject to their respective license terms.
