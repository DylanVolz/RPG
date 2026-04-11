# Dark Fantasy RPG — Three.js Gameplay Prototype

Prototype de gameplay RPG dark fantasy en Three.js (navigateur, zéro serveur).
Inclut : caméra Witcher, locomotion complète, combat, char builder, construction de ville.

> **Les assets 3D (Quaternius) ne sont pas inclus** — voir la section Setup ci-dessous.

---

## Contenu du projet

| Fichier | Description |
|---------|-------------|
| `gameplay-test.html` | Prototype principal — locomotion, combat, physique, armes |
| `char-builder.html` | Éditeur de personnage — outfits modulaires, shader zones |
| `char-combined.html` | Vue combinée char builder + preview |
| `index.html` | Hub principal |
| `src/` | Systèmes réutilisables (caméra, physique, bâtiments, town…) |

---

## Setup — Assets requis

### Vue d'ensemble des packs

Tous les assets 3D viennent de **[Quaternius](https://quaternius.com)**.
Certains packs sont **gratuits**, d'autres requièrent un abonnement **Patreon** (Source).

| Pack | Tier | Contenu utilisé |
|------|------|----------------|
| Universal Animation Library (UAL) | Gratuit ou Source | Animations personnage principal |
| Universal Animation Library 2 (UAL2) | Gratuit ou Source | Animations parkour / avancées |
| Modular Character Outfits - Fantasy | Source (Patreon) | Corps, tenues, cheveux, pièces modulaires |
| Medieval Village MegaKit | Gratuit ou Source | Bâtiments, props, végétation |

> **Gratuit** = téléchargeable sur quaternius.com directement.  
> **Source** = fichiers .blend + résolutions max — abonnement Patreon requis.  
> Le projet fonctionne avec les versions **Standard gratuites** pour les animations.

---

### Structure des répertoires

Après avoir téléchargé les packs, placer les fichiers comme suit :

```
assets/
├── characters/
│   ├── animations/
│   │   ├── UAL1_Standard.glb       ← Universal Animation Library (pack UAL)
│   │   ├── UAL1_Source.glb         ← (optionnel — version Source Patreon)
│   │   ├── UAL2_Standard.glb       ← Universal Animation Library 2 (pack UAL2)
│   │   └── UAL2_Source.glb         ← (optionnel — version Source Patreon)
│   │
│   ├── bodies/
│   │   ├── Superhero_Male_FullBody.gltf    ← Modular Character Outfits - Fantasy
│   │   └── Superhero_Female_FullBody.gltf  ←   (corps riggés — pack modular)
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
│           (pièces séparées par zone : Head, Arms, Legs, Body, Feet, Acc)
│
└── environment/
    ├── village/
    │   └── *.gltf / *.bin          ← Medieval Village MegaKit
    │       (murs, toits, fenêtres, portes, balcons…)
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

### Étapes d'installation

**1. Cloner / télécharger le projet**
```bash
git clone <url-du-repo>
cd RPG
```

**2. Télécharger les packs Quaternius**

- Aller sur **quaternius.com** ou le **Patreon Quaternius**
- Télécharger :
  - `Universal Animation Library` (UAL) — Standard gratuit suffit
  - `Universal Animation Library 2` (UAL2) — Standard gratuit suffit
  - `Medieval Village MegaKit` — version gratuite disponible
  - `Modular Character Outfits - Fantasy` — Source Patreon requis

**3. Copier les fichiers**

Extraire chaque pack et copier les fichiers `.gltf` / `.bin` / `.glb`
dans les répertoires correspondants selon la structure ci-dessus.

**4. Ouvrir dans le navigateur**

Aucun serveur requis — ouvrir directement `gameplay-test.html` dans Chrome ou Firefox.

> **Note Chrome** : si les assets ne se chargent pas en local (`file://`),
> lancer un serveur HTTP minimal :
> ```bash
> python -m http.server 8080
> # puis ouvrir http://localhost:8080/gameplay-test.html
> ```

---

## Contrôles — gameplay-test.html

| Touche | Action |
|--------|--------|
| W / A / S / D | Déplacement |
| Shift | Sprint |
| Espace | Saut |
| C | Accroupi / Slide (en sprint) |
| R | Roulade |
| Shift + Q / E | Esquive gauche / droite |
| F | Interagir / Grimper |
| K | Coup de pied (désarme la main droite) |
| 1–4 | Mode combat (Épée / Poings / Magie / Arc) |
| 0 | Désarmer |
| G | Roue d'émotes |
| Tab | Lock caméra |
| V | Mode caméra (3rd / shoulder) |

---

## Architecture technique

- **Moteur** : Three.js (importé via CDN, pas de bundler)
- **Physique** : custom — raycast terrain + AABB collisions
- **Animations** : Three.js AnimationMixer — clips nommés via `CLIP_MAP`
- **Caméra** : style Witcher 3 — orbit + lean + lock-on
- **Sauvegarde** : `localStorage` (position, config personnage)
- **Assets** : GLTF/GLB — chargés à la volée, pas de build step

---

## Licence

Code source : **MIT** — libre d'utilisation, modification, redistribution.  
Assets 3D : propriété de **Quaternius** — soumis aux termes de leur licence respective.
