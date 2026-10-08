import type { Design, DesignNode } from "../../shared/schemas/design.schema.js";
import {
  DEFAULT_FONT_FAMILY,
  documentToSvg,
  escapeXml,
  iconElementToSvg,
  iconElementsOf,
  iconStyle,
  imageSource,
  normalizedBox,
  textLines,
  textMetrics,
  type RenderNode,
} from "../../shared/render.js";
import { ICON_GRID } from "../../shared/icons/index.js";
import { boundsOf, childrenByParent, computeLayout, type Box, type Layout } from "../../shared/tree.js";
import { expandInstances } from "../../shared/instances.js";
import type { ImageStore } from "./image-store.js";

export const EXPORT_FORMATS = ["svg", "html", "jsx", "json", "summary"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function toRenderNodes(design: Design): RenderNode[] {
  return design.nodes as unknown as RenderNode[];
}

/**
 * Noeuds tels qu'ils se rendent : chaque instance y est remplacee par une copie
 * du contenu de son composant. Les exports produisent donc du HTML/JSX complet,
 * la ou le fichier de design, lui, ne stocke qu'une reference.
 */
function toExpandedNodes(design: Design): DesignNode[] {
  return expandInstances(toRenderNodes(design)) as unknown as DesignNode[];
}

/** "Titre principal" -> "titre-principal" ; sert de nom de classe CSS. */
function cssClassName(node: DesignNode): string {
  const base = node.name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `d-${base || node.type}-${node.id.replace(/[^a-z0-9]/gi, "")}`;
}

/**
 * Position d'un élément **dans la div de son parent**.
 *
 * Un groupe est exporté comme une div positionnée sur la boîte englobante de son
 * contenu ; ses enfants sont donc décalés de cette boîte, ce qui produit du HTML
 * imbriqué directement réutilisable plutôt qu'une liste plate de coordonnées.
 */
function offsetWithin(layout: Layout, node: DesignNode, parentBox: Box | null): { left: number; top: number } {
  const box = boundsOf(layout, node.id);
  return { left: box.x - (parentBox?.x ?? 0), top: box.y - (parentBox?.y ?? 0) };
}

function nodeCss(node: DesignNode, layout: Layout, parentBox: Box | null): string[] {
  const declarations: string[] = ["position: absolute"];
  const offset = offsetWithin(layout, node, parentBox);

  if (node.type === "group") {
    const box = boundsOf(layout, node.id);
    declarations.push(
      `left: ${round(offset.left)}px`,
      `top: ${round(offset.top)}px`,
      `width: ${round(box.width)}px`,
      `height: ${round(box.height)}px`
    );
    if (node.rotation) declarations.push(`transform: rotate(${round(node.rotation)}deg)`);
    if (node.opacity < 1) declarations.push(`opacity: ${round(node.opacity)}`);
    return declarations;
  }

  if (node.type === "line") {
    // Une ligne se rend comme une barre pivotée autour de son point de départ :
    // c'est le seul type dont l'ancrage n'est pas le coin de la boîte englobante.
    const length = Math.hypot(node.width, node.height);
    const angle = (Math.atan2(node.height, node.width) * 180) / Math.PI;
    const thickness = round(node.strokeWidth ?? 1);
    const local = normalizedBox(node as unknown as RenderNode);
    // offset porte sur la boîte normalisée ; le trait part de son extrémité d'origine.
    const startLeft = offset.left + (node.x - local.x);
    const startTop = offset.top + (node.y - local.y);
    declarations.push(
      `left: ${round(startLeft)}px`,
      `top: ${round(startTop - thickness / 2)}px`,
      `width: ${round(length)}px`,
      `height: ${thickness}px`,
      `background: ${node.stroke ?? "#000000"}`,
      `transform: rotate(${round(angle + node.rotation)}deg)`,
      "transform-origin: 0 50%"
    );
  } else {
    const box = boundsOf(layout, node.id);
    declarations.push(
      `left: ${round(offset.left)}px`,
      `top: ${round(offset.top)}px`,
      `width: ${round(box.width)}px`,
      `height: ${round(box.height)}px`
    );
    if (node.rotation) declarations.push(`transform: rotate(${round(node.rotation)}deg)`);
  }

  if (node.opacity < 1) declarations.push(`opacity: ${round(node.opacity)}`);

  if (node.type === "rect") {
    if (node.fill) declarations.push(`background: ${node.fill}`);
    if (node.stroke && (node.strokeWidth ?? 0) > 0) {
      declarations.push(`border: ${round(node.strokeWidth ?? 1)}px solid ${node.stroke}`);
      declarations.push("box-sizing: border-box");
    }
    if (node.radius) declarations.push(`border-radius: ${round(node.radius)}px`);
  } else if (node.type === "ellipse") {
    if (node.fill) declarations.push(`background: ${node.fill}`);
    if (node.stroke && (node.strokeWidth ?? 0) > 0) {
      declarations.push(`border: ${round(node.strokeWidth ?? 1)}px solid ${node.stroke}`);
      declarations.push("box-sizing: border-box");
    }
    declarations.push("border-radius: 50%");
  } else if (node.type === "text") {
    declarations.push(
      `color: ${node.color ?? "#000000"}`,
      `font-family: ${node.fontFamily ?? DEFAULT_FONT_FAMILY}`,
      `font-size: ${round(node.fontSize ?? 24)}px`,
      `font-weight: ${node.fontWeight ?? 400}`,
      `line-height: ${round(textMetrics(node as unknown as RenderNode).lineStep)}px`,
      `text-align: ${node.textAlign ?? "left"}`,
      "white-space: pre-wrap"
    );
    if (node.fontStyle === "italic") declarations.push("font-style: italic");
    // Même règle que le canvas : les lignes sont centrées dans la hauteur de la
    // boîte, laquelle reste celle déclarée. Un bloc flex plutôt qu'un padding
    // calculé, pour que le centrage tienne si la police de l'intégrateur mesure
    // autrement ; et pas de min-height, sinon un texte trop grand pour sa boîte
    // pousserait la mise en page ici alors qu'il déborde simplement sur le canvas.
    declarations.push("display: flex", "flex-direction: column", "justify-content: center");
  }

  return declarations;
}

/** Nom d'attribut inchange : la casse du SVG, pour l'export HTML. */
const identity = (name: string): string => name;

/**
 * SVG inline d'une icone, pour les exports HTML et JSX.
 *
 * L'icone est ecrite en clair plutot que tiree d'une dependance : l'export
 * reste un fichier autonome, ouvrable tel quel, sans `npm install` prealable.
 * Le viewBox porte la mise a l'echelle, donc le trait garde son epaisseur
 * relative quelle que soit la taille de la boite.
 */
function iconSvg(node: DesignNode, attributeName: (name: string) => string): string {
  const render = node as unknown as RenderNode;
  const root = { viewBox: `0 0 ${ICON_GRID} ${ICON_GRID}`, width: "100%", height: "100%", ...iconStyle(render) };
  const attributes = Object.entries(root)
    .map(([key, value]) => `${attributeName(key)}="${escapeXml(value)}"`)
    .join(" ");
  const body = iconElementsOf(render)
    .map(([tag, attrs]) =>
      attributeName === identity
        ? iconElementToSvg([tag, attrs])
        : `<${tag} ${Object.entries(attrs)
            .map(([key, value]) => `${attributeName(key)}="${escapeXml(value)}"`)
            .join(" ")} />`
    )
    .join("");
  return `<svg ${attributes}>${body}</svg>`;
}

interface WalkContext {
  layout: Layout;
  children: Map<string | null, DesignNode[]>;
}

function contextOf(design: Design): WalkContext {
  const nodes = toExpandedNodes(design);
  return { layout: computeLayout(nodes as unknown as RenderNode[]), children: childrenByParent(nodes) };
}

/**
 * Résolution des images en data URI : un export se suffit à lui-même, il
 * s'ouvre tel quel sans la médiathèque du serveur.
 */
function renderOptions(images: ImageStore | undefined) {
  return images ? { imageHref: (name: string) => images.dataUri(name) } : {};
}

/** Source et cadrage d'une image pour les exports HTML et JSX. */
function imageTag(node: DesignNode, images: ImageStore | undefined): { src: string; fit: string } {
  const render = node as unknown as RenderNode;
  return { src: imageSource(render, renderOptions(images)), fit: render.fit ?? "cover" };
}

function toHtml(design: Design, images: ImageStore | undefined): string {
  const { layout, children } = contextOf(design);
  const rules: string[] = [];

  const walk = (nodes: DesignNode[], parentBox: Box | null, depth: number): string[] => {
    const pad = "    ".repeat(depth + 1);
    return nodes.flatMap((node) => {
      rules.push(`.${cssClassName(node)} {\n${nodeCss(node, layout, parentBox).map((d) => `  ${d};`).join("\n")}\n}`);
      const cls = cssClassName(node);

      if (node.type === "group") {
        return [
          `${pad}<div class="${cls}">`,
          ...walk(children.get(node.id) ?? [], boundsOf(layout, node.id), depth + 1),
          `${pad}</div>`,
        ];
      }
      if (node.type === "text") return [`${pad}<div class="${cls}">${escapeXml(node.text ?? "")}</div>`];
      if (node.type === "icon") return [`${pad}<div class="${cls}">${iconSvg(node, identity)}</div>`];
      if (node.type === "image") {
        const image = imageTag(node, images);
        return [
          `${pad}<img class="${cls}" src="${escapeXml(image.src)}" alt="${escapeXml(node.name)}" style="object-fit: ${image.fit}" />`,
        ];
      }
      return [`${pad}<div class="${cls}"></div>`];
    });
  };

  const body = walk(children.get(null) ?? [], null, 1).join("\n");

  return [
    "<!doctype html>",
    '<html lang="fr">',
    "<head>",
    '  <meta charset="utf-8" />',
    `  <title>${escapeXml(design.name)}</title>`,
    "  <style>",
    "    body { margin: 0; }",
    `    .design-root { position: relative; width: ${design.width}px; height: ${design.height}px; background: ${design.background}; overflow: hidden; }`,
    rules
      .join("\n\n")
      .split("\n")
      .map((line) => (line ? `    ${line}` : ""))
      .join("\n"),
    "  </style>",
    "</head>",
    "<body>",
    '  <div class="design-root">',
    body,
    "  </div>",
    "</body>",
    "</html>",
  ].join("\n");
}

function toCamelCase(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toComponentName(name: string): string {
  const pascal = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_, letter: string) => (letter ? letter.toUpperCase() : ""))
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
  return /^[A-Za-z]/.test(pascal) ? pascal : "Design";
}

function toJsx(design: Design, images: ImageStore | undefined): string {
  const { layout, children } = contextOf(design);

  const styleOf = (node: DesignNode, parentBox: Box | null): string =>
    nodeCss(node, layout, parentBox)
      .map((declaration) => {
        const separator = declaration.indexOf(":");
        const property = declaration.slice(0, separator).trim();
        const value = declaration.slice(separator + 1).trim();
        return `${toCamelCase(property)}: ${JSON.stringify(value)}`;
      })
      .join(", ");

  const walk = (nodes: DesignNode[], parentBox: Box | null, depth: number): string[] => {
    const pad = "  ".repeat(depth + 3);
    return nodes.flatMap((node) => {
      const comment = `${pad}{/* ${node.name} */}`;
      const style = styleOf(node, parentBox);

      if (node.type === "group") {
        return [
          comment,
          `${pad}<div style={{ ${style} }}>`,
          ...walk(children.get(node.id) ?? [], boundsOf(layout, node.id), depth + 1),
          `${pad}</div>`,
        ];
      }
      if (node.type === "text") {
        return [comment, `${pad}<div style={{ ${style} }}>{${JSON.stringify(node.text ?? "")}}</div>`];
      }
      if (node.type === "icon") {
        return [comment, `${pad}<div style={{ ${style} }}>${iconSvg(node, toCamelCase)}</div>`];
      }
      if (node.type === "image") {
        const image = imageTag(node, images);
        return [
          comment,
          `${pad}<img src=${JSON.stringify(image.src)} alt=${JSON.stringify(node.name)} style={{ ${style}, objectFit: ${JSON.stringify(image.fit)} }} />`,
        ];
      }
      return [comment, `${pad}<div style={{ ${style} }} />`];
    });
  };

  return [
    `export function ${toComponentName(design.name)}() {`,
    "  return (",
    `    <div style={{ position: "relative", width: ${design.width}, height: ${design.height}, background: ${JSON.stringify(design.background)}, overflow: "hidden" }}>`,
    ...walk(children.get(null) ?? [], null, 0),
    "    </div>",
    "  );",
    "}",
    "",
  ].join("\n");
}

/** Inventaire textuel : ce que l'agent lit quand il veut comprendre sans parser du JSON. */
export function toSummary(design: Design): string {
  // Le layout vient des noeuds expanses — c'est la seule facon de connaitre
  // l'encombrement reel d'une instance — mais l'arbre parcouru est celui du
  // STOCKAGE : l'agent doit lire une instance comme une ligne, pas comme une
  // copie du composant.
  const { layout } = contextOf(design);
  const children = childrenByParent(design.nodes);
  const byId = new Map(design.nodes.map((node) => [node.id, node]));
  const lines = [
    `# ${design.name} (${design.id})`,
    `Canvas: ${design.width}x${design.height}, background ${design.background}`,
    `Revision ${design.revision}, last edited by ${design.lastEditor} at ${design.updatedAt}`,
    `Nodes: ${design.nodes.length} (listed bottom to top; indentation = grouping, coordinates are document-absolute)`,
    "",
  ];

  const walk = (nodes: DesignNode[], depth: number) => {
    const indent = "  ".repeat(depth);
    for (const node of nodes) {
      const box = boundsOf(layout, node.id);
      const geometry = `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`;

      if (node.type === "group") {
        const count = (children.get(node.id) ?? []).length;
        lines.push(`${indent}- ${node.id} group "${node.name}" @ ${geometry} — ${count} child(ren)`);
        walk(children.get(node.id) ?? [], depth + 1);
      } else if (node.type === "instance") {
        const source = node.componentId === undefined ? undefined : byId.get(node.componentId);
        lines.push(
          `${indent}- ${node.id} instance "${node.name}" @ ${geometry} — mirrors group ${node.componentId}` +
            `${source ? ` "${source.name}"` : " (missing)"}; edit that group to change every instance of it`
        );
      } else if (node.type === "text") {
        const preview = textLines(node as unknown as RenderNode).join(" / ");
        lines.push(
          `${indent}- ${node.id} text "${node.name}" @ ${geometry} — ${node.fontSize}px/${node.fontWeight} ${node.color} — "${preview}"`
        );
      } else if (node.type === "icon") {
        // Le nom de l'icone EST sa semantique : c'est ce qui rend une maquette
        // relisible par l'agent qui la reprend, screenshot ou pas.
        lines.push(
          `${indent}- ${node.id} icon "${node.name}" @ ${geometry} — ${node.icon ?? "?"}, ` +
            `stroke ${node.stroke ?? "none"} ${node.strokeWidth ?? 2}/24${node.fill && node.fill !== "none" ? `, fill ${node.fill}` : ""}`
        );
      } else if (node.type === "image") {
        lines.push(`${indent}- ${node.id} image "${node.name}" @ ${geometry} — ${node.image ?? "?"}, fit ${node.fit ?? "cover"}`);
      } else if (node.type === "line") {
        lines.push(
          `${indent}- ${node.id} line "${node.name}" @ ${geometry} — ${node.strokeWidth}px ${node.stroke}`
        );
      } else {
        lines.push(
          `${indent}- ${node.id} ${node.type} "${node.name}" @ ${geometry} — fill ${node.fill ?? "none"}, ` +
            `stroke ${node.stroke ?? "none"}${node.radius ? `, radius ${node.radius}` : ""}`
        );
      }
    }
  };

  walk(children.get(null) ?? [], 0);
  return lines.join("\n");
}

export function exportDesign(design: Design, format: ExportFormat, images?: ImageStore): string {
  switch (format) {
    case "svg":
      // `documentToSvg` resout les instances lui-meme : le canvas de la GUI
      // passe par la meme fonction, avec le meme resultat.
      return documentToSvg({
        name: design.name,
        width: design.width,
        height: design.height,
        background: design.background,
        nodes: toRenderNodes(design),
      }, renderOptions(images));
    case "html":
      return toHtml(design, images);
    case "jsx":
      return toJsx(design, images);
    case "json":
      return JSON.stringify(
        {
          id: design.id,
          name: design.name,
          width: design.width,
          height: design.height,
          background: design.background,
          nodes: design.nodes,
        },
        null,
        2
      );
    case "summary":
      return toSummary(design);
  }
}
