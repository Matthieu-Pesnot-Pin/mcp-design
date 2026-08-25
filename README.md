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
| `delete_nodes` | Supprime des éléments par identifiant. |

Quatre types d'éléments : `rect`, `ellipse`, `line`, `text`. Seul `type` est obligatoire ; tout le reste tombe sur des valeurs par défaut visibles, donc `{ "type": "rect" }` suffit à créer quelque chose qu'on voit à l'écran.

**Champs communs** — `name`, `x`, `y`, `width`, `height` (en pixels, origine en haut à gauche), `rotation` (degrés, autour du centre de la boîte), `opacity` (0–1).

| Type | Champs propres |
|---|---|
| `rect` | `fill`, `stroke`, `strokeWidth`, `radius` |
| `ellipse` | `fill`, `stroke`, `strokeWidth` |
| `line` | `stroke`, `strokeWidth` — le trait va de `(x, y)` à `(x + width, y + height)`, donc les deltas négatifs encodent la direction |
| `text` | `text`, `color`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `textAlign`, `lineHeight` |

Le texte n'est **jamais re-wrappé automatiquement** : seuls les `\n` explicites créent une nouvelle ligne. Le comportement est ainsi identique à l'écran et à l'export.

Un lot est intégralement validé avant la moindre écriture : une entrée invalide ne laisse jamais un design à moitié modifié.

### Récupérer le travail de l'utilisateur

| Outil | Effet |
|---|---|
| `get_changes` | Liste tout ce qui a été ajouté, modifié, supprimé ou réordonné depuis la dernière baseline, champ par champ (`x: 40 -> 240`). |
| `mark_synced` | Fige l'état courant comme nouvelle baseline. |
| `export_design` | Rend la planche en `html`, `jsx`, `svg`, `json` ou `summary`. `output_path` écrit dans un fichier au lieu de renvoyer le contenu. |

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

get_changes   { design_id: "landing" }        ← ce qu'il a changé, champ par champ
export_design { design_id: "landing", format: "html" }
  … l'agent reporte les valeurs dans le code de l'application …
mark_synced   { design_id: "landing" }        ← acquittement
```

---

## L'interface

Trois colonnes : la liste des planches, le canvas, l'inspecteur et les calques.

- **Outils** — sélection, rectangle, ellipse, ligne, texte. Glisser pour dimensionner, cliquer pour poser à la taille par défaut.
- **Édition** — déplacement au glisser, 8 poignées de redimensionnement (2 extrémités pour une ligne), sélection multiple au rectangle d'encadrement ou au Maj+clic.
- **Texte** — double-clic pour éditer en place, avec la même métrique qu'au rendu final.
- **Inspecteur** — position, taille, rotation, opacité, couleurs, épaisseur, arrondi, contenu, taille et graisse de police, interligne, alignement.
- **Calques** — ordre d'empilement, sélection, montée/descente d'un cran.

Raccourcis : `V` `R` `O` `L` `T` (outils), `Ctrl+Z` / `Ctrl+Y` (annuler/rétablir), `Ctrl+D` (dupliquer), `Ctrl+A` (tout sélectionner), `Suppr`, flèches (déplacer d'1 px, 10 px avec `Maj`), `Échap`.

La sauvegarde est automatique et différée. Une modification faite par l'agent pendant que la GUI est ouverte y apparaît en direct, via SSE ; une modification faite dans la GUI est enregistrée comme venant de l'utilisateur, et c'est ce que `get_changes` restitue.

Le badge « n à synchroniser » d'une planche indique le nombre de modifications que l'agent n'a pas encore acquittées.

---

## Architecture

Deux processus, conformément au standard de l'écosystème (`@imenam/mcp-gui-interface`) :

- **MCP Master** (`src/index.ts`) — protocole JSON-RPC sur stdio, stockage des designs, cycle de vie du worker via `GuiLauncher`.
- **GUI Worker** (`src/gui-worker.ts`) — serveur Hono, enregistrement auprès du proxy via `ProxyClient`, API REST + SSE, sert la SPA React.

Les deux communiquent par IPC. Le worker se termine proprement quand le master disparaît (canal IPC fermé, PID parent absent) et quand une autre instance est déjà enregistrée (HTTP 409), ce qui évite les GUI orphelines.

`shared/render.ts` contient le rendu SVG d'un élément et `shared/node-defaults.ts` ses valeurs par défaut. Les deux sont importés **à la fois** par l'exporteur côté serveur et par le canvas côté navigateur : ce que l'utilisateur voit est exactement ce que `export_design` produit.

---

## Développement

```bash
npm install
npm run build          # backend (tsc) + GUI (vite)
npm test               # suite complète
```

La suite comprend :

- des tests unitaires du store, de la fabrique d'éléments, du moteur de diff et de l'export ;
- des tests des outils MCP appelés directement ;
- une suite de bout en bout (`test/e2e.test.ts`) qui lance un vrai serveur MCP sur stdio, attend l'enregistrement de son worker auprès du proxy, puis vérifie l'aller-retour complet agent → GUI → agent.

La suite de bout en bout a besoin du proxy (`http://localhost:3000`, ou `E2E_PROXY_URL`). S'il est absent, elle est ignorée plutôt qu'en échec.

Pour inspecter le worker sans traverser le proxy, ajoutez `?__direct=1` à son port local : les assets ne sont alors pas préfixés par le chemin de montage.

### Méta-configurations du proxy

`mcp-design` n'expose pas `GET /api/configurations` : il n'a pas de configuration métier (ni token, ni identifiant de ressource) qui justifierait des profils. Le proxy ignore simplement les MCPs qui n'implémentent pas ces routes.
