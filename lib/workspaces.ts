import type { ByoReview } from "./byo/review";
import type { ByoSourceInput } from "./byo/schema";
import { requestSchema, type Analysis, type ByoProposal, type Scenario } from "./schema";

export type Review = { commitmentId: string; text: string; approved: boolean; runId: string };
export type AuditEvent = { id: number; title: string; detail: string };
export type ByoDraft = { workspace: string; sources: ByoSourceInput[]; proposal: ByoProposal | null; review: ByoReview | null };

export type SavedWorkspace = {
  id: string;
  kind: "sample" | "byo";
  accountId: string;
  name: string;
  scenario: Scenario;
  analysis: Analysis | null;
  reviews: Review[];
  events: AuditEvent[];
  byo: ByoDraft | null;
  updatedAt: string;
};

export type WorkspaceStore = { version: 1; activeId: string; workspaces: SavedWorkspace[] };

export const STORAGE_KEY = "promise-ledger:v1:workspaces";
export const TOUR_KEY = "promise-ledger:v1:tour-done";
/** Well under the usual 5 MB localStorage quota; the oldest analyses are dropped first beyond it. */
export const MAX_STORE_CHARS = 1_500_000;
export const MAX_BYO_WORKSPACES = 12;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function sampleWorkspaceId(accountId: string) {
  return `sample:${accountId}`;
}

export function newByoWorkspace(name: string, now = new Date()): SavedWorkspace {
  const id = `byo:${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return { id, kind: "byo", accountId: "byo", name, scenario: "blocked", analysis: null, reviews: [], events: [], byo: { workspace: name, sources: [], proposal: null, review: null }, updatedAt: now.toISOString() };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function validWorkspace(value: unknown): value is SavedWorkspace {
  if (!isObject(value)) return false;
  const { id, kind, accountId, name, scenario, reviews, events, byo, analysis } = value;
  return typeof id === "string" && /^(sample|byo):[a-z0-9-]{1,40}$/.test(id) && (kind === "sample" || kind === "byo") && typeof accountId === "string" && typeof name === "string"
    && requestSchema.shape.scenario.safeParse(scenario).success && Array.isArray(reviews) && Array.isArray(events)
    && (analysis === null || (isObject(analysis) && Array.isArray(analysis.commitments) && Array.isArray(analysis.sources) && isObject(analysis.account)))
    && (byo === null || (isObject(byo) && Array.isArray(byo.sources) && typeof byo.workspace === "string"));
}

/** Reads saved workspaces. Anything malformed is ignored rather than trusted. */
export function loadStore(storage: StorageLike): WorkspaceStore | null {
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.workspaces) || typeof parsed.activeId !== "string") return null;
    const workspaces = parsed.workspaces.filter(validWorkspace);
    return { version: 1, activeId: parsed.activeId, workspaces };
  } catch { return null; }
}

/** Shrinks oversized stores by dropping saved analyses, oldest first, keeping the active one. */
export function fitStore(store: WorkspaceStore): WorkspaceStore {
  let next = store;
  const byAge = [...store.workspaces].filter((workspace) => workspace.id !== store.activeId && workspace.analysis).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  while (JSON.stringify(next).length > MAX_STORE_CHARS && byAge.length > 0) {
    const oldest = byAge.shift()!;
    next = { ...next, workspaces: next.workspaces.map((workspace) => workspace.id === oldest.id ? { ...workspace, analysis: null, reviews: [] } : workspace) };
  }
  return next;
}

export function saveStore(storage: StorageLike, store: WorkspaceStore): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(fitStore(store)));
    return true;
  } catch { return false; }
}

export function clearStore(storage: StorageLike) {
  try { storage.removeItem(STORAGE_KEY); storage.removeItem(TOUR_KEY); } catch { /* storage unavailable */ }
}

export function upsertWorkspace(store: WorkspaceStore, workspace: SavedWorkspace): WorkspaceStore {
  const exists = store.workspaces.some((candidate) => candidate.id === workspace.id);
  return { ...store, workspaces: exists ? store.workspaces.map((candidate) => candidate.id === workspace.id ? workspace : candidate) : [...store.workspaces, workspace] };
}

export function removeWorkspace(store: WorkspaceStore, id: string, fallbackId: string): WorkspaceStore {
  return { ...store, activeId: store.activeId === id ? fallbackId : store.activeId, workspaces: store.workspaces.filter((workspace) => workspace.id !== id) };
}

export function exportPayload(store: WorkspaceStore, only?: string) {
  const workspaces = only ? store.workspaces.filter((workspace) => workspace.id === only) : store.workspaces;
  return JSON.stringify({ exportedFrom: "Promise Ledger", exportedAt: new Date().toISOString(), storedIn: "this browser only (localStorage)", version: store.version, workspaces: workspaces.map(({ byo, ...workspace }) => ({ ...workspace, byo: byo ? { ...byo, proposal: byo.proposal ? { ...byo.proposal, continuation: null } : null } : null })) }, null, 2);
}
