import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background, Controls, MarkerType, MiniMap, ReactFlow,
  type Connection, type NodeChange, applyNodeChanges,
} from '@xyflow/react';
import { useGraphStore, useDisplayedGraph } from '../store/graphStore';
import { NodeCard, type FlowNode } from '../components/NodeCard';
import { CurvedEdge, type CurvedFlowEdge } from '../components/CurvedEdge';
import { kindStyles } from '../components/CurvedEdge';

const nodeTypes = { card: NodeCard };
const edgeTypes = { curved: CurvedEdge };

/** Fallback grid placement for nodes never dragged in flow view (x/y null). */
function fallbackPosition(index: number): { x: number; y: number } {
  return { x: 80 + (index % 4) * 300, y: 80 + Math.floor(index / 4) * 140 };
}

export function FlowView() {
  const { nodes, edges, readOnly } = useDisplayedGraph();
  const moveNode = useGraphStore((s) => s.moveNode);
  const connect = useGraphStore((s) => s.connect);
  const select = useGraphStore((s) => s.select);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);

  const initialNodes = useMemo<FlowNode[]>(() => {
    let unplaced = 0;
    return nodes.map((plan) => ({
      id: plan.id,
      type: 'card' as const,
      position:
        plan.x !== null && plan.y !== null ? { x: plan.x, y: plan.y } : fallbackPosition(unplaced++),
      data: { plan, showChildButton: false },
      selected: plan.id === selectedNodeId,
    }));
  }, [nodes, selectedNodeId]);

  // Local copy so dragging is smooth; server state re-syncs it after each commit.
  const [rfNodes, setRfNodes] = useState<FlowNode[]>(initialNodes);
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
    (changes: NodeChange<FlowNode>[]) => setRfNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (conn.source && conn.target) connect(conn.source, conn.target);
    },
    [connect],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onConnect={readOnly ? undefined : onConnect}
      onNodeDragStop={(_, node) => !readOnly && moveNode(node.id, Math.round(node.position.x), Math.round(node.position.y))}
      onNodeClick={(_, node) => select(node.id)}
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
