import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { Resvg } from "@resvg/resvg-js";
import { makeStore } from "./helpers.js";
import { addImage } from "../src/tools/add-image.js";
import { addNodes } from "../src/tools/add-nodes.js";
import { updateNodes } from "../src/tools/update-nodes.js";
import { exportDesign } from "../src/core/export.js";
import { screenshotDesign, rasterize } from "../src/core/screenshot.js";
import { nodeToSvg, type RenderNode } from "../shared/render.js";

/** PNG uni de la taille demandée. */
function solidPng(width: number, height: number, color: string): Buffer {
  return rasterize(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`,
    1
  ).png;
}

function pixelAt(svg: string, x: number, y: number): number[] {
  const rendered = new Resvg(svg).render();
  const offset = (y * rendered.width + x) * 4;
  return Array.from(rendered.pixels.subarray(offset, offset + 4));
}

test("the media library stores an image under its content hash, once", () => {
  const { store, cleanup } = makeStore();
  try {
    const png = solidPng(40, 20, "#ff0000");
    const first = store.images.save(png);
    const second = store.images.save(png);
    assert.match(first.name, /^img_[0-9a-f]{16}\.png$/);
    assert.equal(second.name, first.name);
    assert.deepEqual([first.width, first.height, first.mimeType], [40, 20, "image/png"]);
    assert.deepEqual(fs.readdirSync(store.images.getDir()), [first.name]);
  } finally {
    cleanup();
  }
});

test("the format is read from the bytes, and unknown content is refused", () => {
  const { store, cleanup } = makeStore();
  try {
    assert.throws(() => store.images.save(Buffer.from("not an image at all")), /Unsupported image format/);
    assert.throws(() => store.images.save(Buffer.alloc(0)), /empty/);
  } finally {
    cleanup();
  }
});

test("natural size is read from JPEG, GIF, WebP and SVG headers", () => {
  const { store, cleanup } = makeStore();
  try {
    // SOI, APP0 de 16 octets, puis SOF0 : hauteur 300, largeur 500.
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      Buffer.alloc(14),
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0xf4, 0x03]),
      Buffer.alloc(12),
    ]);
    const gif = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.from([0x40, 0x01, 0xc8, 0x00]), Buffer.alloc(8)]);
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "latin1");
    webp.write("WEBPVP8X", 8, "latin1");
    webp.writeUIntLE(639, 24, 3);
    webp.writeUIntLE(479, 27, 3);
    const svg = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"></svg>');

    const sizes = [jpeg, gif, webp, svg].map((data) => {
      const stored = store.images.save(data);
      return [stored.format, stored.width, stored.height];
    });
    assert.deepEqual(sizes, [
      ["jpg", 500, 300],
      ["gif", 320, 200],
      ["webp", 640, 480],
      ["svg", 120, 60],
    ]);
  } finally {
    cleanup();
  }
});

test("add_image places the picture at its natural size, named after the file", () => {
  const { store, dir, cleanup } = makeStore();
  try {
    const file = path.join(dir, "photo-equipe.png");
    fs.writeFileSync(file, solidPng(80, 40, "#00aa00"));
    const design = store.create({ name: "Page" });

    const result = addImage(store, { design_id: design.id, file_path: file, x: 10, y: 20 });
    const node = result.design!.nodes.at(-1)!;
    assert.equal(node.type, "image");
    assert.equal(node.name, "photo-equipe");
    assert.deepEqual([node.x, node.y, node.width, node.height, node.fit], [10, 20, 80, 40, "cover"]);
    assert.ok(store.images.has(node.image!));
    assert.match(result.content[0].text, /Stored as "img_/);
  } finally {
    cleanup();
  }
});

test("add_image keeps the proportions when only one dimension is given", () => {
  const { store, dir, cleanup } = makeStore();
  try {
    const file = path.join(dir, "banner.png");
    fs.writeFileSync(file, solidPng(80, 40, "#0000ff"));
    const design = store.create({ name: "Page" });

    const node = addImage(store, { design_id: design.id, file_path: file, width: 200 }).design!.nodes.at(-1)!;
    assert.deepEqual([node.width, node.height], [200, 100]);
  } finally {
    cleanup();
  }
});

test("add_image takes the content relayed by the gateway over the path", () => {
  const { store, cleanup } = makeStore();
  try {
    const design = store.create({ name: "Page" });
    const result = addImage(store, {
      design_id: design.id,
      file_path: "C:/elsewhere/logo.png",
      file_content: solidPng(30, 30, "#ff00ff").toString("base64"),
      file_name: "logo.png",
    });
    const node = result.design!.nodes.at(-1)!;
    assert.equal(node.name, "logo");
    assert.deepEqual([node.width, node.height], [30, 30]);
  } finally {
    cleanup();
  }
});

test("add_image refuses a relative path", () => {
  const { store, cleanup } = makeStore();
  try {
    const design = store.create({ name: "Page" });
    assert.throws(() => addImage(store, { design_id: design.id, file_path: "photo.png" }), /absolute path/);
  } finally {
    cleanup();
  }
});

test("an image node can reuse a stored picture, but not name a missing one", () => {
  const { store, cleanup } = makeStore();
  try {
    const design = store.create({ name: "Page" });
    const stored = store.images.save(solidPng(10, 10, "#123456"));

    const added = addNodes(store, { design_id: design.id, nodes: [{ type: "image", image: stored.name, fit: "contain" }] });
    const node = added.design!.nodes.at(-1)!;
    assert.equal(node.fit, "contain");

    assert.throws(
      () => addNodes(store, { design_id: design.id, nodes: [{ type: "image", image: "img_0000000000000000.png" }] }),
      /not in the media library/
    );
    assert.throws(
      () => updateNodes(store, { design_id: design.id, updates: [{ id: node.id, image: "img_ffffffffffffffff.png" }] }),
      /not in the media library/
    );
    assert.throws(() => addNodes(store, { design_id: design.id, nodes: [{ type: "image" }] }), /needs an "image" field/);
  } finally {
    cleanup();
  }
});

test("an image cannot be rendered without a way to resolve it", () => {
  const node = { id: "i1", type: "image", name: "x", parentId: null, x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, image: "img_0000000000000000.png" };
  assert.throws(() => nodeToSvg(node as RenderNode), /no way to resolve image files/);
  assert.match(nodeToSvg(node as RenderNode, { imageHref: (name) => `api/images/${name}` }), /href="api\/images\/img_0000000000000000\.png"/);
});

test("svg export and screenshot draw the picture", () => {
  const { store, dir, cleanup } = makeStore();
  try {
    const file = path.join(dir, "red.png");
    fs.writeFileSync(file, solidPng(20, 20, "#ff0000"));
    const design = store.create({ name: "Page", width: 100, height: 100, background: "#ffffff" });
    addImage(store, { design_id: design.id, file_path: file, x: 0, y: 0, width: 50, height: 50 });

    const svg = exportDesign(store.get(design.id), "svg", store.images);
    assert.match(svg, /href="data:image\/png;base64,/);
    assert.deepEqual(pixelAt(svg, 25, 25), [255, 0, 0, 255]);
    assert.deepEqual(pixelAt(svg, 75, 75), [255, 255, 255, 255]);

    const shot = screenshotDesign(store.get(design.id), { images: store.images, maxDimension: 4000 });
    assert.deepEqual([shot.width, shot.height], [100, 100]);
  } finally {
    cleanup();
  }
});

test("html and jsx exports embed the picture with its fit", () => {
  const { store, dir, cleanup } = makeStore();
  try {
    const file = path.join(dir, "hero.png");
    fs.writeFileSync(file, solidPng(20, 10, "#ff0000"));
    const design = store.create({ name: "Page" });
    addImage(store, { design_id: design.id, file_path: file, fit: "contain" });

    const html = exportDesign(store.get(design.id), "html", store.images);
    assert.match(html, /<img class="d-hero-[^"]+" src="data:image\/png;base64,[^"]+" alt="hero" style="object-fit: contain" \/>/);
    const jsx = exportDesign(store.get(design.id), "jsx", store.images);
    assert.match(jsx, /<img src="data:image\/png;base64,[^"]+" alt="hero" style=\{\{ .*objectFit: "contain" \}\} \/>/);
    assert.match(exportDesign(store.get(design.id), "summary"), /image "hero" @ .* — img_[0-9a-f]{16}\.png, fit contain/);
  } finally {
    cleanup();
  }
});
