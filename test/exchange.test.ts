import assert from "node:assert/strict";
import test from "node:test";
import {
  ExchangeError,
  applyPageImport,
  creationPrompt,
  pageFileOf,
  parsePageReply,
  parseProjectFile,
  projectFileOf,
  recapText,
  type ProjectData,
} from "../src/core/exchange.js";
import { addRemark, emptyFeedbackFile, resolveRemarkTarget, submitRound } from "../src/core/feedback-model.js";

function emptyProject(): ProjectData {
  return { designs: [], feedback: emptyFeedbackFile(), captures: {} };
}

/** Le bloc JSON d'exemple du prompt : il doit s'importer tel quel. */
function promptExample(): string {
  const block = /## Example\n\n```json\n([\s\S]*?)\n```/.exec(creationPrompt());
  assert.ok(block, "the prompt carries a JSON example");
  return block[1];
}

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ExchangeError, `expected an ExchangeError, got ${(err as Error).message}`);
    return err.issues;
  }
  assert.fail("the import was accepted");
}

test("the example of the prompt imports as a new, synced page", () => {
  const project = emptyProject();
  const plan = parsePageReply(promptExample(), project);
  assert.equal(plan.replaces, null);
  applyPageImport(project, plan);

  const page = project.designs[0];
  assert.equal(page.id, "home");
  assert.equal(page.lastEditor, "agent");
  assert.deepEqual(page.baseline.nodes, page.nodes);
  const card = page.nodes.find((node) => node.id === "card")!;
  assert.ok(card.width > 0 && card.height > 0, "group sizes are derived");
});

test("a whole reply is read through its single code block", () => {
  const reply = "Here is the page:\n\n```json\n" + promptExample() + "\n```\n\nSay next for the following one.";
  assert.equal(parsePageReply(reply, emptyProject()).design.id, "home");

  const twice = reply + "\n\n```json\n{}\n```";
  assert.match(issuesOf(() => parsePageReply(twice, emptyProject()))[0], /2 code blocks/);
});

test("an exported page reimports unchanged and replaces its original", () => {
  const project = emptyProject();
  applyPageImport(project, parsePageReply(promptExample(), project));
  const original = project.designs[0];

  const plan = parsePageReply(JSON.stringify(pageFileOf(original)), project);
  assert.equal(plan.replaces?.id, "home");
  assert.deepEqual(plan.design.nodes, original.nodes);
  applyPageImport(project, plan);
  assert.equal(project.designs.length, 1);
  assert.equal(project.designs[0].revision, original.revision + 1);
});

test("every faulty node is reported, and nothing is imported", () => {
  const reply = {
    format: "mcp-design-page",
    version: 1,
    page: {
      id: "broken",
      name: "Broken",
      width: 800,
      height: 600,
      nodes: [
        { id: "photo", type: "image", name: "Photo", x: 0, y: 0, width: 100, height: 100, image: "a.png" },
        { id: "label", type: "text", name: "Label", x: 0, y: 0, text: "Hi", fill: "#000" },
        { id: "home", type: "icon", name: "Home", x: 0, y: 0, icon: "home" },
        { type: "rect", name: "No id", x: 0, y: 0 },
      ],
    },
  };
  const issues = issuesOf(() => parsePageReply(JSON.stringify(reply), emptyProject()));
  assert.equal(issues.length, 4);
  assert.match(issues[0], /"photo".*image/);
  assert.match(issues[1], /"label".*\[fill\]/);
  assert.match(issues[2], /Unknown icon "home".*house/);
  assert.match(issues[3], /nodes\[3\].*"id" is required/);
});

test("a hierarchy error refuses the page", () => {
  const reply = {
    format: "mcp-design-page",
    version: 1,
    page: { id: "p", name: "P", width: 800, height: 600, nodes: [{ id: "a", type: "rect", name: "A", parentId: "nope", x: 0, y: 0 }] },
  };
  const issues = issuesOf(() => parsePageReply(JSON.stringify(reply), emptyProject()));
  assert.match(issues[0], /parent "nope" that does not exist/);
});

test("processed remarks are checked against the rounds, then marked as processed by the agent", () => {
  const project = emptyProject();
  applyPageImport(project, parsePageReply(promptExample(), project));
  const page = project.designs[0];
  const target = resolveRemarkTarget(page, { kind: "node", nodeId: "logo" });
  addRemark(project.feedback, { id: "rm_logo", designId: page.id, target, text: "Bigger logo", capture: null });
  submitRound(project.feedback, ["rm_logo"], "Round 1", new Map([[page.id, page.name]]));

  const file = pageFileOf(page) as { processed: unknown[] };
  const unknown = { ...file, processed: [{ remark: "rm_other" }] };
  assert.match(issuesOf(() => parsePageReply(JSON.stringify(unknown), project))[0], /"rm_other" is not part of any feedback round/);

  const reply = { ...file, processed: [{ remark: "rm_logo", note: "Logo at 28px" }] };
  applyPageImport(project, parsePageReply(JSON.stringify(reply), project));
  const processed = project.feedback.rounds[0].remarks[0].processed;
  assert.equal(processed?.by, "agent");
  assert.equal(processed?.note, "Logo at 28px");
});

test("a project export reads back identically", () => {
  const project = emptyProject();
  applyPageImport(project, parsePageReply(promptExample(), project));
  const text = JSON.stringify(projectFileOf(project, new Date().toISOString()));
  assert.deepEqual(parseProjectFile(text), project);
});

test("a project export missing a capture is refused", () => {
  const project = emptyProject();
  applyPageImport(project, parsePageReply(promptExample(), project));
  const page = project.designs[0];
  const target = resolveRemarkTarget(page, { kind: "node", nodeId: "logo" });
  addRemark(project.feedback, { id: "rm_a", designId: page.id, target, text: "x", capture: "rm_a.png" });
  const issues = issuesOf(() => parseProjectFile(JSON.stringify(projectFileOf(project, "now"))));
  assert.match(issues[0], /"rm_a.png" is referenced by a remark but missing/);
});

test("the recap carries the remarks, the attachments and the current JSON of each page", () => {
  const project = emptyProject();
  applyPageImport(project, parsePageReply(promptExample(), project));
  const page = project.designs[0];
  const target = resolveRemarkTarget(page, { kind: "node", nodeId: "logo" });
  addRemark(project.feedback, { id: "rm_logo", designId: page.id, target, text: "Bigger logo", capture: "rm_logo.png" });
  const round = submitRound(project.feedback, ["rm_logo"], "Round 1", new Map([[page.id, page.name]]));

  const text = recapText(round, project.designs, { pages: new Map([["home", "page-home.png"]]), captures: ["image-1.png"] });
  assert.match(text, /rm_logo \[#1 · element\]/);
  assert.match(text, /page-home\.png/);
  assert.match(text, /image-1\.png: image 1/);
  const block = /### Page "Home" \(home\)\n\n```json\n([\s\S]*?)\n```/.exec(text);
  assert.ok(block);
  assert.equal(parsePageReply(block[1], project).design.nodes.length, page.nodes.length);
});
