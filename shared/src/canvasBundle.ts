import type { GraphState, OpInput, PlanEdge, PlanNode, RegionInfo } from './types.js';

/**
 * Kanvas taşınabilirliği (plandaki t-tasima → tp1 "JSON paket şeması"): sürümlü, saf
 * serialize/parse. `shared/` bağımlılıksız olduğu için burada yalnızca veri dönüşümü var;
 * dışa aktarım ucu (tp2) bunu üretir, içe aktarım (tp3) `bundleToIntents` ile commit yoluna sokar.
 *
 * Snapshot paketidir (tam commit geçmişi DEĞİL): mevcut düğüm/kenar/bölge durumu taşınır.
 */

export const CANVAS_BUNDLE_VERSION = 1;
export const CANVAS_BUNDLE_KIND = 'treemapper.canvas';

/** Pakete konan hafif bölge kaydı (üyelik/rol taşınmaz — içe aktaran yeni owner'dır). */
export interface BundleRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  description: string;
  aiAllowed: boolean;
}

export interface CanvasBundle {
  kind: typeof CANVAS_BUNDLE_KIND;
  version: number;
  name: string;
  exportedAt: string;
  nodes: PlanNode[];
  edges: PlanEdge[];
  regions: BundleRegion[];
}

export interface SerializeOptions {
  name: string;
  exportedAt?: string;
  regions?: RegionInfo[];
}

/** GraphState (+ bölgeler) → taşınabilir paket. Saf; yan etkisiz. */
export function serializeCanvas(state: GraphState, opts: SerializeOptions): CanvasBundle {
  return {
    kind: CANVAS_BUNDLE_KIND,
    version: CANVAS_BUNDLE_VERSION,
    name: opts.name,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    nodes: state.nodes,
    edges: state.edges,
    regions: (opts.regions ?? []).map((r) => ({
      name: r.name, x: r.x, y: r.y, width: r.width, height: r.height,
      color: r.color, description: r.description, aiAllowed: r.aiAllowed,
    })),
  };
}

export class BundleError extends Error {}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asNumOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Ham (güvenilmez) JSON → doğrulanmış CanvasBundle. Bilinmeyen sürüm ya da bozuk yapı → BundleError.
 * Alanlar savunmacı biçimde normalize edilir; eksik opsiyonel alanlar varsayılana çekilir.
 */
export function parseCanvasBundle(raw: unknown): CanvasBundle {
  if (!raw || typeof raw !== 'object') throw new BundleError('geçersiz paket: nesne değil');
  const o = raw as Record<string, unknown>;
  if (o.kind !== CANVAS_BUNDLE_KIND) throw new BundleError('geçersiz paket: Co-Pronoia kanvas paketi değil');
  if (o.version !== CANVAS_BUNDLE_VERSION) throw new BundleError(`desteklenmeyen paket sürümü: ${String(o.version)}`);
  if (!Array.isArray(o.nodes)) throw new BundleError('geçersiz paket: nodes dizisi yok');
  const edges = Array.isArray(o.edges) ? o.edges : [];
  const regions = Array.isArray(o.regions) ? o.regions : [];

  const nodes: PlanNode[] = (o.nodes as unknown[]).map((n, i) => {
    const x = n as Record<string, unknown>;
    const id = asString(x.id);
    if (!id) throw new BundleError(`geçersiz düğüm (index ${i}): id yok`);
    const nt = asString(x.nodeType, 'task');
    const st = asString(x.status, 'planned');
    return {
      id,
      parentId: typeof x.parentId === 'string' ? x.parentId : null,
      title: asString(x.title, '(başlıksız)'),
      description: asString(x.description),
      nodeType: (['task', 'idea', 'feature', 'milestone'].includes(nt) ? nt : 'task') as PlanNode['nodeType'],
      status: (['planned', 'in_progress', 'done'].includes(st) ? st : 'planned') as PlanNode['status'],
      x: asNumOrNull(x.x),
      y: asNumOrNull(x.y),
      linkedCanvasId: null, // bağlantı taşınmaz (başka kanvasa işaret eder); tp6 remap işi.
      notes: asString(x.notes),
      url: asString(x.url),
      urlBy: null,
      data: x.data && typeof x.data === 'object' && !Array.isArray(x.data) ? (x.data as Record<string, string>) : {},
      createdCommit: 0,
      updatedCommit: 0,
    };
  });

  const parsedEdges: PlanEdge[] = (edges as unknown[]).map((e, i) => {
    const x = e as Record<string, unknown>;
    const sourceId = asString(x.sourceId);
    const targetId = asString(x.targetId);
    if (!sourceId || !targetId) throw new BundleError(`geçersiz kenar (index ${i}): uç yok`);
    const kind = asString(x.kind, 'flow');
    const dir = asString(x.direction, 'directed');
    return {
      id: asString(x.id) || `e${i}`,
      sourceId,
      targetId,
      kind: (['flow', 'loop', 'dependency', 'relation'].includes(kind) ? kind : 'flow') as PlanEdge['kind'],
      direction: (dir === 'bidirectional' ? 'bidirectional' : 'directed') as PlanEdge['direction'],
      label: asString(x.label),
      createdCommit: 0,
    };
  });

  const parsedRegions: BundleRegion[] = (regions as unknown[]).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      name: asString(x.name, 'Bölge'),
      x: asNumOrNull(x.x) ?? 0,
      y: asNumOrNull(x.y) ?? 0,
      width: asNumOrNull(x.width) ?? 100,
      height: asNumOrNull(x.height) ?? 100,
      color: asString(x.color, '#8888ff'),
      description: asString(x.description),
      aiAllowed: x.aiAllowed !== false,
    };
  });

  return {
    kind: CANVAS_BUNDLE_KIND,
    version: CANVAS_BUNDLE_VERSION,
    name: asString(o.name, 'İçe aktarılan kanvas'),
    exportedAt: asString(o.exportedAt),
    nodes,
    edges: parsedEdges,
    regions: parsedRegions,
  };
}

/**
 * Paketin düğüm+kenarlarını TEK commit'e uygun sıralı intent dizisine çevirir: ebeveynler
 * çocuklardan önce (add_node parent'ın var olmasını bekleyebilir), sonra kenarlar. Pakette
 * olmayan bir ebeveyne işaret eden düğüm kök yapılır. linkedCanvasId taşınmaz.
 */
export function bundleToIntents(bundle: CanvasBundle): OpInput[] {
  const ids = new Set(bundle.nodes.map((n) => n.id));
  const childrenOf = new Map<string | null, PlanNode[]>();
  for (const n of bundle.nodes) {
    const parent = n.parentId != null && ids.has(n.parentId) ? n.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(n);
    childrenOf.set(parent, list);
  }
  const ordered: PlanNode[] = [];
  const visit = (n: PlanNode): void => {
    ordered.push(n);
    for (const c of childrenOf.get(n.id) ?? []) visit(c);
  };
  for (const root of childrenOf.get(null) ?? []) visit(root);
  // Ulaşılamayan (döngüsel) düğüm kalırsa yine de ekle.
  if (ordered.length < bundle.nodes.length) {
    const seen = new Set(ordered.map((n) => n.id));
    for (const n of bundle.nodes) if (!seen.has(n.id)) ordered.push(n);
  }

  const intents: OpInput[] = ordered.map((n) => ({
    op: 'add_node',
    id: n.id,
    parentId: n.parentId != null && ids.has(n.parentId) ? n.parentId : null,
    title: n.title,
    description: n.description,
    nodeType: n.nodeType,
    status: n.status,
    x: n.x,
    y: n.y,
    notes: n.notes,
    url: n.url,
    data: n.data,
  }));
  for (const e of bundle.edges) {
    if (!ids.has(e.sourceId) || !ids.has(e.targetId)) continue; // sarkan kenarı atla
    intents.push({ op: 'add_edge', id: e.id, sourceId: e.sourceId, targetId: e.targetId, kind: e.kind, direction: e.direction, label: e.label });
  }
  return intents;
}
