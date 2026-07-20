import { z } from 'zod';
import type { OpInput } from '@treemapper/shared';

/**
 * MCP araçlarına gelen intent'lerin zod şeması. `satisfies` sayesinde shared `OpInput`
 * tipinden saparsa derleme kırılır — iki tanım birbirinden kayamaz. `linkedCanvasId`
 * burada kabul edilir; aynı-grup doğrulaması uygulama anında `assertLinkedCanvases`ta yapılır.
 */

const nodeType = z.enum(['task', 'idea', 'feature', 'milestone']);
const nodeStatus = z.enum(['planned', 'in_progress', 'done']);
const edgeKind = z.enum(['flow', 'loop', 'dependency', 'relation']);
const edgeDirection = z.enum(['directed', 'bidirectional']);

/** Serbest özel alanlar: en fazla 50 anahtar, string değerler. */
const nodeData = z
  .record(z.string().min(1).max(100), z.string().max(2000))
  .refine((v) => Object.keys(v).length <= 50, { message: 'en fazla 50 özel alan' });

const nodeFields = z
  .object({
    parentId: z.string().nullable(),
    title: z.string().min(1).max(200),
    description: z.string().max(2000),
    nodeType,
    status: nodeStatus,
    linkedCanvasId: z.string().nullable(),
    notes: z.string().max(20000),
    data: nodeData,
  })
  .partial();

export const opInputSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    id: z.string().max(64).optional(),
    parentId: z.string().nullable().optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    nodeType: nodeType.optional(),
    status: nodeStatus.optional(),
    x: z.number().finite().nullable().optional(),
    y: z.number().finite().nullable().optional(),
    linkedCanvasId: z.string().nullable().optional(),
    notes: z.string().max(20000).optional(),
    data: nodeData.optional(),
  }),
  z.object({ op: z.literal('update_node'), id: z.string(), fields: nodeFields }),
  z.object({ op: z.literal('delete_node'), id: z.string() }),
  z.object({ op: z.literal('move_node'), id: z.string(), x: z.number().finite(), y: z.number().finite() }),
  z.object({
    op: z.literal('add_edge'),
    id: z.string().max(64).optional(),
    sourceId: z.string(),
    targetId: z.string(),
    label: z.string().max(200).optional(),
    kind: edgeKind.optional(),
    direction: edgeDirection.optional(),
  }),
  z.object({ op: z.literal('delete_edge'), id: z.string() }),
]) satisfies z.ZodType<OpInput>;
