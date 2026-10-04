import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs";
import path from "path";
import { makeStore } from "./helpers.js";
import { addNodes } from "../src/tools/add-nodes.js";
import { getFeedback } from "../src/tools/get-feedback.js";
import { markFeedbackProcessed } from "../src/tools/mark-feedback-processed.js";
import { FeedbackStore } from "../src/core/feedback-store.js";
import { screenshotDesign } from "../src/core/screenshot.js";
import { elementsInArea, formatFeedbackRound } from "../shared/feedback.js";
import type { DesignStore } from "../src/core/design-store.js";

const PNG_SIGNATURE = "89504e470d0a1a0a";

/** Page de test : un pied de page dont le fond déborde, avec un titre et un bouton. */
function seed(store: DesignStore): string {
  const design = store.create({ name: "Accueil", width: 800, height: 600 });
  addNodes(store, {
    design_id: design.id,
    nodes: [
      { type: "group", id: "footer", name: "Pied de page", x: 0, y: 400 },
      { type: "rect", id: "footer-bg", name: "Fond", parentId: "footer", x: 0, y: 0, width: 800, height: 200, fill: "#0f172a" },
      { type: "text", id: "footer-title", name: "Titre", parentId: "footer", x: 32, y: 40, width: 300, text: "Prêt ?", fontSize: 22 },
      { type: "group", id: "footer-btn", name: "Bouton", parentId: "footer", x: 32, y: 100 },
      { type: "rect", id: "footer-btn-bg", name: "Fond du bouton", parentId: "footer-btn", x: 0, y: 0, width: 160, height: 38, fill: "#ffffff" },
      { type: "rect", id: "hero", name: "Hero", x: 0, y: 0, width: 800, height: 300, fill: "#e0f2fe" },
    ],
  });
  return design.id;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0].text ?? "";
}

test("an area cites contained elements whole, opens groups it cuts, and flags partial leaves", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);

  const hits = elementsInArea(store.get(id).nodes, { x: 16, y: 420, width: 400, height: 140 });
  assert.deepEqual(
    hits.map((hit) => [hit.id, hit.partial]),
    [
      ["footer-bg", true],
      ["footer-title", false],
      ["footer-btn", false],
    ]
  );
});

test("an area covering a whole section cites the section alone", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);

  const hits = elementsInArea(store.get(id).nodes, { x: 0, y: 390, width: 800, height: 210 });
  assert.deepEqual(hits.map((hit) => hit.id), ["footer"]);
});

test("a region screenshot is framed on the area", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);

  const shot = screenshotDesign(store.get(id), { region: { x: 16, y: 420, width: 400, height: 140 } });
  assert.equal(shot.sourceWidth, 400);
  assert.equal(shot.sourceHeight, 140);
  assert.equal(shot.png.subarray(0, 8).toString("hex"), PNG_SIGNATURE);
});

test("an area away from a semi-transparent group is captured without that group", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  addNodes(store, {
    design_id: id,
    nodes: [
      { type: "group", id: "faded", name: "Révoqué", x: 0, y: 560, opacity: 0.5 },
      { type: "rect", id: "faded-bg", name: "Fond", parentId: "faded", x: 0, y: 0, width: 200, height: 30, fill: "#ff0000" },
    ],
  });

  // resvg panique, et emporte le processus de test, si le groupe est rendu hors du cadre.
  const shot = screenshotDesign(store.get(id), { region: { x: 0, y: 0, width: 400, height: 100 } });
  assert.equal(shot.sourceWidth, 400);
  assert.equal(shot.png.subarray(0, 8).toString("hex"), PNG_SIGNATURE);
});

test("an area over the empty end of a semi-transparent text box is captured", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  addNodes(store, {
    design_id: id,
    nodes: [
      { type: "group", id: "faded", name: "Révoqué", x: 0, y: 320, opacity: 0.5 },
      { type: "text", id: "faded-t", name: "Libellé", parentId: "faded", x: 20, y: 0, width: 600, text: "Ancien", fontSize: 12 },
    ],
  });

  // La zone recoupe la boîte du texte, mais pas ses glyphes.
  const shot = screenshotDesign(store.get(id), { region: { x: 500, y: 310, width: 200, height: 40 } });
  assert.equal(shot.width, 200);
  assert.equal(shot.height, 40);
});

test("an area outside the artboard is refused", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  const feedback = new FeedbackStore(store);

  assert.throws(
    () =>
      feedback.add({
        designId: id,
        target: { kind: "area", box: { x: 700, y: 500, width: 200, height: 50 }, elementIds: [] },
        text: "Hors planche",
        capture: true,
      }),
    /within the 800x600 artboard/
  );
});

test("a node remark is resolved from the design and gets a capture in the data directory", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  const feedback = new FeedbackStore(store);

  const remark = feedback.add({ designId: id, target: { kind: "node", nodeId: "footer-btn" }, text: " Plus grand ", capture: true });

  assert.equal(remark.number, 1);
  assert.equal(remark.text, "Plus grand");
  assert.equal(remark.status, "draft");
  assert.deepEqual(remark.target, {
    kind: "node",
    element: { id: "footer-btn", name: "Bouton", type: "group" },
    path: ["Pied de page", "Bouton"],
    box: { x: 32, y: 500, width: 160, height: 38 },
  });
  assert.equal(feedback.getFilePath(), path.join(dir, "feedback", "remarks.json"));
  const capture = path.join(dir, "feedback", "captures", remark.capture!);
  assert.equal(fs.readFileSync(capture).subarray(0, 8).toString("hex"), PNG_SIGNATURE);
});

test("an area remark only cites elements that are inside the area", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  const feedback = new FeedbackStore(store);
  const box = { x: 16, y: 420, width: 400, height: 140 };

  const remark = feedback.add({
    designId: id,
    target: { kind: "area", box, elementIds: ["footer-title", "footer-btn"] },
    text: "Ajouter un lien",
    capture: false,
  });
  assert.deepEqual(remark.target, {
    kind: "area",
    box,
    elements: [
      { id: "footer-title", name: "Titre", type: "text" },
      { id: "footer-btn", name: "Bouton", type: "group" },
    ],
  });
  assert.equal(remark.capture, null);

  assert.throws(
    () => feedback.add({ designId: id, target: { kind: "area", box, elementIds: ["hero"] }, text: "x", capture: false }),
    /not inside the remark area/
  );
});

test("a page holds a single draft remark on the whole page, without a number", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  const feedback = new FeedbackStore(store);

  const remark = feedback.add({ designId: id, target: { kind: "page" }, text: "Contraste", capture: true });
  assert.equal(remark.number, null);
  assert.equal(remark.capture, null);
  assert.throws(
    () => feedback.add({ designId: id, target: { kind: "page" }, text: "Encore", capture: false }),
    /already has a remark on the whole page/
  );
});

test("an empty remark is refused", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  const feedback = new FeedbackStore(store);

  assert.throws(() => feedback.add({ designId: id, target: { kind: "page" }, text: "   ", capture: false }), /needs some text/);
});

test("submitting freezes the selected drafts into a numbered round and marks them sent", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  const feedback = new FeedbackStore(store);

  const first = feedback.add({ designId: id, target: { kind: "node", nodeId: "hero" }, text: "Plus clair", capture: false });
  const kept = feedback.add({ designId: id, target: { kind: "node", nodeId: "footer-btn" }, text: "Plus tard", capture: false });

  const round = feedback.submit([first.id], "Revue");
  assert.equal(round.number, 1);
  assert.deepEqual(round.remarks.map((remark) => [remark.id, remark.designName]), [[first.id, "Accueil"]]);

  const [sent, draft] = feedback.remarks(id);
  assert.equal(sent.status, "sent");
  assert.equal(sent.round, 1);
  assert.equal(draft.id, kept.id);
  assert.equal(draft.status, "draft");

  assert.throws(() => feedback.updateText(first.id, "Autre"), /can no longer be edited/);
  assert.throws(() => feedback.submit([first.id], "Revue"), /can no longer be edited/);
  assert.throws(() => feedback.submit([], "Revue"), /at least one remark/);

  const next = feedback.add({ designId: id, target: { kind: "node", nodeId: "hero" }, text: "Encore", capture: false });
  assert.equal(next.number, 3, "a number already given is never reused");
  assert.equal(feedback.submit([kept.id, next.id], "Revue").number, 2);
});

test("deleting a draft removes its capture; a sent remark keeps it for its round", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  const feedback = new FeedbackStore(store);

  const draft = feedback.add({ designId: id, target: { kind: "node", nodeId: "hero" }, text: "A", capture: true });
  const sent = feedback.add({ designId: id, target: { kind: "node", nodeId: "footer" }, text: "B", capture: true });
  feedback.submit([sent.id], "Revue");

  feedback.delete(draft.id);
  feedback.delete(sent.id);
  assert.equal(fs.existsSync(feedback.capturePath(draft.capture!)), false);
  assert.equal(fs.existsSync(feedback.capturePath(sent.capture!)), true);
  assert.deepEqual(feedback.remarks(), []);
  assert.equal(feedback.rounds()[0].remarks[0].text, "B");
});

test("deleting a design drops its remarks", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  const feedback = new FeedbackStore(store);

  feedback.add({ designId: id, target: { kind: "page" }, text: "A", capture: false });
  feedback.deleteDesign(id);
  assert.deepEqual(feedback.remarks(), []);
});

test("get_feedback guides the agent until a round exists", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  const feedback = new FeedbackStore(store);
  feedback.add({ designId: id, target: { kind: "page" }, text: "A", capture: false });

  const text = textOf(getFeedback(feedback, {}));
  assert.match(text, /No feedback round has been submitted yet\. 1 remark\(s\) are still drafts/);
  assert.match(text, /Terminer les retours/);
});

/** Un retour de deux remarques (page entière, zone avec capture) puis un second d'une remarque. */
function twoRounds(store: DesignStore) {
  const id = seed(store);
  const feedback = new FeedbackStore(store);
  const page = feedback.add({ designId: id, target: { kind: "page" }, text: "Contraste\nsur toute la page", capture: false });
  const area = feedback.add({
    designId: id,
    target: { kind: "area", box: { x: 16, y: 420, width: 400, height: 140 }, elementIds: ["footer-btn"] },
    text: "Ajouter un lien",
    capture: true,
  });
  feedback.submit([page.id, area.id], "Accueil — première passe");
  const later = feedback.add({ designId: id, target: { kind: "node", nodeId: "hero" }, text: "Plus clair", capture: false });
  feedback.submit([later.id], "Hero");
  return { feedback, page, area, later };
}

test("a round needs a name, and can be renamed", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  const feedback = new FeedbackStore(store);
  const remark = feedback.add({ designId: id, target: { kind: "page" }, text: "A", capture: false });

  assert.throws(() => feedback.submit([remark.id], "  "), /needs a name/);
  assert.equal(feedback.submit([remark.id], " Accueil ").title, "Accueil");
  assert.equal(feedback.rename(1, "Accueil v2").title, "Accueil v2");
  assert.throws(() => feedback.rename(2, "x"), /Feedback round 2 not found/);
});

test("get_feedback returns the oldest round still to process, with ids and captures", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const { feedback, page, area } = twoRounds(store);

  const first = getFeedback(feedback, {});
  const text = textOf(first);
  assert.match(text, /^Feedback round 1 "Accueil — première passe" — submitted .* — 2 remark\(s\) on 1 page\(s\), 0 processed\./);
  assert.match(text, /Page "Accueil" \(accueil\)/);
  assert.ok(text.includes(`- ${page.id} [whole page]\n    Contraste\n    sur toute la page`));
  assert.ok(
    text.includes(
      `- ${area.id} [#1 · area] box x 16, y 420, 400×140 — elements: footer-btn "Bouton" (group) — capture: image 1\n    Ajouter un lien`
    )
  );
  assert.match(text, /- round 1 "Accueil — première passe" \(.*\): 0\/2 processed — to process/);
  assert.match(text, /- round 2 "Hero" \(.*\): 0\/1 processed — to process/);
  assert.match(text, /call mark_feedback_processed/);
  assert.match((first.content[1] as { text: string }).text, /^Image 1 — remark #1 on "Accueil"/);
  assert.equal(first.content[2].type, "image");

  assert.match(textOf(getFeedback(feedback, { round: 2 })), /^Feedback round 2 "Hero"/);
  assert.equal(getFeedback(feedback, { round: 1, captures: false }).content.length, 1);
  assert.throws(() => getFeedback(feedback, { round: 7 }), /Feedback round 7 not found/);
});

test("mark_feedback_processed tracks progress, and get_feedback moves on to the next round", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const { feedback, page, area } = twoRounds(store);

  const partial = textOf(markFeedbackProcessed(feedback, { round: 1, remark_ids: [area.id], note: "Lien ajouté." }));
  assert.match(partial, /1 remark\(s\) of feedback round 1 "Accueil — première passe" marked as processed\. 1 of 2/);
  assert.match(textOf(getFeedback(feedback, {})), /✓ processed by agent at .*: Lien ajouté\./);
  assert.match(textOf(getFeedback(feedback, {})), /1\/2 processed — in progress/);

  assert.match(textOf(markFeedbackProcessed(feedback, { round: 1 })), /the round is complete/);
  assert.match(textOf(getFeedback(feedback, {})), /^Feedback round 2 "Hero"/);

  const [round] = feedback.rounds();
  assert.equal(round.remarks.find((remark) => remark.id === area.id)!.processed!.note, "Lien ajouté.");
  assert.equal(round.remarks.find((remark) => remark.id === page.id)!.processed!.by, "agent");

  assert.throws(() => markFeedbackProcessed(feedback, { round: 1, remark_ids: ["rm_nope"] }), /not part of feedback round 1/);
  assert.throws(() => markFeedbackProcessed(feedback, {}), /"round" is required/);
});

test("marking a whole round keeps the remarks the agent already processed", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const { feedback, page, area } = twoRounds(store);

  markFeedbackProcessed(feedback, { round: 1, remark_ids: [area.id], note: "Lien ajouté." });
  feedback.setProcessed({ round: 1, processed: true, by: "user" });

  const [round] = feedback.rounds();
  const byId = new Map(round.remarks.map((remark) => [remark.id, remark.processed]));
  assert.deepEqual([byId.get(area.id)!.by, byId.get(area.id)!.note], ["agent", "Lien ajouté."]);
  assert.deepEqual([byId.get(page.id)!.by, byId.get(page.id)!.note], ["user", null]);

  feedback.setProcessed({ round: 1, processed: false, by: "user" });
  assert.ok(feedback.rounds()[0].remarks.every((remark) => remark.processed === null));
});

test("the user can reopen a processed remark", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const { feedback, page } = twoRounds(store);

  feedback.setProcessed({ round: 1, remarkIds: [page.id], processed: true, by: "user" });
  assert.equal(feedback.rounds()[0].remarks[0].processed!.by, "user");
  feedback.setProcessed({ round: 1, remarkIds: [page.id], processed: false, by: "user" });
  assert.equal(feedback.rounds()[0].remarks[0].processed, null);
});

test("a version 1 remarks file is read with default round names and nothing processed", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  fs.mkdirSync(path.join(dir, "feedback"), { recursive: true });
  const remark = {
    id: "rm_old",
    designId: id,
    designName: "Accueil",
    number: null,
    target: { kind: "page" },
    text: "Ancienne remarque",
    capture: null,
  };
  fs.writeFileSync(
    path.join(dir, "feedback", "remarks.json"),
    JSON.stringify({
      version: 1,
      remarks: [],
      rounds: [{ number: 1, submittedAt: "2026-10-04T14:53:19.488Z", remarks: [remark] }],
      lastNumbers: {},
    })
  );

  const [round] = new FeedbackStore(store).rounds();
  assert.equal(round.title, "Retour n°1");
  assert.equal(round.remarks[0].processed, null);
});

test("the GUI preview and the agent read the same text", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const id = seed(store);
  const feedback = new FeedbackStore(store);
  const remark = feedback.add({ designId: id, target: { kind: "node", nodeId: "footer-title" }, text: "Plus gros", capture: false });
  const round = feedback.submit([remark.id], "Pied de page");

  assert.equal(textOf(getFeedback(feedback, {})).startsWith(formatFeedbackRound(round)), true);
  assert.match(
    formatFeedbackRound(round),
    /\[#1 · element\] footer-title "Titre" \(text\) — path: Pied de page › Titre — box x 32, y 440, 300×30/
  );
});
