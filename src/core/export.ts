import type { Design, DesignNode } from "../../shared/schemas/design.schema.js";
import {
  DEFAULT_FONT_FAMILY,
  documentToSvg,
  escapeXml,
  measuredTextHeight,
  normalizedBox,
  textLines,
  type RenderNode,
} from "../../shared/render.js";

export const EXPORT_FORMATS = ["svg", "html", "jsx", "json", "summary"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function toRenderNodes(design: Design): RenderNode[] {
  return design.nodes as unknown as RenderNode[];
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
 * Bloc de déclarations CSS d'un noeud. Les formes deviennent des div
 * positionnées en absolu : c'est ce que l'on veut coller dans une vraie app,
 * là où le SVG ne sert qu'à la prévisualisation.
 */
function nodeCss(node: DesignNode): string[] {
  const box = normalizedBox(node as unknown as RenderNode);
  const declarations: string[] = ["position: absolute"];

  if (node.type === "line") {
    // Une ligne se rend comme une barre pivotée autour de son point de départ :
    // c'est le seul type dont l'ancrage n'est pas le coin de la boîte englobante.
    const length = Math.hypot(node.width, node.height);
    const angle = (Math.atan2(node.height, node.width) * 180) / Math.PI;
    const thickness = round(node.strokeWidth ?? 1);
    declarations.push(
      `left: ${round(node.x)}px`,
      `top: ${round(node.y - thickness / 2)}px`,
      `width: ${round(length)}px`,
      `height: ${thickness}px`,
      `background: ${node.stroke ?? "#000000"}`,
      `transform: rotate(${round(angle + node.rotation)}deg)`,
      "transform-origin: 0 50%"
    );
  } else {
    declarations.push(
      `left: ${round(box.x)}px`,
      `top: ${round(box.y)}px`,
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
      `line-height: ${node.lineHeight ?? 1.35}`,
      `text-align: ${node.textAlign ?? "left"}`,
      "white-space: pre-wrap"
    );
    if (node.fontStyle === "italic") declarations.push("font-style: italic");
    declarations.push("height: auto", `min-height: ${round(measuredTextHeight(node as unknown as RenderNode))}px`);
  }

  return declarations;
}

function toHtml(design: Design): string {
  const rules = design.nodes
    .map((node) => `.${cssClassName(node)} {\n${nodeCss(node).map((d) => `  ${d};`).join("\n")}\n}`)
    .join("\n\n");

  const body = design.nodes
    .map((node) => {
      const cls = cssClassName(node);
      if (node.type === "text") {
        return `    <div class="${cls}">${escapeXml(node.text ?? "")}</div>`;
      }
      return `    <div class="${cls}"></div>`;
    })
    .join("\n");

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

function toJsx(design: Design): string {
  const componentName = toComponentName(design.name);

  const elements = design.nodes
    .map((node) => {
      const style = nodeCss(node)
        .map((declaration) => {
          const separator = declaration.indexOf(":");
          const property = declaration.slice(0, separator).trim();
          const value = declaration.slice(separator + 1).trim();
          return `${toCamelCase(property)}: ${JSON.stringify(value)}`;
        })
        .join(", ");
      const comment = `{/* ${node.name} */}`;
      if (node.type === "text") {
        return `      ${comment}\n      <div style={{ ${style} }}>{${JSON.stringify(node.text ?? "")}}</div>`;
      }
      return `      ${comment}\n      <div style={{ ${style} }} />`;
    })
    .join("\n");

  return [
    `export function ${componentName}() {`,
    "  return (",
    `    <div style={{ position: "relative", width: ${design.width}, height: ${design.height}, background: ${JSON.stringify(design.background)}, overflow: "hidden" }}>`,
    elements,
    "    </div>",
    "  );",
    "}",
    "",
  ].join("\n");
}

/** Inventaire textuel : ce que l'agent lit quand il veut comprendre sans parser du JSON. */
export function toSummary(design: Design): string {
  const lines = [
    `# ${design.name} (${design.id})`,
    `Canvas: ${design.width}x${design.height}, background ${design.background}`,
    `Revision ${design.revision}, last edited by ${design.lastEditor} at ${design.updatedAt}`,
    `Nodes: ${design.nodes.length} (listed bottom to top)`,
    "",
  ];
  for (const node of design.nodes) {
    const box = normalizedBox(node as unknown as RenderNode);
    const geometry = `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`;
    if (node.type === "text") {
      const preview = textLines(node as unknown as RenderNode).join(" / ");
      lines.push(
        `- ${node.id} text "${node.name}" @ ${geometry} — ${node.fontSize}px/${node.fontWeight} ${node.color} — "${preview}"`
      );
    } else if (node.type === "line") {
      lines.push(
        `- ${node.id} line "${node.name}" from ${Math.round(node.x)},${Math.round(node.y)} to ` +
          `${Math.round(node.x + node.width)},${Math.round(node.y + node.height)} — ${node.strokeWidth}px ${node.stroke}`
      );
    } else {
      lines.push(
        `- ${node.id} ${node.type} "${node.name}" @ ${geometry} — fill ${node.fill ?? "none"}, ` +
          `stroke ${node.stroke ?? "none"}${node.radius ? `, radius ${node.radius}` : ""}`
      );
    }
  }
  return lines.join("\n");
}

export function exportDesign(design: Design, format: ExportFormat): string {
  switch (format) {
    case "svg":
      return documentToSvg({
        name: design.name,
        width: design.width,
        height: design.height,
        background: design.background,
        nodes: toRenderNodes(design),
      });
    case "html":
      return toHtml(design);
    case "jsx":
      return toJsx(design);
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
