# @imenam/mcp-design

Un canvas de design pilotable par un agent, avec une interface graphique où l'utilisateur reprend la main.

L'agent compose une planche (formes, texte) via des outils MCP. L'utilisateur ouvre la GUI, déplace, retaille, recolore, réécrit. L'agent relit ensuite **exactement ce qui a changé** et l'intègre dans le code de l'application.

```
Agent ──add_nodes/update_nodes──▶  Design  ◀──glisser-déposer──  Utilisateur (GUI)
  ▲                                                                    │
  └──────────── get_changes ──── diff depuis la dernière baseline ──────┘
```

---

## Installation

```bash
npm install -g @imenam/mcp-design
```

Ou directement via `npx`, sans installation.

### Déclaration dans un projet

```bash
npx -y @imenam/mcp-design --claude-setup-mcp
```

La commande crée (ou complète) le `.mcp.json` du répertoire courant avec une entrée `mcp-design` dont les variables sont pré-remplies. Ajoutez `--force` pour remplacer une entrée existante ; les autres serveurs sont préservés.

Exemple d'entrée générée :

```json
{
  "mcpServers": {
    "mcp-design": {
      "command": "npx",
      "args": ["-y", "@imenam/mcp-design"],
      "env": {
        "PROXY_URL": "http://localhost:3000",
        "APP_GROUP": "Mon Projet",
        "APP_NAME": "Design Mon Projet",
        "APP_PATH": "/design-mon-projet",
        "MCP_DESIGN_DATA_DIR": "C:/dev/mon-projet/.design-data",
        "MCP_LOG_DIR": ""
      }
    }
  }
}
```

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `PROXY_URL` | URL du [proxy central](https://github.com/imenam/proxy-setup). **Sans elle, la GUI est simplement désactivée** — les outils MCP continuent de fonctionner. |
| `APP_PATH` | Chemin de montage de la GUI derrière le proxy (défaut `/design-gui`). |
| `APP_NAME` | Nom affiché dans le dashboard du proxy. |
| `APP_GROUP` | Section repliable du dashboard du proxy (facultatif). |
| `MCP_DESIGN_DATA_DIR` | Répertoire de stockage des designs. `MCP_DATA_DIR` est accepté en repli. Défaut : `<package>/.design-data`. |
| `MCP_LOG_DIR` | Répertoire des logs. Défaut : `<data>/logs`. |

Un design est un simple fichier JSON dans `<data>/designs/<id>.json` — lisible, diffable, versionnable.

---

## Les outils

### Planches

| Outil | Effet |
|---|---|
| `list_designs` | Liste les planches, leur taille, leur nombre d'éléments et le nombre de modifications non encore récupérées. |
| `create_design` | Crée une planche vide (`name`, et facultativement `width`, `height`, `background`). |
| `get_design` | Lit une planche : `format: "summary"` (inventaire compact, défaut) ou `format: "json"` (valeurs exactes). |
| `update_design` | Renomme la planche, change ses dimensions ou son fond. |
| `delete_design` | Supprime définitivement une planche. |

### Éléments

| Outil | Effet |
|---|---|
| `add_nodes` | Ajoute un ou plusieurs éléments par-dessus les autres. |
| `update_nodes` | Patche des éléments existants — seuls les champs fournis changent. |
| `delete_nodes` | Supprime des éléments par identifiant. Supprimer un groupe emporte son contenu. |
| `group_nodes` | Enveloppe des éléments dans un nouveau groupe, sans rien déplacer à l'écran. |
| `ungroup_nodes` | Dissout des groupes : leur contenu remonte d'un niveau, toujours sans bouger. |

Six types d'éléments : `rect`, `ellipse`, `line`, `text`, `icon` et `group`. Seul `type` est obligatoire — sauf pour `icon`, qui a besoin du nom de l'icône ; tout le reste tombe sur des valeurs par défaut visibles, donc `{ "type": "rect" }` suffit à créer quelque chose qu'on voit à l'écran.

**Champs communs** — `name`, `parentId`, `x`, `y`, `width`, `height` (en pixels, origine en haut à gauche), `rotation` (degrés, autour du centre de la boîte), `opacity` (0–1).

**Toute longueur est en pixels**, sans exception : `x`, `y`, `width`, `height`, `strokeWidth`, `radius`, `fontSize` et `lineHeight`. Chaque champ porte sa description et son unité dans [`shared/node-fields.ts`](shared/node-fields.ts), d'où le schéma zod **et** l'`inputSchema` MCP les tirent tous les deux — une unité n'est écrite qu'à un seul endroit.

| Type | Champs propres |
|---|---|
| `rect` | `fill`, `stroke`, `strokeWidth`, `radius` |
| `ellipse` | `fill`, `stroke`, `strokeWidth` |
| `line` | `stroke`, `strokeWidth` — le trait va de `(x, y)` à `(x + width, y + height)`, donc les deltas négatifs encodent la direction |
| `text` | `text`, `color`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `textAlign`, `lineHeight` (en px) |
| `icon` | `icon` (obligatoire — le nom du dessin), `fill`, `stroke`, `strokeWidth` |
| `group` | aucun — c'est un pur conteneur |

### Icônes

Un agent qui n'a que des formes à sa disposition finit par approximer une icône avec trois ellipses et deux traits : le rendu est médiocre, et la maquette relue plus tard ne dit plus ce que ce tas de formes représentait. Le type `icon` répond exactement à ça — **1791 icônes [Lucide](https://lucide.dev) (licence ISC) sont embarquées** dans le paquet.

```json
{ "type": "icon", "icon": "shopping-cart", "x": 24, "y": 18, "width": 24, "height": 24, "stroke": "#1a1a18" }
```

Le nœud stocke le **nom**, jamais le tracé : le JSON reste lisible — `shopping-cart` dit à l'agent qui le relit ce que la forme représente —, un nœud `icon` pèse moins qu'un `rect`, et changer d'icône est un `update_nodes` d'un seul champ. Le SVG est résolu au rendu depuis [`shared/icons/`](shared/icons/), donc le canvas, l'export et la capture dessinent rigoureusement la même chose.

| Outil | Effet |
|---|---|
| `search_icons` | Cherche une icône par description (`query`), en anglais et par synonymes — « basket » sort `shopping-cart`. Renvoie les noms **et** une planche de vignettes, sauf si `preview: false`. |

Les icônes les plus courantes sont listées directement dans la description d'`add_nodes` (`CORE_ICONS` dans [`shared/icons/index.ts`](shared/icons/index.ts)) : habiller une interface ordinaire ne demande aucun aller-retour. `search_icons` sert à la traîne longue. Un nom refusé repart avec des suggestions issues des synonymes, ce qui rattrape aussi bien une faute qu'un renommage de la bibliothèque (`home` → `house`).

Trois règles à connaître :

- **`strokeWidth` est la seule exception à la règle du pixel** : il s'exprime dans la grille 24 × 24 de l'icône (2 = graisse normale, 1.5 = fine, 2.5 = grasse). Une icône de 96 px avec `strokeWidth: 2` dessine un trait de 8 px à l'écran — le trait suit la taille, il n'y a rien à compenser.
- **La boîte est carrée** : `width` et `height` sont ramenés au plus petit des deux, et le tracé est mis à l'échelle uniformément puis centré. Jamais déformé.
- **Un nom inconnu ne casse rien** : l'icône est remplacée par un carré en pointillés avec un `?`. Le même SVG servant au canvas, à l'export et à la capture, une exception y serait fatale partout à la fois — un design ouvert après une mise à jour de la bibliothèque doit rester ouvrable, et montrer *où* est le problème.

Côté GUI, l'outil « Icône » de la barre d'outils (raccourci `I`) ouvre un sélecteur cherchable, et l'inspecteur permet de remplacer l'icône d'un élément existant. L'index de synonymes y est chargé à la demande, pour ne pas peser sur le premier affichage du canvas.

La bibliothèque est figée dans le dépôt par `npm run generate-icons` ([`scripts/generate-icons.js`](scripts/generate-icons.js)) : ni le serveur publié ni le bundle de la GUI ne dépendent de Lucide à l'exécution, et la géométrie d'un design ne peut pas changer au gré d'un `npm install`.

### Hiérarchie

Chaque élément porte un `parentId` : `null` à la racine de la planche, sinon l'identifiant d'un `group`. **Les coordonnées sont exprimées dans l'espace du parent** : un élément à la racine se positionne par rapport à la planche, un élément dans un groupe par rapport à l'origine de ce groupe.

C'est ce qui rend un déplacement de groupe lisible côté agent — un seul champ change, pas les coordonnées de chaque membre :

```
- g_a1b2c3 — "Carte produit" (group)
    x: 100 -> 260
```

La taille d'un groupe est **déduite de son contenu** : `width` et `height` sont recalculés à chaque mutation, ne peuvent pas être écrits, et n'apparaissent jamais dans un diff. Le stockage reste une liste plate, ordonnée en parcours préfixe — chaque parent suivi de son sous-arbre — ce qui garde le fichier JSON lisible et diffable.

Le texte n'est **jamais re-wrappé automatiquement** : seuls les `\n` explicites créent une nouvelle ligne. Le comportement est ainsi identique à l'écran et à l'export.

`lineHeight` est une **distance en pixels entre deux lignes de base**, pas un multiplicateur de `fontSize` : avec `fontSize: 64`, on écrit `76`, pas `1.2`. C'est l'unité que les agents emploient spontanément, et la seule qui se lise dans la même échelle que le reste. Une valeur sous 4 est donc refusée à l'écriture avec un message explicite, et les fichiers écrits avant ce changement sont convertis à la lecture (`ratio x fontSize`) par [`src/core/migrate.ts`](src/core/migrate.ts). Champ omis = `fontSize x 1.35`.

### Ordre d'empilement

L'index dans la liste **est** l'ordre d'empilement : le dernier élément d'une fratrie est celui du dessus. `add_nodes` empile au-dessus, et `reorder_nodes` déplace ensuite ce qui existe déjà.

| Outil | Effet |
|---|---|
| `reorder_nodes` | `position: front / back / forward / backward` sur un ou plusieurs éléments. Un groupe emporte son contenu ; plusieurs éléments gardent leur ordre relatif. |

L'empilement est **relatif à la fratrie** : un élément ne passe jamais devant le contenu d'un autre groupe — c'est ce groupe qu'il faut alors réordonner, ou l'élément qu'il faut en sortir via `parentId`. La logique vit dans [`shared/tree.ts`](shared/tree.ts) et sert aussi bien l'outil que le panneau de calques de la GUI : les deux ne peuvent pas diverger.

Un lot est intégralement validé avant la moindre écriture : une entrée invalide ne laisse jamais un design à moitié modifié.

### Récupérer le travail de l'utilisateur

| Outil | Effet |
|---|---|
| `get_changes` | Liste tout ce qui a été ajouté, modifié, supprimé ou réordonné depuis la dernière baseline, champ par champ (`x: 40 -> 240`). |
| `mark_synced` | Fige l'état courant comme nouvelle baseline. |
| `export_design` | Rend la planche en `html`, `jsx`, `svg`, `json` ou `summary`. `output_path` écrit dans un fichier au lieu de renvoyer le contenu. |
| `screenshot_design` | Rasterise la planche en PNG et le renvoie **en image** à l'agent. `node_id` cadre la capture sur un groupe (ou n'importe quel élément), `scale` zoome, `padding` ajoute de la marge, `output_path` écrit un `.png` au lieu de renvoyer l'image. |

**`get_changes` n'acquitte jamais ce qu'il montre.** Seul `mark_synced` déplace la baseline, et il ne doit être appelé qu'une fois les modifications réellement reportées dans le code. Un simple appel de lecture ne peut donc pas faire disparaître un diff que l'agent n'a pas encore traité.

### GUI

| Outil | Effet |
|---|---|
| `reconnect_gui` | Relance le worker GUI et le réenregistre auprès du proxy. `force: true` redémarre même s'il semble vivant. |

---

## Boucle de travail type

```
create_design { name: "Landing" }
add_nodes     { design_id: "landing", nodes: [...] }
mark_synced   { design_id: "landing" }        ← point de départ de la comparaison

  … l'utilisateur ouvre la GUI et retouche la maquette …

get_changes      { design_id: "landing" }     ← ce qu'il a changé, champ par champ
screenshot_design { design_id: "landing" }    ← ce que ça donne réellement, en image
export_design { design_id: "landing", format: "html" }
  … l'agent reporte les valeurs dans le code de l'application …
mark_synced   { design_id: "landing" }        ← acquittement
```

---

## L'interface

Trois colonnes : la liste des planches, le canvas, l'inspecteur et les calques.

- **Outils** — sélection, rectangle, ellipse, ligne, texte, icône. Glisser pour dimensionner, cliquer pour poser à la taille par défaut. L'outil icône ouvre d'abord son sélecteur : poser une icône suppose d'avoir choisi laquelle.
- **Édition** — déplacement au glisser, 8 poignées de redimensionnement (2 extrémités pour une ligne), sélection multiple au rectangle d'encadrement ou au Maj+clic.
- **Groupes** — `Ctrl+G` groupe la sélection, `Ctrl+Maj+G` la dissout. Un clic dans le canvas sélectionne le **groupe le plus haut** ; `Alt+clic` vise l'élément exact à l'intérieur. Déplacer un groupe déplace tout son contenu.
- **Texte** — double-clic pour éditer en place, avec la même métrique qu'au rendu final.
- **Inspecteur** — position, taille, rotation, opacité, couleurs, épaisseur, arrondi, contenu, taille et graisse de police, interligne (en px), alignement, choix de l'icône. Pour un groupe, la taille est affichée en lecture seule puisqu'elle suit son contenu ; pour une icône, un seul champ de taille, puisqu'elle est carrée.
- **Calques** — arbre repliable, ordre d'empilement, sélection, montée/descente d'un cran.

### Naviguer dans la planche

- **Zoom** : `Ctrl`/`Cmd` + molette, ancré sous le curseur — le point visé ne bouge pas.
- **Déplacement** : molette seule, ou **barre espace maintenue + glisser**. Tant que la barre espace est enfoncée, aucun geste ne peut déplacer un élément, même en partant de l'un d'eux. Le clic molette fait la même chose.
- Le sélecteur de zoom de la barre d'outils reste disponible pour revenir à une valeur ronde.

Raccourcis : `V` `R` `O` `L` `T` `I` (outils), `Ctrl+Z` / `Ctrl+Y` (annuler/rétablir), `Ctrl+G` / `Ctrl+Maj+G` (grouper / dissoudre), `Ctrl+D` (dupliquer), `Ctrl+A` (tout sélectionner), `Suppr`, flèches (déplacer d'1 px, 10 px avec `Maj`), `Échap`.

La sauvegarde est automatique et différée. Une modification faite par l'agent pendant que la GUI est ouverte y apparaît en direct, via SSE ; une modification faite dans la GUI est enregistrée comme venant de l'utilisateur, et c'est ce que `get_changes` restitue.

Le badge « n à synchroniser » d'une planche indique le nombre de modifications que l'agent n'a pas encore acquittées.

---

## Architecture

Deux processus, conformément au standard de l'écosystème (`@imenam/mcp-gui-interface`) :

- **MCP Master** (`src/index.ts`) — protocole JSON-RPC sur stdio, stockage des designs, cycle de vie du worker via `GuiLauncher`.
- **GUI Worker** (`src/gui-worker.ts`) — serveur Hono, enregistrement auprès du proxy via `ProxyClient`, API REST + SSE, sert la SPA React.

Les deux communiquent par IPC. Le worker se termine proprement quand le master disparaît (canal IPC fermé, PID parent absent) et quand une autre instance est déjà enregistrée (HTTP 409), ce qui évite les GUI orphelines.

`shared/render.ts` contient le rendu SVG d'un élément, `shared/tree.ts` la résolution de la hiérarchie en coordonnées document, `shared/node-defaults.ts` les valeurs par défaut et `shared/icons/` la bibliothèque d'icônes. Tous sont importés **à la fois** par l'exporteur côté serveur et par le canvas côté navigateur : ce que l'utilisateur voit est exactement ce que `export_design` — et donc `screenshot_design`, qui rasterise ce même SVG via resvg — produit.

Les invariants de hiérarchie — parent existant et de type `group`, absence de cycle, taille des groupes recalculée, ordre préfixe — sont appliqués dans `DesignStore.mutate`, donc sur **tout** chemin d'écriture : outil MCP comme sauvegarde depuis la GUI.

**Limite assumée de cette version** : un groupe se déplace, se pivote et change d'opacité, mais ne se redimensionne pas — mettre son contenu à l'échelle demanderait de propager un facteur dans tout le sous-arbre, ce qui dépasse le cadre d'un premier jet sobre.

---

## Développement

```bash
npm install
npm run build           # backend (tsc) + GUI (vite)
npm test                # suite complète
npm run generate-icons  # refige shared/icons/ après une mise à jour de lucide-static
```

La suite comprend :

- des tests unitaires du store, de la fabrique d'éléments, du moteur de diff et de l'export ;
- des tests des outils MCP appelés directement ;
- une suite de bout en bout (`test/e2e.test.ts`) qui lance un vrai serveur MCP sur stdio, attend l'enregistrement de son worker auprès du proxy, puis vérifie l'aller-retour complet agent → GUI → agent.

La suite de bout en bout a besoin du proxy (`http://localhost:3000`, ou `E2E_PROXY_URL`). S'il est absent, elle est ignorée plutôt qu'en échec.

Pour inspecter le worker sans traverser le proxy, ajoutez `?__direct=1` à son port local : les assets ne sont alors pas préfixés par le chemin de montage.

### Méta-configurations du proxy

`mcp-design` n'expose pas `GET /api/configurations` : il n'a pas de configuration métier (ni token, ni identifiant de ressource) qui justifierait des profils. Le proxy ignore simplement les MCPs qui n'implémentent pas ces routes.
