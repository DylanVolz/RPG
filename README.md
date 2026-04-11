# Dark Fantasy RPG — Three.js Gameplay Prototype

A dark fantasy RPG gameplay prototype running entirely in the browser (no build step, no server required).
Features: Witcher-style camera, full locomotion, combat, character builder, and town construction.

> **3D assets (Quaternius) are not included** — see the Setup section below.

---

## Contents

| File | Description |
|------|-------------|
| `gameplay-test.html` | Main prototype — locomotion, combat, physics, weapons |
| `char-builder.html` | Character editor — modular outfits, zone shaders |
| `char-combined.html` | Combined char builder + preview |
| `index.html` | Main hub |
| `src/` | Reusable systems (camera, physics, buildings, town…) |

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
> The project works with the **free Standard versions** for animations.

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
│   │   └── Superhero_Female_FullBody.gltf  ←   (rigged bodies — modular pack)
│   │
│   ├── outfits/
│   │   └── *.gltf / *.bin          ← Modular Character Outfits - Fantasy
│   │       (Male_Ranger, Female_Knight, Male_Barbarian, etc.)
│   │
│   ├── hair/
│   │   └── *.gltf / *.bin          ← Modular Character Outfits - Fantasy
│   │       (Hair_Long, Hair_Buns, Hair_Beard, Eyebrows_*, etc.)
│   │
│   └── modular/
│       └── *.gltf / *.bin          ← Modular Character Outfits - Fantasy
│           (separate parts by zone: Head, Arms, Legs, Body, Feet, Acc)
│
└── environment/
    ├── village/
    │   └── *.gltf / *.bin          ← Medieval Village MegaKit
    │       (walls, roofs, windows, doors, balconies…)
    │
    ├── props/
    │   └── *.gltf / *.bin          ← Medieval Village MegaKit
    │       (Axe_Bronze, Sword_Bronze, Torch_Metal, Shield_Wooden,
    │        Pickaxe_Bronze, Table_Knife, Anvil, Chest, Bag…)
    │
    └── nature/
        └── *.gltf / *.bin          ← Medieval Village MegaKit
            (BirchTree_*, Oak_*, Rock_*, Bush_*, Grass_*…)
```

---

### Installation steps

**1. Clone / download the project**
```bash
git clone https://github.com/ixtrem16-netizen/RPG.git
cd RPG
```

**2. Download the Quaternius packs**

- Go to **quaternius.com** or the **Quaternius Patreon**
- Download:
  - `Universal Animation Library` (UAL) — free Standard version is enough
  - `Universal Animation Library 2` (UAL2) — free Standard version is enough
  - `Medieval Village MegaKit` — free version available
  - `Modular Character Outfits - Fantasy` — requires Patreon Source tier

**3. Copy the files**

Extract each pack and copy `.gltf` / `.bin` / `.glb` files
into the corresponding directories according to the structure above.

**4. Open in browser**

No server required — open `gameplay-test.html` directly in Chrome or Firefox.

> **Chrome note**: if assets don't load locally (`file://`),
> run a minimal HTTP server:
> ```bash
> python -m http.server 8080
> # then open http://localhost:8080/gameplay-test.html
> ```

---

## Controls — gameplay-test.html

| Key | Action |
|-----|--------|
| W / A / S / D | Move |
| Shift | Sprint |
| Space | Jump |
| C | Crouch / Slide (while sprinting) |
| R | Roll |
| Shift + Q / E | Dodge left / right |
| F | Interact / Climb |
| K | Kick (disarms right hand) |
| 1–4 | Combat mode (Sword / Fists / Magic / Bow) |
| 0 | Unequip |
| G | Emote wheel |
| Tab | Camera lock-on |
| V | Camera mode (3rd person / shoulder) |

---

## Technical Architecture

- **Engine**: Three.js (imported via CDN, no bundler)
- **Physics**: custom — terrain raycast + AABB collisions
- **Animations**: Three.js AnimationMixer — clips named via `CLIP_MAP`
- **Camera**: Witcher 3 style — orbit + lean + lock-on
- **Save system**: `localStorage` (position, character config)
- **Assets**: GLTF/GLB — loaded on the fly, no build step

---

## License

Source code: **MIT** — free to use, modify, and redistribute.  
3D Assets: property of **Quaternius** — subject to their respective license terms.
