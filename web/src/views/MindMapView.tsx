import { useMemo } from 'react';
import { Background, Controls, ReactFlow, type Edge } from '@xyflow/react';
import { useGraphStore, useDisplayedGraph } from '../store/graphStore';
import { NodeCard, type FlowNode } from '../components/NodeCard';
import { computeMindmapLayout } from '../layout/mindmapLayout';

const nodeTypes = { card: NodeCard };

export function MindMapView() {
  const { nodes, edges: _flowEdges, readOnly } = useDisplayedGraph();
  const select = useGraphStore((s) => s.select);
  const toggleSelect = useGraphStore((s) => s.toggleSelect);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);

  const { rfNodes, rfEdges } = useMemo(() => {
    const { positions } = computeMindmapLayout(nodes);
    const rfNodes: FlowNode[] = nodes.map((plan) => ({
      id: plan.id,
      type: 'card' as const,
      position: positions.get(plan.id) ?? { x: 0, y: 0 },
      data: { plan, showChildButton: true },
      selected: selectedNodeIds.includes(plan.id),
      draggable: false,
    }));
    const ids = new Set(nodes.map((n) => n.id));
    const rfEdges: Edge[] = nodes
      .filter((n) => n.parentId !== null && ids.has(n.parentId))
      .map((n) => ({
        id: `h-${n.id}`,
        source: n.parentId!,
        target: n.id,
        type: 'bezier',
        className: 'hierarchy-edge',
      }));
    return { rfNodes, rfEdges };
  }, [nodes, selectedNodeIds]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onNodeClick={(e, node) =>
        e.ctrlKey || e.metaKey || e.shiftKey ? toggleSelect(node.id) : select(node.id)
      }
      onPaneClick={() => select(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
