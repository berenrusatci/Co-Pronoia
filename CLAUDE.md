# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Requires Node 22+ (a user-local install lives at `~/.local/opt/node22/bin`; add it to PATH if `node` is missing).

- Before `npm run dev` or tests: Postgres must be running — `docker compose up -d` (see root `docker-compose.yml`), exposed on host port **5433** (5432 is often taken by other local Postgres containers).
- `npm run dev` — runs both dev servers via concurrently: Fastify API on :3001, Vite on :5173 (proxies `/api` incl. WebSocket → :3001). The server script runs `prisma db push` first, so schema changes apply automatically.
- `npm run test` — vitest in `shared/` then `server/` (no web tests)
- `npm run test -w server` — one workspace; add `-- -t "name"` for a single test
- `npm run build` — `prisma generate` + typecheck all workspaces + `vite build`. In prod, Fastify serves `web/dist` if it exists.
- `npm run db:seed -w server` — populates a sample dataset (two users `ayse`/`bora`, password `sifre123`, one canvas with a few nodes/edges/commits) through the real `createCanvas`/`CommitService` code path. Not idempotent — run once against an empty DB.

Database: **PostgreSQL** via **Prisma 7** (driver adapter `@prisma/adapter-pg`), run via Docker (`docker compose up -d`). Connection URL comes from `server/.env` (`DATABASE_URL`) read by `server/prisma.config.ts` — Prisma 7 does not read the URL from schema.prisma. There is no boot-time seed: each canvas gets its root-node seed commit when it is created. No migration files: schema changes go through `prisma db push`. To reset dev data: `docker compose down -v && docker compose up -d && npm run dev -w server` (re-runs `prisma db push`).

Tests get isolated DBs from `server/src/testDb.ts`: one `prisma db push` into a template Postgres database per suite, then a cheap `CREATE DATABASE ... TEMPLATE` per test (`testDbFactory().fresh()`, both `fresh()`/`cleanup()` are async), consumed by `await buildApp(url)` from `server/src/app.ts`. `cleanup()` terminates backends and drops every database it created — always disconnect Prisma clients before calling it (see the single merged `afterAll` in `commitService.test.ts`) or `DROP DATABASE` will stall on lingering connections.

## Architecture

TreeMapper is a collaborative development-planning app with an **in-app commit system** (not real git): every mutation is a numbered commit with an author; concurrent conflicting edits land on branches the user resolves.

npm-workspaces monorepo: `shared/` (types + op engine + WS message types), `server/` (Fastify + Prisma), `web/` (Vite + React + React Flow + zustand).

### Multi-canvas & invites

All graph data is scoped to a **Canvas** (`Canvas`/`CanvasMember`/`Invite` models; `canvasId` on Node/Edge/Commit/Branch). Membership is the only access rule: every `/api/canvases/:canvasId/*` route sits behind a preHandler that 404s non-members (`isMember` in `server/src/canvasService.ts`), and joining someone else's canvas is **only** possible via an invite link (`POST .../invites` → token → `POST /api/invites/:token/accept`, idempotent). Canvas creation (`createCanvas`) writes the owner membership and a seed root-node commit named after the canvas.

`buildApp` keeps a `Map<canvasId, CommitService>` (`serviceFor`) — one instance per canvas so the commit mutex serializes **per canvas**. Commit numbering is per-canvas: `Commit` has `@@id([canvasId, seq])` and `nextSeq()` computes max+1 under the mutex (no autoincrement). Node/Edge PKs are `@@id([canvasId, id])`.

### Roles & regions

Member roles are `owner | editor | viewer` (`CanvasMember.role`, default `editor` on invite accept). The canvas-scope preHandler sets `req.memberRole`; `requireEditor` 403s viewers on every mutating route, `requireOwner` gates member management (`PATCH/DELETE .../members/:userId`), canvas deletion (`DELETE /api/canvases/:canvasId`), and all region writes. The owner role never changes hands and the owner can't be removed.

**Regions** (`Region`/`RegionMember`) are owner-drawn rectangles on flow-view coordinates — config, NOT part of the event-sourced graph. A node inside a region may only be touched by that region's members (owner bypasses; nodes with null x/y are outside every region). Enforcement: `regionViolation()` in `shared/src/regionGuard.ts` runs over **expanded ops** with a scratch replay (so cascaded `delete_edge`/`delete_node` from a subtree delete are each checked; edge ops check both endpoints; `move_node` checks before AND after positions), and is invoked inside `CommitService.applyCommit` via `assertRegions` — the single choke point covering commit, auto-merge, revert, restore, and branch merge alike. Routes thread an `Actor { userId, role }` in; no actor (seed, engine tests) = unchecked; a violation throws `RegionError` → HTTP 403. The web `stage()` runs the same shared check for instant feedback, but the server stays authoritative. Region/member/canvas changes broadcast `regions`/`members`/`canvas_gone` WS messages; `kick()` in app.ts force-closes sockets of removed users / deleted canvases.

### Event sourcing is the core invariant

The `Commit` table (append-only JSON op arrays) is the **source of truth** for main; `Node`/`Edge` tables are a materialized cache of replaying main-branch commits. `CommitService.rebuildCheck()` asserts they never diverge — tests use it as the oracle. Never write `Node`/`Edge` outside a commit. Branch commits (`branchId != null`) do NOT touch the materialized tables; branch state is always computed by replay (`branchState()`).

- `shared/src/ops.ts` — op vocabulary (`add_node`…`delete_edge`), `applyOp`, `invertOp`. Ops carry before+after / full snapshots → time-travel, revert, diffs. New op types must satisfy `apply(invert(apply(g, op)))` ≡ identity (tested).
- `shared/src/expand.ts` — pure intent → ops expansion (fills `before` snapshots, computes delete cascades: incident edges first, then nodes leaf-first). Server and web preview both use it, so they can't drift. `shared/` has zero runtime deps: id generation is an injectable `genId` (default `crypto.randomUUID()`-based; the web passes its own `c`-prefixed one).
- `server/src/commitService.ts` — expands via shared `expandAll`, checks regions (`assertRegions`), validates via trial replay, applies in a `$transaction`. **A promise-chain mutex (`locked()`) serializes all mutating paths — it is load-bearing**: the service is async, and without it interleaved commits corrupt head numbering. Edge edits are `delete_edge`+`add_edge` with the same id in one commit — there is deliberately no `update_edge` op.
- All mutations go through `POST /api/canvases/:canvasId/commit`; no per-entity write endpoints.

### Co-op, branching, conflict rules

Clients send `baseSeq` (the head they saw) with each commit. If head moved: re-expand against current state and compare target sets against intervening commits' ops (`opsConflict()` in commitService — node add/delete are wildcards, updates/moves conflict per-field, edges per-id). Disjoint → auto-merge onto main as a normal commit. Overlapping (or re-expansion throws) → a `Branch` row is created (`{username}/cakisma-{head}`) and the commit lands there, expanded against `stateAt(baseSeq)`. Merge = `diffStates(main, branchState)` as one main commit ("take branch wholesale"); discard just flips status — branch commits stay in the table, filtered out of main replay by `branchId: null`. `seq` is one per-canvas counter shared by that canvas's main and branches, so main numbering has gaps where branch commits exist — expected.

### Auth & WebSocket

Session cookie (`tm_session`) auth: scrypt hashes in `server/src/auth.ts`, routes in `authRoutes.ts`, a global preHandler hook 401s every `/api` route except `/api/auth/*` and `/api/health`. Commits record `authorId` (a null author renders as "sistem").

WS (`/api/ws?canvas=<id>`, broadcast-only — mutations stay on HTTP): the handler closes the socket unless the session user is a member of that canvas; broadcasts go only to clients on the same canvas. Server assigns a `clientId` on connect; clients echo it in commit POSTs; broadcasts carry the originator's `clientId` so the originator skips its own `commit` message (it already applied the HTTP response). Connect/disconnect broadcasts `presence` (active usernames, shown as toolbar chips + green dots in the members panel). Message types in `shared/src/wsMessages.ts`. Password change: `POST /api/auth/password` (revokes other sessions).

### Frontend: dashboard → canvas; one graph store, three views + panels

Login lands on the **dashboard** (`web/src/components/Dashboard.tsx` + `store/canvasStore.ts`): list/create canvases, copy invite links (`{origin}/?davet=<token>`). Opening a canvas sets the API base via `setActiveCanvasId` (in `api/client.ts`) and mounts the graph UI; `← Pano` returns and resets `graphStore`. A `?davet=` URL param is accepted right after login/register in `App.tsx`, then stripped from the URL.

**Push/staging**: mutations do NOT hit the server immediately. `graphStore` keeps `serverNodes/serverEdges` (canonical) plus `pending: OpInput[]`; every view reads the preview (`nodes/edges` = `applyIntents(server, pending)` from `store/applyIntents.ts` — a thin wrapper over shared `expand`+`applyOp` at seq 0, lenient per intent because a WS commit can invalidate a staged intent). The toolbar **Push** button sends all pending intents as ONE commit (`baseSeq` = current head, so the normal auto-merge/branch rules apply); **Vazgeç** drops them. Direct server ops (revert/restore/merge/discard) are blocked while anything is pending. Staged-only entities render with `createdCommit: 0` ("yeni•" badge).

`web/src/store/graphStore.ts` holds canonical state and the WS connection; views derive React Flow props:

- **FlowView** uses persisted `x`/`y`; custom edge component `web/src/components/CurvedEdge.tsx` renders kind styles (flow solid blue, loop orange, dependency dashed purple, relation dotted gray), self-loops (arc over the node), and parallel edges (perpendicular offset by index within the unordered node pair), bidirectional = arrowheads both ends.
- **MindMapView** ignores `x`/`y` — layout computed by `web/src/layout/mindmapLayout.ts` (d3-hierarchy), never persisted. Hierarchy lives in `parentId` on nodes; only free-form connections are `Edge` rows.
- **TimelineView** reuses `CommitList` + scrubber.
- **FlowView also renders regions** as React Flow nodes (type `region`, `zIndex: -10`, id prefix `region:`): translucent rectangles the owner can drag and resize (`NodeResizer` in `RegionNode.tsx`); non-owners see them read-only.
- Side panels (`sidePanel` in store): history, connections (textual edge list with edit/delete), branches (view/merge/discard), members (roles/remove for owner, presence dots), regions (owner: create + per-region member checkboxes).
- Read-only is `useReadOnly()` = time-travel ∨ branch view ∨ viewer role; `stage()` blocks staging accordingly.

Read-only mode is shared by time-travel (`viewingSeq`) and branch viewing (`viewingBranchId`): both load into `viewingState`, `useDisplayedGraph()` picks the right source, `guard()` blocks mutations. `?view=flow|mindmap|timeline` deep-links a view.

UI language is Turkish; keep new user-facing strings in Turkish.
