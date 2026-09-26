import assert from "node:assert/strict";
import test from "node:test";
import { northstar, SAMPLE_ACCOUNTS } from "../lib/accounts/index.ts";
import { referenceAnalysis } from "../lib/accounts/reference.ts";
import { clearStore, exportPayload, fitStore, loadStore, MAX_STORE_CHARS, newByoWorkspace, removeWorkspace, sampleWorkspaceId, saveStore, STORAGE_KEY, TOUR_KEY, upsertWorkspace, type SavedWorkspace, type StorageLike, type WorkspaceStore } from "../lib/workspaces.ts";

function memoryStorage(quota = Infinity): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { if (value.length > quota) throw new Error("QuotaExceededError"); data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

function sample(id: string, updatedAt: string): SavedWorkspace {
  const pack = SAMPLE_ACCOUNTS.find((candidate) => candidate.id === id)!;
  return { id: sampleWorkspaceId(id), kind: "sample", accountId: id, name: pack.name, scenario: pack.defaultScenario, analysis: referenceAnalysis(pack), reviews: [{ commitmentId: "PL-101", text: "Draft", approved: true, runId: "r" }], events: [{ id: 0, title: "Opened", detail: "d" }], byo: null, updatedAt };
}

test("workspaces round-trip through browser storage, and malformed entries are ignored", () => {
  const storage = memoryStorage();
  const byo = newByoWorkspace("Acme", new Date("2026-09-26T08:00:00Z"));
  let store: WorkspaceStore = { version: 1, activeId: byo.id, workspaces: [] };
  store = upsertWorkspace(upsertWorkspace(store, sample("northstar", "2026-09-26T07:00:00Z")), byo);
  assert.ok(saveStore(storage, store));
  assert.deepEqual(loadStore(storage), store);
  const raw = JSON.parse(storage.data.get(STORAGE_KEY)!);
  raw.workspaces.push({ id: "evil:<script>", kind: "sample" }, { ...byo, id: "byo:ok2", scenario: "nope" });
  storage.setItem(STORAGE_KEY, JSON.stringify(raw));
  assert.deepEqual(loadStore(storage)?.workspaces.map((workspace) => workspace.id), [sampleWorkspaceId("northstar"), byo.id]);
  storage.setItem(STORAGE_KEY, "{not json");
  assert.equal(loadStore(storage), null);
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, activeId: "x", workspaces: [] }));
  assert.equal(loadStore(storage), null);
});

test("clearing removes every saved workspace and the tour flag; delete falls back to Northstar", () => {
  const storage = memoryStorage();
  const byo = newByoWorkspace("Acme");
  saveStore(storage, { version: 1, activeId: byo.id, workspaces: [byo] });
  storage.setItem(TOUR_KEY, "1");
  clearStore(storage);
  assert.equal(storage.data.size, 0);
  const removed = removeWorkspace({ version: 1, activeId: byo.id, workspaces: [byo] }, byo.id, sampleWorkspaceId(northstar.id));
  assert.deepEqual([removed.activeId, removed.workspaces.length], [sampleWorkspaceId(northstar.id), 0]);
});

test("oversized stores drop the oldest saved analyses first and never the active one", () => {
  const padding = "p".repeat(Math.ceil(MAX_STORE_CHARS / 3));
  const workspaces = SAMPLE_ACCOUNTS.map((pack, index) => {
    const workspace = sample(pack.id, `2026-09-2${index}T00:00:00Z`);
    return { ...workspace, analysis: { ...workspace.analysis!, runId: padding } };
  });
  const store: WorkspaceStore = { version: 1, activeId: workspaces[0].id, workspaces };
  const fitted = fitStore(store);
  assert.ok(JSON.stringify(fitted).length <= MAX_STORE_CHARS);
  assert.ok(fitted.workspaces[0].analysis, "the active workspace keeps its analysis");
  assert.equal(fitted.workspaces[1].analysis, null, "the oldest inactive analysis is dropped first");
  assert.equal(saveStore(memoryStorage(10), store), false, "a full browser store reports failure instead of throwing");
});

test("export includes workspaces but never a live continuation token", () => {
  const byo = newByoWorkspace("Acme");
  const withToken: SavedWorkspace = { ...byo, byo: { ...byo.byo!, proposal: { continuation: { token: "secret.signature", expiresAt: "2026-09-26T09:00:00Z" } } as never } };
  const exported = JSON.parse(exportPayload({ version: 1, activeId: byo.id, workspaces: [withToken, sample("lumen-cu", "2026-09-26T00:00:00Z")] }));
  assert.equal(exported.workspaces.length, 2);
  assert.equal(exported.workspaces[0].byo.proposal.continuation, null);
  assert.doesNotMatch(JSON.stringify(exported), /secret\.signature/);
  assert.equal(JSON.parse(exportPayload({ version: 1, activeId: byo.id, workspaces: [withToken, sample("lumen-cu", "x")] }, byo.id)).workspaces.length, 1);
});
