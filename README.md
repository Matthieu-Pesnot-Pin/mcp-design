# @imenam/mcp-design

Un canvas de design pilotable par un agent, avec une interface graphique où l'utilisateur reprend la main.

L'agent compose une planche (formes, texte) via des outils MCP. L'utilisateur ouvre la GUI, déplace, retaille, recolore, réécrit. L'agent relit ensuite **exactement ce qui a changé** et l'intègre dans le code de l'application.

L'utilisateur peut aussi, sans toucher au design, **épingler des remarques** sur une page, un élément ou une zone. Il les transmet en un retour nommé que l'agent lit avec `get_feedback`, captures comprises ; l'agent déclare ensuite ce qu'il a traité avec `mark_feedback_processed`, et l'utilisateur suit l'avancement de chaque retour dans la page « Retours ».

```
Agent ──add_nodes/update_nodes──▶  Design  ◀──glisser-déposer──  Utilisateur (GUI)
  ▲                                                                    │
  ├──────────── get_changes ──── diff depuis la dernière baseline ──────┤
  └──────────── get_feedback ─── remarques transmises (retour n°N) ─────┘
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

Deux flags permettent de choisir directement comment la GUI sera exposée, sans éditer le JSON ensuite :

```bash
# GUI derrière le proxy central
npx -y @imenam/mcp-design --claude-setup-mcp --proxy_url=http://localhost:3000

# GUI en accès direct, sans proxy : http://localhost:4500
npx -y @imenam/mcp-design --claude-setup-mcp --app_port=4500
```

Les deux flags sont exclusifs — la commande échoue si les deux sont passés.

Exemple d'entrée générée :

```json
{
  "mcpServers": {
    "mcp-design": {
      "command": "npx",
      "args": ["-y", "@imenam/mcp-design"],
      "env": {
        "PROXY_URL": "http://localhost:3000",
        "APP_PORT": "",
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
| `PROXY_URL` | URL du [proxy central](https://github.com/imenam/proxy-setup) : le proxy attribue le port et monte la GUI sous `APP_PATH`. |
| `APP_PORT` | Port local utilisé **quand `PROXY_URL` est absent** : la GUI est servie directement sur `http://localhost:<port>`, à la racine. Permet d'utiliser l'interface sans le hub de centralisation. |
| `APP_PATH` | Chemin de montage de la GUI derrière le proxy (défaut `/design-gui`). Ignoré en mode `APP_PORT`. `PROXY_APP_PATH` puis `GUI_PATH` sont acceptés en repli. |
| `APP_NAME` | Nom affiché dans le dashboard du proxy. `PROXY_APP_NAME` puis `GUI_NAME` sont acceptés en repli. |
| `APP_PATH_PREFIX` | Préfixe de namespace ajouté au chemin **par défaut** (ex. `/abc123` → `/abc123/design-gui`). Sert à isoler plusieurs instances sous un même proxy. |
| `APP_GROUP` | Section repliable du dashboard du proxy (facultatif). |
| `MCP_DESIGN_DATA_DIR` | Répertoire de stockage des designs et des remarques. `MCP_DATA_DIR` est accepté en repli. Défaut : `<package>/.design-data`. |
| `MCP_LOG_DIR` | Répertoire des logs. Défaut : `<data>/logs`. |

`PROXY_URL` et `APP_PORT` s'excluent : `PROXY_URL` prime si les deux sont renseignés. **Si aucune des deux n'est définie, la GUI est simplement désactivée** — les outils MCP continuent de fonctionner.

`APP_PATH` / `APP_NAME` sont les noms canoniques ; `PROXY_APP_*` puis `GUI_*` restent acceptés, dans cet ordre de priorité décroissante. La règle de `APP_PATH_PREFIX` est simple : **il ne préfixe que le chemin par défaut**. Dès que `APP_PATH` (ou l'un de ses replis) est renseigné, cette valeur est prise telle quelle, sans préfixe — la saisie manuelle l'emporte toujours. Les chemins sont normalisés (un seul `/` de séparation, pas de `/` final) et le préfixage est idempotent. Le `<base href>` de l'interface suit le chemin réellement enregistré, assets compris.

La résolution est assurée par le paquet partagé [`@imenam/mcp-gui-interface`](https://www.npmjs.com/package/@imenam/mcp-gui-interface), qui documente la règle en détail.

### Exposition réseau

La GUI écoute sur `127.0.0.1` uniquement, en mode proxy comme en mode `APP_PORT` : elle n'est pas joignable directement depuis une autre machine. Pour y accéder à distance, passez par le [proxy central](https://github.com/imenam/proxy-setup) ou le gateway manager, qui relaient vers `localhost:<port>`.

Chaque requête traverse la garde de [`@imenam/mcp-gui-interface`](https://www.npmjs.com/package/@imenam/mcp-gui-interface) (`honoGuiGuard`), qui répond `403` :

- à tout en-tête `Host` autre que `localhost`, `127.0.0.1` ou `::1` (protection contre le DNS rebinding) ;
- aux modifications (méthodes autres que `GET`, `HEAD`, `OPTIONS`) venues d'un autre site, d'après `Sec-Fetch-Site` ou, à défaut, `Origin` (sont admis : la machine elle-même, le proxy de `PROXY_URL`).

Un design est un simple fichier JSON dans `<data>/designs/<id>.json` — lisible, diffable, versionnable. Les images qu'il affiche sont dans `<data>/images/`.

---

## Les outils

### Planches

| Outil | Effet |
|---|---|
| `list_designs` | Liste les planches, leur taille, leur nombre d'éléments et le nombre de modifications non encore récupérées. |
| `create_design` | Crée une planche vide (`name`, et facultativement `width`, `height`, `background`). |
| `duplicate_design` | Crée une nouvelle planche reprenant toute une planche existante — dimensions, fond, éléments, groupes et instances. Les identifiants des éléments sont conservés ; `name` et `group` sont facultatifs (par défaut, le nom d'origine suivi de « (copy) » et le même groupe de pages). La copie part sans modification en attente. |
| `get_design` | Lit une planche : `format: "summary"` (inventaire compact, défaut) ou `format: "json"` (valeurs exactes). |
| `update_design` | Renomme la planche, change ses dimensions ou son fond. |
| `delete_design` | Supprime définitivement une planche. |

### Éléments

| Outil | Effet |
|---|---|
| `add_nodes` | Ajoute un ou plusieurs éléments par-dessus les autres. |
| `add_image` | Importe une image (chemin absolu d'un fichier PNG, JPEG, GIF, WebP ou SVG) et la pose par-dessus les autres éléments. |
| `update_nodes` | Patche des éléments existants — seuls les champs fournis changent. |
| `delete_nodes` | Supprime des éléments par identifiant. Supprimer un groupe emporte son contenu. |
| `duplicate_nodes` | Copie des éléments ou des groupes avec tout leur contenu, sous de nouveaux identifiants. `offset_x`/`offset_y` et `count` disposent une série de copies, `parent_id` les dépose dans un groupe. Avec `target_design_id`, la copie va dans une **autre planche** : les éléments gardent leur position à l'écran, et les composants reproduits par les instances copiées sont copiés avec elles, une seule fois, à la racine. |
| `group_nodes` | Enveloppe des éléments dans un nouveau groupe, sans rien déplacer à l'écran. |
| `ungroup_nodes` | Dissout des groupes : leur contenu remonte d'un niveau, toujours sans bouger. |
| `detach_instances` | Rompt le lien d'une instance avec son composant : son contenu devient des éléments ordinaires. |

Huit types d'éléments : `rect`, `ellipse`, `line`, `text`, `icon`, `image`, `group` et `instance`. Seul `type` est obligatoire — sauf pour `icon`, qui a besoin du nom de l'icône, et `image`, qui a besoin du nom d'une image importée ; tout le reste tombe sur des valeurs par défaut visibles, donc `{ "type": "rect" }` suffit à créer quelque chose qu'on voit à l'écran.

**Champs communs** — `name`, `parentId`, `x`, `y`, `width`, `height` (en pixels, origine en haut à gauche), `rotation` (degrés, autour du centre de la boîte), `opacity` (0–1).

**Toute longueur est en pixels**, sans exception : `x`, `y`, `width`, `height`, `strokeWidth`, `radius`, `fontSize` et `lineHeight`. Chaque champ porte sa description et son unité dans [`shared/node-fields.ts`](shared/node-fields.ts), d'où le schéma zod **et** l'`inputSchema` MCP les tirent tous les deux — une unité n'est écrite qu'à un seul endroit.

| Type | Champs propres |
|---|---|
| `rect` | `fill`, `stroke`, `strokeWidth`, `radius` |
| `ellipse` | `fill`, `stroke`, `strokeWidth` |
| `line` | `stroke`, `strokeWidth` — le trait va de `(x, y)` à `(x + width, y + height)`, donc les deltas négatifs encodent la direction |
| `text` | `text`, `color`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `textAlign`, `lineHeight` (en px) |
| `icon` | `icon` (obligatoire — le nom du dessin), `fill`, `stroke`, `strokeWidth` |
| `image` | `image` (obligatoire — le nom de l'image dans la médiathèque), `fit` (`cover` par défaut, `contain`, `fill`) |
| `group` | aucun — c'est un pur conteneur |
| `instance` | `componentId` (obligatoire — le groupe reproduit) ; rien d'autre, son apparence vient de ce groupe |

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

### Images

`add_image` pose une vraie image — photo, logo, illustration, capture — là où une icône ou des formes ne suffisent pas.

```json
{ "design_id": "landing", "file_path": "C:/projets/site/assets/hero.jpg", "x": 0, "y": 80, "width": 1440 }
```

- **Le fichier est copié** dans `<MCP_DESIGN_DATA_DIR>/images/`, sous un nom tiré de l'empreinte de son contenu (`img_3f9a1c2b7d4e5f60.jpg`). Le design ne stocke que ce nom : le JSON reste lisible, une même image importée deux fois n'est stockée qu'une fois, et la planche ne dépend plus de l'emplacement du fichier d'origine. La médiathèque est commune à toutes les planches du dossier de données.
- **Taille** : sans `width` ni `height`, la boîte prend les dimensions naturelles de l'image ; avec une seule des deux, l'autre suit ses proportions.
- **`fit`** dit comment l'image remplit sa boîte : `cover` la remplit en rognant le débordement, `contain` la montre en entier, `fill` l'étire.
- **Réutiliser une image** : la réponse d'`add_image` donne son nom ; un nœud `{ "type": "image", "image": "img_…" }` dans `add_nodes` la repose sans second import. Un nom absent de la médiathèque est refusé à l'écriture.
- Le format est reconnu d'après le contenu du fichier, pas d'après son extension ; 20 Mo au plus.
- Derrière [`@imenam/mcp-http-gateway`](https://www.npmjs.com/package/@imenam/mcp-http-gateway), l'outil déclare la paire `file_path` / `file_content` : le relais lit le fichier sur la machine de l'agent et en transmet le contenu (dossier autorisé par `GATEWAY_INLINE_ROOTS`).

Le canvas charge les images depuis le worker (`GET /api/images/<nom>`). `screenshot_design`, les captures des remarques et `export_design` les intègrent en data URI : un export `svg`, `html` ou `jsx` s'ouvre tel quel, sans la médiathèque — mais il pèse le poids des images qu'il contient ; pour une planche illustrée, préférez `destination_path` à un retour en ligne.

Dans la GUI, une image se déplace, se redimensionne et se pivote comme les autres éléments ; l'inspecteur règle son cadrage.

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

#### La boîte d'un texte épouse son texte

Le bloc de lignes est **centré verticalement dans la boîte** du nœud : c'est ce qui permet de centrer un libellé dans un bouton sans calculer de décalage. Encore faut-il que la boîte soit celle qu'on croit — une hauteur par défaut plus grande que le texte le fait descendre sous le point posé.

Donc : **un nœud `text` créé sans `height` prend la hauteur exacte de son texte** (`lignes x lineHeight`). Le centrage n'a alors plus rien à décaler, et la première ligne commence bien à `y`, à gauche de `x`. Ajouter une ligne agrandit la boîte au lieu de la faire déborder : une boîte qui épousait son texte continue de l'épouser, à chaque changement de `text`, `fontSize` ou `lineHeight`, à l'écriture par l'agent comme à l'édition dans la GUI.

Une hauteur **explicite**, elle, n'est jamais retouchée — c'est le geste qui dit « centre ce libellé » :

```jsonc
{ "type": "text", "x": 40, "y": 120, "text": "Titre", "fontSize": 32 }          // boîte = 43.2px, texte posé à y
{ "type": "text", "x": 40, "y": 100, "height": 26, "text": "OK", "fontSize": 12 } // libellé centré dans son bouton
```

### Groupes réutilisables

Quand un même bloc revient plusieurs fois — une carte, une ligne de liste, un bouton —, il ne se recopie pas : il se **construit une fois** en groupe, puis s'**instancie**. Une `instance` ne stocke aucun contenu, seulement l'identifiant du groupe qu'elle reproduit ; le sous-arbre est reconstitué au rendu. Éditer le groupe met donc à jour **toutes** ses instances d'un coup, et un bloc répété reste une seule chose à lire et à modifier. C'est le fonctionnement d'un composant principal dans Figma.

```jsonc
// 1. le composant : un groupe ordinaire
{ "type": "group", "id": "card", "name": "Carte" }
// 2. ses copies liées
{ "type": "instance", "componentId": "card", "x": 320, "y": 80 }
{ "type": "instance", "componentId": "card", "x": 640, "y": 80 }
```

Règles, volontairement peu nombreuses :

- **Rien ne se surcharge dans une instance** — c'est ce qui garantit qu'elles restent identiques. Sa position, sa rotation et son opacité lui appartiennent ; tout le reste vient du composant. Une copie qui doit diverger devient un second groupe, ou se détache (`detach_instances`).
- La **taille** d'une instance est déduite de son composant, comme celle d'un groupe.
- Changer `componentId` **échange** l'instance de composant (le *swap* de Figma).
- Les instances s'**imbriquent** (une instance de carte contenant une instance de bouton), mais un composant ne peut pas se contenir lui-même : le cas est refusé à l'écriture.
- Un groupe encore instancié ne peut être ni supprimé ni dissous — il faut d'abord détacher ou supprimer ses instances.
- Détacher une instance ne détache **pas** les instances imbriquées dans son composant : elles restent liées.

Côté agent, le gain se lit dans `get_changes` : une retouche du composant apparaît comme **un** changement, pas comme N copies modifiées.

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
| `export_design` | Rend la planche en `html`, `jsx`, `svg`, `json` ou `summary`. `destination_path` + `filename` écrivent un fichier **sur la machine de l'agent** au lieu de renvoyer le contenu. |
| `screenshot_design` | Rasterise la planche en PNG et le renvoie **en image** à l'agent. `node_id` cadre la capture sur un groupe (ou n'importe quel élément), `scale` zoome, `padding` ajoute de la marge, `destination_path` + `filename` écrivent un `.png` **sur la machine de l'agent** au lieu de renvoyer l'image. |

> **Où le fichier est écrit.** `destination_path` est un **dossier absolu** sur la machine de l'agent, `filename` le nom que le fichier y prend. Omis, les deux outils se comportent comme avant : le contenu (ou l'image) revient dans la réponse, sans fichier.
>
> En stdio, ce MCP tourne à côté de l'agent et écrit lui-même. Derrière [`@imenam/mcp-http-gateway`](https://www.npmjs.com/package/@imenam/mcp-http-gateway), il tourne sur la machine du gateway et ne peut pas atteindre le disque de l'agent : il déclare alors la paire `destination_path` / `destination_relay`, renvoie les octets, et le relais — qui tourne, lui, sur la machine de l'agent — les y écrit. `destination_relay` est rempli par le relais, jamais par l'agent, et cette voie exige `GATEWAY_INLINE_WRITE_ROOTS` dans le bloc `env` du relais.

**`get_changes` n'acquitte jamais ce qu'il montre.** Seul `mark_synced` déplace la baseline, et il ne doit être appelé qu'une fois les modifications réellement reportées dans le code. Un simple appel de lecture ne peut donc pas faire disparaître un diff que l'agent n'a pas encore traité.

### Lire les remarques de l'utilisateur

| Outil | Effet |
|---|---|
| `get_feedback` | Renvoie le plus ancien retour qui a encore des remarques à traiter (le dernier quand tout est traité), ou celui demandé par `round`. Pour chaque remarque : son identifiant, la page, puis la page entière, l'élément visé (id, nom, chemin, boîte) ou la zone et les éléments cités, le texte et son état de traitement. Les captures d'éléments et de zones suivent **en images**, numérotées comme dans le texte ; `captures: false` les omet. La réponse se termine par la liste de tous les retours et de leur avancement. |
| `mark_feedback_processed` | Déclare traitées des remarques d'un retour (`round`, `remark_ids` — toutes si omis), avec une `note` sur ce qui a été fait. C'est ce que l'utilisateur voit dans la page « Retours ». |

Un retour est **figé** au moment où l'utilisateur clique sur « Terminer les retours » : `get_feedback` peut le relire autant de fois que nécessaire, rien ne change. Seuls son nom (renommable dans la GUI) et le suivi du traitement évoluent ; **lire un retour ne le marque jamais traité**, seul `mark_feedback_processed` (ou l'utilisateur) le fait. Le texte est celui que la GUI affiche en aperçu avant l'enregistrement — même fonction de mise en forme, donc même contenu. Tant qu'aucun retour n'existe, l'outil dit combien de remarques attendent encore dans la GUI.

Les remarques vivent dans `<MCP_DESIGN_DATA_DIR>/feedback/remarks.json`, les captures PNG dans `<MCP_DESIGN_DATA_DIR>/feedback/captures/` : le même dossier de données que les designs, celui fixé par la configuration du projet.

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

  … l'utilisateur passe en mode Remarques, commente, clique « Terminer les retours »,
    puis dit à l'agent qu'il a terminé …

get_feedback  {}                              ← retour à traiter : remarques + captures
  … l'agent applique les remarques …
mark_feedback_processed { round: 1, remark_ids: ["rm_…"], note: "…" }   ← suivi visible dans la GUI
```

---

## L'interface

Trois colonnes : la liste des planches, le canvas, l'inspecteur et les calques.

- **Pages** — la barre de gauche présente l'arbre des groupes : chevron, dossier ouvert ou fermé et nombre de pages par groupe, avec un trait vertical qui relie chaque niveau à son parent. À chaque niveau, les sous-groupes viennent d'abord, puis les pages, chacun par ordre alphabétique ; les pages hors groupe sont regroupées en bas sous « Hors groupe ». À l'ouverture, l'interface rouvre la dernière page consultée dans ce navigateur (mémorisée localement, propre à chaque poste) ; à défaut, la première page de la liste.
  - **Groupe affiché** — le sélecteur en tête montre « Tous les groupes » ou un seul groupe de premier niveau, avec son nombre de pages et de pages à synchroniser. Le choix est mémorisé dans le navigateur.
  - **Recherche et filtres** — le champ de recherche porte sur les noms de pages et de dossiers, à toute profondeur, sans tenir compte des accents ni de la casse (`Échap` le vide) : un dossier dont le nom correspond reste affiché en entier, sinon seules ses pages et sous-dossiers qui correspondent restent. Les filtres « Toutes », « À synchroniser » et « Remarques » (remarques non transmises) portent leur compteur. Une recherche ou un filtre actif déplie tous les groupes.
  - **Tout replier** — le bouton à droite de la recherche replie tous les dossiers du groupe affiché ; quand ils le sont déjà tous, il les déplie. Il est inactif pendant une recherche ou un filtre, qui gardent tout déplié.
  - **Cartes de page** — un aperçu aux proportions de la planche, le nom, le format et la date de dernière modification ; à droite, la bulle violette des remarques non transmises et le point ambre des modifications à synchroniser. Le menu « … », visible au survol, propose **Déplacer vers…** (vide : hors groupe), **Dupliquer** (la copie s'ouvre aussitôt) et **Supprimer**. Une page se range aussi par glisser-déposer sur un groupe.
  - **Nouvelle page** — le bouton en pied ouvre le formulaire de création ; le groupe est prérempli avec le groupe affiché.

- **Outils** — sélection, rectangle, ellipse, ligne, texte, icône. Glisser pour dimensionner, cliquer pour poser à la taille par défaut. L'outil icône ouvre d'abord son sélecteur : poser une icône suppose d'avoir choisi laquelle.
- **Édition** — déplacement au glisser, 8 poignées de redimensionnement (2 extrémités pour une ligne), sélection multiple au rectangle d'encadrement ou au Maj+clic.
- **Groupes** — `Ctrl+G` groupe la sélection, `Ctrl+Maj+G` la dissout. Un clic dans le canvas sélectionne le **groupe le plus haut** ; `Alt+clic` vise l'élément exact à l'intérieur. Déplacer un groupe déplace tout son contenu.
- **Texte** — double-clic pour éditer en place, avec la même métrique qu'au rendu final. Une boîte à la taille de son texte le reste : ajouter une ligne l'agrandit d'autant.
- **Inspecteur** — position, taille, rotation, opacité, couleurs, épaisseur, arrondi, contenu, taille et graisse de police, interligne (en px), alignement, choix de l'icône. Pour un groupe, la taille est affichée en lecture seule puisqu'elle suit son contenu ; pour une icône, un seul champ de taille, puisqu'elle est carrée.
- **Calques** — arbre repliable, ordre d'empilement, sélection, montée/descente d'un cran.

### Naviguer dans la planche

- **Zoom** : `Ctrl`/`Cmd` + molette, ancré sous le curseur — le point visé ne bouge pas.
- **Déplacement** : molette seule, ou **barre espace maintenue + glisser**. Tant que la barre espace est enfoncée, aucun geste ne peut déplacer un élément, même en partant de l'un d'eux. Le clic molette fait la même chose.
- Le sélecteur de zoom de la barre d'outils reste disponible pour revenir à une valeur ronde.

Raccourcis : `V` `R` `O` `L` `T` `I` (outils), `Ctrl+Z` / `Ctrl+Y` (annuler/rétablir), `Ctrl+G` / `Ctrl+Maj+G` (grouper / dissoudre), `Ctrl+D` (dupliquer), `Ctrl+A` (tout sélectionner), `Suppr`, flèches (déplacer d'1 px, 10 px avec `Maj`), `Échap`.

La sauvegarde est automatique et différée. Une modification faite par l'agent pendant que la GUI est ouverte y apparaît dans les 3 secondes : la GUI interroge `GET /api/changes` toutes les 3 s ; une modification faite dans la GUI est enregistrée comme venant de l'utilisateur, et c'est ce que `get_changes` restitue.

Le point ambre d'une page indique qu'elle porte des modifications que l'agent n'a pas encore acquittées avec `mark_synced` ; leur nombre s'affiche au survol.

### Mode Remarques

La bascule **Édition / Remarques** de la barre d'outils (raccourci `M`) passe le canvas en lecture : rien ne s'y déplace, et le rail de droite affiche les remarques à la place de l'inspecteur.

- **Remarque sur un élément** — un clic vise le **groupe le plus haut**, comme en édition ; un nouveau clic à l'intérieur descend d'un niveau, `Alt+clic` vise l'élément exact. La bulle de saisie affiche le chemin de l'élément : un clic sur un niveau vise ce parent.
- **Remarque sur une zone** — glisser trace un rectangle. La bulle montre l'aperçu de la zone et les **éléments détectés** : un élément entièrement compris est cité tel quel, un groupe qui déborde est ouvert pour citer ceux de ses éléments que la zone touche, un élément qui déborde est marqué « en partie » et décoché par défaut.
- **Remarque sur la page** — depuis le panneau, une seule remarque en cours par page.
- **Captures** — pour un élément ou une zone, « Joindre une capture » (coché par défaut) enregistre un PNG de ce que l'utilisateur commentait, rendu par le serveur au moment de la remarque.
- **Pastilles** — chaque remarque d'élément ou de zone porte un numéro sur la planche ; survoler une carte du panneau met sa cible en évidence, cliquer une pastille désigne sa carte.
- **Terminer les retours** — demande un **nom** pour le retour (« Retour n°N » proposé), choisit le périmètre (cette page ou toutes) et les remarques à transmettre, et montre exactement le texte que l'agent recevra. L'enregistrement fige un **retour numéroté et nommé**.
- **Après l'envoi** — les remarques restent visibles en lecture seule, marquées « Transmise · *nom du retour* », puis « Traitée » une fois traitées : pastille creuse, zone en pointillés. Une case du panneau les masque. Une remarque dont l'élément a disparu depuis le signale.

### Page « Retours »

Le bouton **Retours** de la barre d'outils (avec le nombre de retours pas encore entièrement traités) ouvre la liste de tous les retours, du plus récent au plus ancien, chacun avec son état — *À traiter*, *En cours* (n/total), *Traité* — et une barre d'avancement. Le détail d'un retour reprend ses remarques page par page, avec leur capture, et pour chacune : *À traiter*, ou *Traitée par l'agent / par vous* avec la date et la note de l'agent. Le nom du retour se modifie en place ; une case coche ou rouvre une remarque à la main, et « Tout marquer comme traité » (ou « Tout rouvrir ») agit sur tout le retour affiché ; le même bouton en haut de la page traite d'un coup tous les retours en attente, après confirmation. Une remarque déjà traitée par l'agent garde son auteur et sa note ; « Ouvrir la page » ramène sur la planche en mode Remarques. `Échap` ferme la page.

Les retours créés avant l'arrivée des noms reçoivent « Retour n°N », et aucune de leurs remarques n'est considérée comme traitée.

`Ctrl+Entrée` enregistre une remarque, `Échap` la ferme, puis quitte le mode. Le badge violet d'une page dans la liste compte ses remarques non transmises.

---

## Architecture

Deux processus, conformément au standard de l'écosystème (`@imenam/mcp-gui-interface`) :

- **MCP Master** (`src/index.ts`) — protocole JSON-RPC sur stdio, stockage des designs, cycle de vie du worker via `GuiLauncher`.
- **GUI Worker** (`src/gui-worker.ts`) — serveur Hono, enregistrement auprès du proxy via `ProxyClient`, API REST, sert la SPA React.

Les deux communiquent par IPC. Les évènements que le master pousse au worker (`DESIGNS_UPDATED`, `DESIGN_UPDATED`, `REMARKS_UPDATED`) entrent dans un journal en mémoire, numéroté et limité aux 200 dernières entrées. La GUI le relit toutes les 3 s par `GET /api/changes?since=<seq>&epoch=<epoch>`, qui répond immédiatement : aucune connexion ne reste ouverte, ce qui laisse libres les connexions que le navigateur accorde à l'origine du proxy, partagée par toutes les GUI. La réponse vaut `{ epoch, seq, reset: false, events }` avec les évènements postérieurs à `since`, ou `{ epoch, seq, reset: true }` quand la position du client n'est pas exploitable (premier appel, worker redémarré, entrées déjà sorties du journal) : la GUI recharge alors la liste des pages, les remarques et la page ouverte. Un `since` qui n'est pas un entier positif ou nul est refusé (400). Le worker se termine proprement quand le master disparaît (canal IPC fermé, PID parent absent) et quand une autre instance est déjà enregistrée (HTTP 409), ce qui évite les GUI orphelines.

`shared/feedback.ts` porte le modèle des remarques, la détection des éléments d'une zone et la mise en forme d'un retour ; le serveur et la GUI l'importent tous deux, ce qui garantit que l'aperçu affiché est le texte transmis. `shared/render.ts` contient le rendu SVG d'un élément, `shared/tree.ts` la résolution de la hiérarchie en coordonnées document, `shared/instances.ts` l'expansion des instances en groupes, `shared/node-defaults.ts` les valeurs par défaut et `shared/icons/` la bibliothèque d'icônes. Tous sont importés **à la fois** par l'exporteur côté serveur et par le canvas côté navigateur : ce que l'utilisateur voit est exactement ce que `export_design` — et donc `screenshot_design`, qui rasterise ce même SVG via resvg — produit.

Les invariants de hiérarchie — parent existant et de type `group`, absence de cycle (y compris dans le graphe composant/instance), taille des groupes et des instances recalculée, ordre préfixe — sont appliqués dans `DesignStore.mutate`, donc sur **tout** chemin d'écriture : outil MCP comme sauvegarde depuis la GUI.

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
- des tests d'exposition réseau (`test/network-exposure.test.ts`) qui lancent le worker GUI en mode `APP_PORT` et vérifient l'écoute sur `127.0.0.1` seul, le refus d'un `Host` étranger et des modifications cross-site, et l'acceptation des requêtes relayées par le proxy ;
- une suite de bout en bout (`test/e2e.test.ts`) qui lance un vrai serveur MCP sur stdio, attend l'enregistrement de son worker auprès du proxy, puis vérifie l'aller-retour complet agent → GUI → agent.

La suite de bout en bout a besoin du proxy (`http://localhost:3000`, ou `E2E_PROXY_URL`). S'il est absent, elle est ignorée plutôt qu'en échec.

Pour inspecter le worker sans traverser le proxy, ajoutez `?__direct=1` à son port local : les assets ne sont alors pas préfixés par le chemin de montage.

### Méta-configurations du proxy

`mcp-design` n'expose pas `GET /api/configurations` : il n'a pas de configuration métier (ni token, ni identifiant de ressource) qui justifierait des profils. Le proxy ignore simplement les MCPs qui n'implémentent pas ces routes.
