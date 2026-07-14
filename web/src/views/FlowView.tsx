import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background, Controls, MarkerType, MiniMap, ReactFlow,
  type Connection, type NodeChange, applyNodeChanges,
} from '@xyflow/react';
import { useGraphStore, useDisplayedGraph } from '../store/graphStore';
import { useCanvasStore } from '../store/canvasStore';
import { NodeCard, type FlowNode } from '../components/NodeCard';
import { RegionNode, type RegionFlowNode } from '../components/RegionNode';
import { CurvedEdge, type CurvedFlowEdge } from '../components/CurvedEdge';
import { kindStyles } from '../components/CurvedEdge';

const nodeTypes = { card: NodeCard, region: RegionNode };
const edgeTypes = { curved: CurvedEdge };

type CanvasNode = FlowNode | RegionFlowNode;
const REGION_PREFIX = 'region:';

/** Fallback grid placement for nodes never dragged in flow view (x/y null). */
function fallbackPosition(index: number): { x: number; y: number } {
  return { x: 80 + (index % 4) * 300, y: 80 + Math.floor(index / 4) * 140 };
}

export function FlowView() {
  const { nodes, edges, readOnly } = useDisplayedGraph();
  const regions = useGraphStore((s) => s.regions);
  const moveNode = useGraphStore((s) => s.moveNode);
  const updateRegion = useGraphStore((s) => s.updateRegion);
  const connect = useGraphStore((s) => s.connect);
  const select = useGraphStore((s) => s.select);
  const toggleSelect = useGraphStore((s) => s.toggleSelect);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const isOwner = useCanvasStore((s) => s.active?.role === 'owner');

  const initialNodes = useMemo<CanvasNode[]>(() => {
    const regionNodes: RegionFlowNode[] = regions.map((region) => ({
      id: `${REGION_PREFIX}${region.id}`,
      type: 'region' as const,
      position: { x: region.x, y: region.y },
      width: region.width,
      height: region.height,
      data: { region },
      draggable: isOwner && !readOnly,
      selectable: isOwner && !readOnly,
      zIndex: -10,
    }));
    let unplaced = 0;
    const cardNodes: FlowNode[] = nodes.map((plan) => ({
      id: plan.id,
      type: 'card' as const,
      position:
        plan.x !== null && plan.y !== null ? { x: plan.x, y: plan.y } : fallbackPosition(unplaced++),
      data: { plan, showChildButton: false },
      selected: selectedNodeIds.includes(plan.id),
    }));
    return [...regionNodes, ...cardNodes];
  }, [nodes, regions, selectedNodeIds, isOwner, readOnly]);

  // Local copy so dragging is smooth; server state re-syncs it after each commit.
  const [rfNodes, setRfNodes] = useState<CanvasNode[]>(initialNodes);
  useEffect(() => setRfNodes(initialNodes), [initialNodes]);

  const rfEdges = useMemo<CurvedFlowEdge[]>(() => {
    // Group by unordered node pair so parallel edges (and parallel self-loops) fan out.
    const pairCount = new Map<string, number>();
    const pairKey = (e: { sourceId: string; targetId: string }) =>
      [e.sourceId, e.targetId].sort().join('~');
    const pairIndex = new Map<string, number>();
    for (const e of edges) pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) ?? 0) + 1);

    return edges.map((e) => {
      const key = pairKey(e);
      const index = pairIndex.get(key) ?? 0;
      pairIndex.set(key, index + 1);
      const style = kindStyles[e.kind];
      return {
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        type: 'curved' as const,
        data: {
          kind: e.kind,
          direction: e.direction,
          labelText: e.label,
          selfLoop: e.sourceId === e.targetId,
          parallelIndex: index,
          parallelCount: pairCount.get(key) ?? 1,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        ...(e.direction === 'bidirectional'
          ? { markerStart: { type: MarkerType.ArrowClosed, color: style.stroke } }
          : {}),
      };
    });
  }, [edges]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => setRfNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (conn.source && conn.target) connect(conn.source, conn.target);
    },
    [connect],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: CanvasNode) => {
      if (readOnly) return;
      const x = Math.round(node.position.x);
      const y = Math.round(node.position.y);
      if (node.type === 'region') updateRegion(node.id.slice(REGION_PREFIX.length), { x, y });
      else moveNode(node.id, x, y);
    },
    [readOnly, moveNode, updateRegion],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onConnect={readOnly ? undefined : onConnect}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={(e, node) =>
        node.type !== 'region' &&
        (e.ctrlKey || e.metaKey || e.shiftKey ? toggleSelect(node.id) : select(node.id))
      }
      onPaneClick={() => select(null)}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
