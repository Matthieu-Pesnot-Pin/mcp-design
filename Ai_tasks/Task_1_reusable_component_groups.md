# Task 1 — Groupes réutilisables (composants et instances)

**Date :** 01/09/2026
**Projet :** `mcp-design`
**Objectif :** Permettre à l'agent de définir **un groupe une seule fois** puis d'en insérer des **copies liées** (instances). Toute modification du groupe source se propage immédiatement à toutes ses instances. Aujourd'hui l'agent recopie intégralement chaque répétition (`duplicate_nodes`), ce qui gonfle le fichier, alourdit `get_changes` et rend toute retouche N fois plus coûteuse.

**Organisation du document :** par **thématique verticale** (modèle → expansion → invariants → outils MCP → GUI → tests) plutôt que back/front. La fonctionnalité repose sur une seule notion — l'expansion des instances — partagée par le serveur MCP et la GUI via `shared/` ; la découper en « back » et « front » séparerait artificiellement du code qui est littéralement le même module.

---

## 1. Vérification préalable : comment ça marche dans Figma

Comportement réel (sources : [Apply changes to instances](https://help.figma.com/hc/en-us/articles/360039150733-Apply-changes-to-instances), [Edit main components](https://help.figma.com/hc/en-us/articles/360038665934-Edit-main-components), [How We Rebuilt the Foundations of Component Instances](https://www.figma.com/blog/how-we-rebuilt-the-foundations-of-component-instances/)) :

1. **Main component / instance.** Un frame est promu en *main component*. Chaque *instance* est un nœud qui référence ce main component ; elle n'a pas de contenu propre stocké, son sous-arbre est résolu à l'exécution.
2. **Propagation descendante immédiate.** Toute édition du main component (ajout, suppression, déplacement, style) se répercute sur toutes les instances du même fichier instantanément.
3. **Structure verrouillée dans l'instance.** On ne peut pas modifier, dans une instance : l'ordre/z-index des calques, la position des calques internes, les contraintes, l'ajout ou la suppression d'enfants. Seules la position/taille de l'instance elle-même sont libres.
4. **Overrides.** Sur les calques internes, on peut surcharger le texte, les remplissages, les contours, les effets, le nom de calque. Un override survit aux mises à jour du main component (le champ surchargé cesse simplement de suivre) et est réapparié par **nom de calque + hiérarchie**.
5. **Push overrides to main.** Renvoie les surcharges d'une instance vers le main component (même fichier uniquement).
6. **Detach instance.** Rompt le lien : le sous-arbre devient des nœuds ordinaires, éditables librement, et ne reçoit plus les mises à jour.
7. **Instances imbriquées** autorisées ; une instance de soi-même (récursion) est interdite.

### Ce qu'on retient pour la v1 — et ce qu'on écarte

| Figma | v1 mcp-design | Pourquoi |
|---|---|---|
| Main component = frame promu | **N'importe quel groupe existant** fait office de source, sans champ ni promotion | Zéro champ supplémentaire, zéro nouvel outil de création. Le groupe est déjà le bon objet. |
| Instance = nœud référençant la source | **`type: "instance"` + `componentId`** | Un seul nouveau type de nœud, une seule nouvelle propriété. |
| Propagation immédiate | Idem (totale) | C'est exactement la demande. |
| Structure verrouillée | Idem, par construction : le sous-arbre n'existe pas en stockage | Gratuit. |
| **Overrides par calque** | ❌ **hors périmètre v1** | Coût sans commune mesure : table de surcharges par instance, réappariement par chemin de calque, arbitrage dans le diff, UI de « reset override ». La demande est « toutes les modifications se propagent » — donc propagation totale. Un besoin de variante se traite par un **second composant** ou par **`detach_instances`**. À reconsidérer en v2 si le besoin apparaît. |
| Push overrides to main | ❌ (sans objet sans overrides) | — |
| Detach | ✅ `detach_instances` | Indispensable : c'est la soupape quand une copie doit diverger. |
| Instances imbriquées | ✅, avec garde anti-récursion | Une carte contenant une instance de bouton est le cas d'usage principal. |
| Swap instance | ✅ gratuitement : `update_nodes` sur `componentId` | Un champ déjà patchable. |

---

## 2. Principe technique

Le stockage reste **une liste plate de nœuds** (cf. l'en-tête de `shared/schemas/design.schema.ts`). Une instance est **un seul nœud stocké**, feuille, sans enfants :

```json
{ "id": "n_ab12", "type": "instance", "componentId": "g_card", "name": "Carte 2",
  "parentId": null, "x": 320, "y": 80, "width": 0, "height": 0, "rotation": 0, "opacity": 1 }
```

Le sous-arbre n'est **jamais persisté** : il est reconstruit à la volée par une fonction d'**expansion** appelée par tous les consommateurs de rendu. L'instance expansée devient un `group` ordinaire, ce qui laisse `computeLayout`, `nodeToSvg`, l'export HTML/JSX et le canvas **inchangés**.

C'est le point clé de la tâche : **une seule fonction nouvelle, insérée en amont des consommateurs existants.** Tout le reste n'est que branchement, garde-fous et UI.

Conséquence directe et voulue : `get_changes`/`diff` voit une instance comme **un seul nœud**, et une retouche du composant comme **un seul changement** — c'est le gain recherché.

---

## 3. Modèle de données (`shared/`)

Modifications additives uniquement → **aucune migration** (`src/core/migrate.ts` n'est pas touché ; les anciens fichiers restent valides).

### 3.1 `shared/schemas/design.schema.ts`
- `NODE_TYPES` : ajouter `"instance"`.
- Ajouter au `DesignNodeSchema` :
  ```ts
  componentId: z.string().describe(NODE_FIELD_DOCS.componentId).optional(),
  ```
- Compléter le commentaire d'en-tête du module : une instance est une feuille dont le contenu est résolu au rendu.

### 3.2 `shared/render.ts`
- `RenderNode.type` : ajouter `"instance"` ; ajouter `componentId?: string`.
- Aucune branche dans `nodeToSvg` : après expansion il n'existe plus de nœud `instance`. Ajouter tout de même un `return ""` défensif pour ce type.

### 3.3 `shared/node-defaults.ts`
- `NODE_KINDS` += `"instance"` ; `DRAWABLE_KINDS` **inchangé** (on ne dessine pas une instance à la souris).
- `NODE_DEFAULTS.instance = { width: 0, height: 0 }` (taille dérivée, comme un groupe).
- `NODE_STYLE_FIELDS.instance = []`.
- `LABELS.instance = "Instance"`.
- `clampNodeSize` : `instance` passe comme `group` (taille déduite).
- `GROUP_DERIVED_FIELDS` s'applique désormais aussi aux instances. **Ne pas renommer la constante** (elle est exportée et utilisée par `diff.ts` et `node-factory.ts`) : ajouter à côté
  ```ts
  /** Types dont width/height sont déduits du contenu et non écrits directement. */
  export const SIZE_DERIVED_KINDS: readonly NodeKind[] = ["group", "instance"];
  ```
  et remplacer les tests `type === "group"` par `SIZE_DERIVED_KINDS.includes(type)` dans `src/core/node-factory.ts` (`geometryFieldsFor`, message d'erreur de `applyPatch`) et `src/core/diff.ts` (filtre des champs dérivés).

### 3.4 `shared/node-fields.ts`
Ajouter la doc du champ — c'est elle que l'agent lit dans l'`inputSchema` :
```ts
componentId:
  "Instance nodes only: id of the GROUP this instance mirrors. The group's content is not copied — it is " +
  "resolved at render time, so editing the group updates every instance of it at once. Prefer one group plus " +
  "instances over duplicating the same block N times. Change it to swap the instance to another group.",
```
Et compléter `type` : `"Kind of node: rect, ellipse, line, text, group or instance."`

### 3.5 `shared/instances.ts` (nouveau — le cœur)

```ts
import type { RenderNode } from "./render.js";
import { childrenByParent } from "./tree.js";

/** Sépare l'id de l'instance de celui du nœud du composant : "n_ab12~n_title". */
export const INSTANCE_ID_SEPARATOR = "~";

/** Id de l'instance racine d'un nœud expansé, ou l'id lui-même s'il est réel. */
export function instanceRootOf(id: string): string;
/** Vrai si l'id désigne un nœud expansé (donc non stocké, non éditable). */
export function isExpandedId(id: string): boolean;

/**
 * Remplace chaque nœud `instance` par un `group` équivalent suivi d'une copie du
 * sous-arbre de son composant, ids préfixés par celui de l'instance.
 * Les instances imbriquées sont expansées récursivement.
 */
export function expandInstances<T extends RenderNode>(nodes: T[]): T[];
```

Règles d'implémentation :
- L'instance devient `{ ...instance, type: "group", componentId: undefined }` — sa position et sa rotation sont conservées, le contenu du composant devient ses enfants (coordonnées déjà relatives au groupe source, donc rien à recalculer).
- Les descendants copiés gardent tous leurs champs ; seuls `id` et `parentId` sont réécrits en `` `${instanceId}${SEP}${sourceNodeId}` ``.
- Le nœud groupe **source** reste dans la liste (il est visible sur la planche, comme un main component dans Figma).
- Récursion : passer un `Set` des `componentId` déjà en cours d'expansion sur la branche ; une source déjà présente est ignorée (et la garde de §4 empêche que ce cas se produise en stockage).
- Fonction pure, sans dépendance (importable depuis le bundle GUI comme depuis le serveur, au même titre que `tree.ts`).

### 3.6 Branchement des consommateurs

| Fichier | Point d'insertion |
|---|---|
| `shared/render.ts` | `documentToSvg` et `subtreeToSvg` : `const nodes = expandInstances(doc.nodes)` en première ligne (couvre le canvas SVG, `export_design` format svg et `screenshot_design` via `src/core/screenshot.ts`). |
| `src/core/export.ts` | `toRenderNodes` + `contextOf` : expanser une fois, et faire porter `children`/`layout`/`toHtml`/`toJsx`/`toSummary` sur la liste expansée. Pour `toSummary` uniquement : garder la liste **non expansée** et afficher `instance of "<nom du groupe>"` — c'est ce que l'agent doit lire. |
| `src/core/hierarchy.ts` | `recomputeGroupSizes` : calculer le layout sur `expandInstances(nodes)` puis n'écrire les tailles que sur les nœuds réels (`group` **et** `instance`). |
| `gui/src/components/Canvas.tsx` | `const nodes = useMemo(() => expandInstances(design?.nodes ?? []), [design])` — `layout` et `children` en découlent sans autre changement. |

---

## 4. Invariants (`src/core/hierarchy.ts`, `src/core/node-factory.ts`)

`validateHierarchy` est le passage obligé de toute mutation (`DesignStore.mutate` → `normalizeHierarchy`) : les trois règles y vont, pas ailleurs.

1. **`componentId` valide** : présent sur un nœud `instance`, absent sur les autres, et référençant un nœud **existant de type `group`** du même design. Message explicite (le style des `DesignError` existantes : dire quoi faire).
2. **Une instance est une feuille** : aucun nœud ne peut avoir une instance pour `parentId`. Déjà refusé par le contrôle `parent.type !== "group"` ; enrichir le message pour le cas `instance` (« l'ordre et la position à l'intérieur d'une instance ne sont pas modifiables — éditez le groupe source, ou détachez l'instance »).
3. **Pas de récursion** : en suivant les `componentId`, une instance ne doit jamais atteindre un groupe qui est l'un de ses propres ancêtres (ni son propre composant). Parcours du graphe `instance → composant → instances imbriquées` avec `Set` de visités.

Dans `node-factory.ts` :
- `buildNode` : `componentId` est obligatoire pour le type `instance` (erreur claire sinon) ; `width`/`height` non écrivables (déjà couvert par `SIZE_DERIVED_KINDS`).
- `applyPatch` : autoriser `componentId` sur une instance uniquement — c'est ce qui donne le « swap » gratuitement.

Et dans `src/tools/delete-nodes.ts` :
- **Refuser** la suppression d'un groupe encore instancié, en listant les instances concernées : `Group "g_card" is still used by 4 instance(s) (n_ab12, …). Delete them first, or detach them with detach_instances.` Supprimer silencieusement laisserait des instances pendantes ; cascader détruirait du design sans que l'agent l'ait demandé.

---

## 5. Outils MCP (`src/index.ts`, `src/tools/`)

### 5.1 Outils existants à ajuster
- **`add_nodes`** (`src/index.ts` ~ligne 488) : `enum` du champ `type` += `"instance"`. Ajouter `componentId` à la table `NODE_PROPERTIES` (~ligne 364) avec `NODE_FIELD_DOCS.componentId`. C'est le seul chemin de création d'une instance — pas de nouvel outil.
- **`update_nodes`** : rien à coder (`componentId` arrive via `NODE_PROPERTIES`), mais compléter la description : sur une instance, seuls nom/position/rotation/opacité/`parentId`/`componentId` sont modifiables.
- **`group_nodes`** : ajouter une phrase à la description — *« Group a block once, then insert copies of it with add_nodes { type: "instance", componentId } instead of duplicating it: editing the group then updates every copy. »*
- **`duplicate_nodes`** : ajouter le contre-pied dans la description — *« Use this for one-off copies that will diverge. For a block repeated identically (cards, list rows, buttons), create a group and instantiate it instead. »* C'est cette phrase qui change réellement le comportement de l'agent.
- **`delete_nodes`** : mentionner le refus décrit en §4.

### 5.2 Nouvel outil `detach_instances` — `src/tools/detach-instances.ts`
Signature : `{ design_id, node_ids: string[] }` (ids d'instances).
Méthode : pour chaque instance, expanser son sous-arbre via `expandInstances`, réattribuer des ids frais (`shortId("n"|"g")`, même logique de remap parent/enfant que `duplicateNodes`), remplacer le nœud `instance` par un `group` portant les mêmes nom/position/rotation/opacité, insérer le tout **à la place de l'instance** dans la liste (l'ordre d'empilement ne doit pas bouger).

> Le remap d'ids d'un sous-arbre existe déjà en double (`src/tools/duplicate-nodes.ts` et `gui/src/utils/nodes.ts:cloneSubtrees`). Pour éviter une **troisième** copie, extraire la version serveur dans `src/core/clone.ts` (`cloneSubtree(nodes, rootIds): DesignNode[]`, sans décalage x/y — le décalage reste dans `duplicateNodes`) et l'utiliser dans les deux outils.

Enregistrement : entrée dans la liste `TOOLS` + `case "detach_instances"` dans le dispatcher, en suivant strictement le motif des outils voisins (résultat `MutationResult`, message texte récapitulatif).

### 5.3 README
Ajouter une sous-section « Groupes réutilisables » dans la partie sur les nœuds : définir un groupe, l'instancier, le modifier une fois, détacher. Trois lignes de JSON suffisent.

---

## 6. GUI (`gui/src/`)

Respect des motifs en place : zustand + `commit()` pour toute mutation, `@shared/*` pour la géométrie, aucun style inline nouveau.

### 6.1 Canvas — `components/Canvas.tsx`
- `nodes` = `expandInstances(design.nodes)` (§3.6). `layout`, `children`, rendu et marquee suivent sans modification.
- **Sélection** : partout où un id de nœud issu du canvas entre dans le store (clic, marquee, double-clic), le mapper par `instanceRootOf` — cliquer dans une instance sélectionne l'instance, jamais son contenu. Les ids expansés ne doivent **jamais** atteindre `selectedIds`.
- **Édition de texte** : `setEditingText` refusé sur un id expansé (le texte appartient au composant).
- Poignées de redimensionnement : masquées pour une instance, comme pour un groupe (taille dérivée).

### 6.2 Panneau des calques — `components/LayerPanel.tsx`
- Ligne `instance` : pas de chevron, libellé « Instance », et le nom du composant en suffixe discret (`<span className="layer-count">` déjà stylé, ou un `.layer-badge` calqué dessus dans `gui/src/index.css`).
- Bouton « Dissoudre » (`ungroupSelected`) désactivé sur une instance ; l'action équivalente est « Détacher » dans l'inspecteur.

### 6.3 Inspecteur — `components/Inspector.tsx`
Pour une sélection d'un seul nœud `instance` :
- champs : Nom, X, Y, Rotation, Opacité ; L/H en lecture seule (réutiliser la branche `uniformType === 'group'` en l'élargissant à `instance`) ;
- ligne d'info « Instance de *<nom du groupe>* » + bouton **Modifier le composant** → `setSelection([componentId])` ;
- bouton **Détacher** → nouvelle action de store.

### 6.4 Store — `store/useDesignStore.ts`
- Nouvelle action `detachSelected()` : même algorithme que l'outil serveur, réutilisant `cloneSubtrees` (`gui/src/utils/nodes.ts`, sans décalage) et `expandInstances`, appliquée dans un `commit()`.
- `deleteSelected()` : bloquer la suppression d'un groupe encore instancié → `set({ error: '…' })` plutôt qu'une écriture que le serveur refusera de toute façon.
- `duplicateSelected()` / `groupSelected()` : rien à changer (une instance est une feuille, `cloneSubtrees` la copie telle quelle — la copie reste liée au même composant, ce qui est le comportement attendu).
- `patchNodes` : garde défensive ignorant les ids expansés.

---

## 7. Tests (`test/`)

Nouveau `test/instances.test.ts` (`node --test` sur `dist/test/*.test.js`, helpers de `test/helpers.ts`) :
1. expansion : un composant de 3 nœuds + 2 instances → 3 nœuds stockés + 2, et 9 nœuds rendus ;
2. propagation : `update_nodes` sur un nœud du composant change le SVG des deux instances ;
3. `get_changes` ne signale **qu'un** nœud modifié après cette édition ;
4. refus : `componentId` inexistant, composant non-`group`, récursion directe et indirecte, nœud enfanté par une instance, suppression d'un composant instancié ;
5. `detach_instances` : ids frais, rendu identique avant/après, édition ultérieure du composant sans effet ;
6. taille dérivée d'une instance correcte dans `computeLayout` ;
7. export HTML et `screenshot_design` d'un design contenant une instance imbriquée.

Compléter `test/export.test.ts` (cas instance) et `test/duplicate.test.ts` si `cloneSubtree` est extrait.

---

## 8. Livraison

- Pas de dépendance nouvelle, pas de modification de `package.json` **à la main** — version via `npm version patch` (script `release` existant).
- `npm run build` (backend + GUI) puis `npm test` avant publication.

---

## Ordre de réalisation conseillé

1. §3.1 → §3.5 (modèle + `shared/instances.ts`) et ses tests unitaires d'expansion.
2. §3.6 branchement des consommateurs + §4 invariants → le rendu et l'export fonctionnent bout en bout côté serveur.
3. §5 outils MCP (l'agent peut alors s'en servir).
4. §6 GUI.
5. §7 tests restants.
