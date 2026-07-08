# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Requires Node 22+ (a user-local install lives at `~/.local/opt/node22/bin`; add it to PATH if `node` is missing).

- `npm run dev` — runs both dev servers via concurrently: Fastify API on :3001, Vite on :5173 (proxies `/api` → :3001, so no CORS setup)
- `npm run test` — vitest in `shared/` then `server/` (there are no web tests)
- `npm run test -w server` — one workspace; add `-- -t "name"` for a single test
- `npm run build` — typecheck all three workspaces (`tsc --noEmit`) + `vite build`. In prod, Fastify serves `web/dist` statically if it exists.

The SQLite DB lives at `server/data/treemapper.db` (gitignored). Delete it to reset; the server seeds a root node on first boot. Tests use `:memory:` via `buildApp(':memory:')` from `server/src/app.ts`.

## Architecture

TreeMapper is a single-project development-planning app with an **in-app commit system** (not real git): every mutation is recorded as a numbered commit and the graph can be viewed at / reverted to any commit.

npm-workspaces monorepo: `shared/` (types + op engine), `server/` (Fastify + better-sqlite3), `web/` (Vite + React + React Flow + zustand).

### Event sourcing is the core invariant

The `commits` table (append-only JSON op arrays) is the **source of truth**; `nodes`/`edges` tables are a materialized cache of replaying it. `CommitService.rebuildCheck()` asserts they never diverge — tests use it as the correctness oracle. Never write to `nodes`/`edges` outside a commit.

- `shared/src/ops.ts` — the op vocabulary (`add_node`, `update_node`, `delete_node`, `move_node`, `add_edge`, `delete_edge`), `applyOp`, `invertOp`. Every op carries before+after (or a full snapshot), which is what makes time-travel, revert, and diff display work. If you add an op type, its inverse must round-trip: `apply(invert(apply(g, op)))` ≡ identity (tested).
- `server/src/commitService.ts` — expands client *intents* (`OpInput`) into full ops (fills `before` fields, computes delete cascades: whole subtree + incident edges, deepest first), validates against a trial in-memory replay, then applies to SQLite in one transaction. Revert = inverse ops as a *new* commit (409 `ConflictError` if it no longer applies); restore = `diffStates(current, stateAt(n))` as a new commit. History is never rewritten.
- All mutations go through `POST /api/commit`; there are no per-entity write endpoints.

### Graph model

Hierarchy is **implicit via `parentId`** on nodes (drives the mind map); only free-form flow-diagram connections live in the `edges` table. Reparenting is a node update and is cycle-checked in both `applyOp` and intent expansion.

### Three views, one store

`web/src/store/graphStore.ts` (zustand) holds canonical state; each view derives its own React Flow props:

- **FlowView** uses persisted `x`/`y` (null → ephemeral fallback grid; first drag persists real coords via a `move_node` commit on drag-end).
- **MindMapView** ignores `x`/`y` entirely — `web/src/layout/mindmapLayout.ts` (d3-hierarchy) computes positions on the fly and they are **never persisted**, so the two views' geometries can't corrupt each other. Nodes are not draggable here.
- **TimelineView** reuses `CommitList` (also used by the history drawer) plus a 0..head scrubber.

Time-travel: `viewingSeq !== null` puts the app in read-only mode — views render from a separate `viewingState` slot (`useDisplayedGraph()` picks the right one), and `guard()` in the store blocks all mutations. `?view=flow|mindmap|timeline` deep-links a view.

UI language is Turkish; keep new user-facing strings in Turkish.
