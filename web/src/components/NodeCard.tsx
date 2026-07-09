import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { NodeStatus, NodeType, PlanNode } from '@treemapper/shared';
import { useGraphStore, useReadOnly } from '../store/graphStore';

export type FlowNodeData = { plan: PlanNode; showChildButton: boolean };
export type FlowNode = Node<FlowNodeData, 'card'>;

const typeIcons: Record<NodeType, string> = { task: '☐', idea: '💡', feature: '⭑', milestone: '⚑' };
const statusLabels: Record<NodeStatus, string> = { planned: 'planlandı', in_progress: 'devam ediyor', done: 'bitti' };

export function NodeCard({ data, selected }: NodeProps<FlowNode>) {
  const { plan, showChildButton } = data;
  const addNode = useGraphStore((s) => s.addNode);
  const readOnly = useReadOnly();

  return (
    <div className={`node-card type-${plan.nodeType} status-${plan.status}${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-card-head">
        <span className="node-card-icon">{typeIcons[plan.nodeType]}</span>
        <span className="node-card-title">{plan.title}</span>
      </div>
      <div className="node-card-meta">
        <span className={`status-pill status-${plan.status}`}>{statusLabels[plan.status]}</span>
        <span className="commit-badge">{plan.createdCommit === 0 ? 'yeni•' : `#${plan.createdCommit}`}</span>
      </div>
      {showChildButton && !readOnly && (
        <button
          className="add-child-btn"
          title="Alt düğüm ekle"
          onClick={(e) => {
            e.stopPropagation();
            addNode({ title: 'Yeni düğüm', parentId: plan.id });
          }}
        >
          +
        </button>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
