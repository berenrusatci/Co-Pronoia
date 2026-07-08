import { useCallback, useMemo } from 'react';
import {
  Background, Controls, MarkerType, MiniMap, ReactFlow,
  type Connection, type Edge, type NodeChange, applyNodeChanges,
} from '@xyflow/react';
import { useGraphStore, useDisplayedGraph } from '../store/graphStore';
import { NodeCard, type FlowNode } from '../components/NodeCard';
import { useState, useEffect } from 'react';

const nodeTypes = { card: NodeCard };

/** Fallback grid placement for nodes never dragged in flow view (x/y null). */
function fallbackPosition(id: string, index: number): { x: number; y: number } {
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
        plan.x !== null && plan.y !== null
          ? { x: plan.x, y: plan.y }
          : fallbackPosition(plan.id, unplaced++),
      data: { plan, showChildButton: false },
      selected: plan.id === selectedNodeId,
    }));
  }, [nodes, selectedNodeId]);

  // Local copy so dragging is smooth; server state re-syncs it after each commit.
  const [rfNodes, setRfNodes] = useState<FlowNode[]>(initialNodes);
  useEffect(() => setRfNodes(initialNodes), [initialNodes]);

  const rfEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        label: e.label || undefined,
        markerEnd: { type: MarkerType.ArrowClosed },
        className: 'flow-edge',
      })),
    [edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => setRfNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (conn.source && conn.target && conn.source !== conn.target) connect(conn.source, conn.target);
    },
    [connect],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
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
