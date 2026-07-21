import { describe, expect, it } from 'vitest';
import { buildPdfModel, PDF_TEMPLATES, resolveTemplate } from './pdfModel.js';
import type { GraphState, PlanNode } from './types.js';

function node(id: string, title: string, parentId: string | null, status: PlanNode['status'] = 'planned'): PlanNode {
  return {
    id, title, description: '', parentId, nodeType: 'task', status, x: null, y: null,
    linkedCanvasId: null, notes: '', url: '', urlBy: null, data: {}, createdCommit: 1, updatedCommit: 1,
  };
}

function state(nodes: PlanNode[]): GraphState {
  return { nodes, edges: [], headSeq: nodes.length };
}

describe('resolveTemplate', () => {
  it('bilinen id → o şablon; bilinmeyen/eksik → a4-portrait', () => {
    expect(resolveTemplate('a3-landscape').id).toBe('a3-landscape');
    expect(resolveTemplate('presentation')).toBe(PDF_TEMPLATES.presentation);
    expect(resolveTemplate(undefined).id).toBe('a4-portrait');
    expect(resolveTemplate('zart').id).toBe('a4-portrait');
  });
});

describe('buildPdfModel', () => {
  it('kök + çocuklar için kutu, çizgi ve metin ilkelleri üretir', () => {
    const nodes = [
      node('r', 'Kök', null),
      node('a', 'Çocuk A', 'r', 'done'),
      node('b', 'Çocuk şğıİ B', 'r'),
    ];
    const model = buildPdfModel(state(nodes), { title: 'Test Kanvas', template: 'a3-landscape' });
    expect(model.template).toBe('a3-landscape');
    expect(model.nodeCount).toBe(3);
    expect(model.doneCount).toBe(1);
    expect(model.pages).toHaveLength(1);
    const prims = model.pages[0].prims;
    const rects = prims.filter((p) => p.kind === 'rect');
    const lines = prims.filter((p) => p.kind === 'line');
    const texts = prims.filter((p) => p.kind === 'text');
    // 3 düğüm kutusu.
    expect(rects.length).toBe(3);
    // 2 ebeveyn→çocuk bağlayıcı çizgi.
    expect(lines.length).toBe(2);
    // Başlık + kök başlıklar en az.
    expect(texts.some((t) => t.kind === 'text' && t.text === 'Test Kanvas')).toBe(true);
    // Her ilkel sayfa sınırları içinde.
    const { widthPt, heightPt } = model.pages[0];
    for (const p of prims) {
      if (p.kind === 'rect') {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x + p.w).toBeLessThanOrEqual(widthPt + 1);
        expect(p.y + p.h).toBeLessThanOrEqual(heightPt + 1);
      }
    }
  });

  it('boş kanvas → çökme yok, tek sayfa', () => {
    const model = buildPdfModel(state([]), {});
    expect(model.nodeCount).toBe(0);
    expect(model.pages).toHaveLength(1);
  });

  it('eksik/dış parentId olan düğüm kök gibi ele alınır (bağlayıcı çizgi üretilmez)', () => {
    const nodes = [node('x', 'Yetim', 'yok-parent')];
    const model = buildPdfModel(state(nodes), {});
    const lines = model.pages[0].prims.filter((p) => p.kind === 'line');
    expect(lines.length).toBe(0);
    expect(model.pages[0].prims.filter((p) => p.kind === 'rect').length).toBe(1);
  });

  it('çok sayıda düğüm sayfaya sığar (ölçek ≤ 1, taşma yok)', () => {
    const nodes: PlanNode[] = [node('r', 'Kök', null)];
    for (let i = 0; i < 60; i++) nodes.push(node(`n${i}`, `Düğüm ${i}`, 'r'));
    const model = buildPdfModel(state(nodes), { template: 'a4-portrait' });
    const { widthPt, heightPt } = model.pages[0];
    for (const p of model.pages[0].prims) {
      if (p.kind === 'rect') {
        expect(p.x + p.w).toBeLessThanOrEqual(widthPt + 1);
        expect(p.y + p.h).toBeLessThanOrEqual(heightPt + 1);
      }
    }
  });
});
