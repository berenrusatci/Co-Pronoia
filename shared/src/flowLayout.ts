import type { GraphState, OpInput, PlanNode, RegionInfo } from './types.js';

/**
 * Zihin haritası hiyerarşisini (parentId) akış diyagramına döken saf yerleşim motoru.
 * Deterministiktir (LLM geometri üretmez): her bölgenin İÇİNDEKİ düğümleri o bölgenin
 * dikdörtgenine sığan düzenli bir ağaç olarak dizer ve bölge-içi ebeveyn→çocuk bağları
 * için akış kenarları üretir. Bölgeler arası bağ ÇİZİLMEZ — her bölge kendi içinde kapalı
 * bir diyagram olur. Hiçbir bölgede olmayan düğümler tüm bölgelerin altında ayrı bir küme
 * olarak dizilir. `shared/` bağımlılıksız olduğu için d3 yerine elde katmanlı yerleşim.
 */

/** Bölge kenarından bırakılan iç boşluk (birim). */
const MARGIN = 20;
/** Bölgesiz kümede sabit ızgara aralığı (düğüm ~220x100). */
const OUT_COL = 280;
const OUT_ROW = 140;
/** Bölgesiz kümeyi tüm bölgelerin altına indirmek için pay. */
const OUT_GAP = 80;

type XY = { x: number | null; y: number | null };

/** `agent.ts`/`regionGuard` ile aynı geometrik içerme testi. */
function inRegion(n: XY, r: RegionInfo): boolean {
  return (
    n.x != null && n.y != null &&
    n.x >= r.x && n.x <= r.x + r.width &&
    n.y >= r.y && n.y <= r.y + r.height
  );
}

/** Düğümün MEVCUT konumuna göre içinde bulunduğu ilk bölge (yoksa null). */
function regionOf(n: XY, regions: RegionInfo[]): RegionInfo | null {
  for (const r of regions) if (inRegion(n, r)) return r;
  return null;
}

/**
 * Bir grup düğümü için sütun (derinlik) / satır (ön-sıralı gezinme) ızgarası.
 * parentId yalnızca aynı gruptaki düğümlere kısıtlanır; grup dışı ebeveyni olan düğüm köktür.
 */
function treeGrid(groupNodes: PlanNode[]): Map<string, { col: number; row: number }> {
  const idSet = new Set(groupNodes.map((n) => n.id));
  const byParent = new Map<string | null, PlanNode[]>();
  for (const n of groupNodes) {
    const parent = n.parentId != null && idSet.has(n.parentId) ? n.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(n);
    byParent.set(parent, list);
  }
  const grid = new Map<string, { col: number; row: number }>();
  let row = 0;
  const visit = (n: PlanNode, col: number): void => {
    grid.set(n.id, { col, row: row++ });
    for (const child of byParent.get(n.id) ?? []) visit(child, col + 1);
  };
  for (const root of byParent.get(null) ?? []) visit(root, 0);
  return grid;
}

const maxOf = (grid: Map<string, { col: number; row: number }>, key: 'col' | 'row'): number => {
  let m = 0;
  for (const g of grid.values()) m = Math.max(m, g[key]);
  return m;
};

/**
 * Yerleşim + hiyerarşi kenarı intent'leri üretir.
 * @param regions  kanvastaki TÜM bölgeler (geometrik atama için gerekli).
 * @param layoutRegionIds  yalnızca bu bölgelerdeki düğümler yeniden dizilir (sunucu:
 *   aktörün yazabildiği + aiAllowed bölgeler). Bunların dışında bir bölgede bulunan düğüme
 *   DOKUNULMAZ (guard ihlali / izinsiz taşıma olmasın diye).
 */
export function buildFlowLayoutOps(
  state: GraphState,
  regions: RegionInfo[],
  layoutRegionIds: Set<string>,
): OpInput[] {
  // 1) Her düğümü bir gruba ata: 'region:<id>' | 'outside' | atlanan (grup yok).
  const groupKey = new Map<string, string>();
  const groups = new Map<string, PlanNode[]>();
  for (const n of state.nodes) {
    const r = regionOf(n, regions);
    let key: string | null;
    if (r) key = layoutRegionIds.has(r.id) ? `region:${r.id}` : null; // atlanan bölge → dokunma
    else key = 'outside';
    if (key === null) continue;
    groupKey.set(n.id, key);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
  }

  // 2) Bölgesiz kümenin başlangıç Y'si: tüm bölgelerin ve düğümlerin altında.
  let bottom = 0;
  for (const r of regions) bottom = Math.max(bottom, r.y + r.height);
  for (const n of state.nodes) if (n.y != null) bottom = Math.max(bottom, n.y);
  const outsideStartY = bottom + OUT_GAP;

  // 3) Grup başına hedef konumları hesapla.
  const target = new Map<string, { x: number; y: number }>();
  for (const [key, groupNodes] of groups) {
    const grid = treeGrid(groupNodes);
    if (key === 'outside') {
      for (const n of groupNodes) {
        const g = grid.get(n.id)!;
        target.set(n.id, { x: 40 + g.col * OUT_COL, y: outsideStartY + g.row * OUT_ROW });
      }
      continue;
    }
    const region = regions.find((r) => `region:${r.id}` === key)!;
    const maxCol = maxOf(grid, 'col');
    const maxRow = maxOf(grid, 'row');
    const availW = region.width - 2 * MARGIN;
    const availH = region.height - 2 * MARGIN;
    const colStep = maxCol > 0 ? availW / maxCol : 0;
    const rowStep = maxRow > 0 ? availH / maxRow : 0;
    for (const n of groupNodes) {
      const g = grid.get(n.id)!;
      // Yuvarlama taşmasına karşı kenar payı içinde kıstır.
      const x = Math.min(
        Math.round(region.x + MARGIN + g.col * colStep),
        Math.round(region.x + region.width - MARGIN),
      );
      const y = Math.min(
        Math.round(region.y + MARGIN + g.row * rowStep),
        Math.round(region.y + region.height - MARGIN),
      );
      target.set(n.id, { x, y });
    }
  }

  // 4) move_node intent'leri (yalnızca konum değişiyorsa).
  const ops: OpInput[] = [];
  const posById = new Map(state.nodes.map((n) => [n.id, n] as const));
  for (const [id, t] of target) {
    const cur = posById.get(id)!;
    if (cur.x == null || cur.y == null || Math.round(cur.x) !== t.x || Math.round(cur.y) !== t.y)
      ops.push({ op: 'move_node', id, x: t.x, y: t.y });
  }

  // 5) Bölge-içi (aynı grup) ebeveyn→çocuk için akış kenarı; mevcut kenarı olan çift atlanır.
  const existing = new Set(state.edges.map((e) => `${e.sourceId}->${e.targetId}`));
  for (const n of state.nodes) {
    if (n.parentId == null) continue;
    const key = groupKey.get(n.id);
    if (key === undefined || groupKey.get(n.parentId) !== key) continue; // atlanan veya bölgeler arası
    if (existing.has(`${n.parentId}->${n.id}`)) continue;
    ops.push({ op: 'add_edge', sourceId: n.parentId, targetId: n.id, kind: 'flow', direction: 'directed', label: '' });
  }

  return ops;
}
