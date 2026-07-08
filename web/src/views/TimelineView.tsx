import { useGraphStore } from '../store/graphStore';
import { CommitList } from '../components/CommitList';

export function TimelineView() {
  const headSeq = useGraphStore((s) => s.headSeq);
  const viewingSeq = useGraphStore((s) => s.viewingSeq);
  const viewAt = useGraphStore((s) => s.viewAt);
  const backToLatest = useGraphStore((s) => s.backToLatest);

  const current = viewingSeq ?? headSeq;

  return (
    <div className="timeline-view">
      <div className="timeline-scrubber">
        <span>#0</span>
        <input
          type="range"
          min={0}
          max={headSeq}
          value={current}
          onChange={(e) => {
            const seq = Number(e.target.value);
            if (seq === headSeq) backToLatest();
            else viewAt(seq);
          }}
        />
        <span>#{headSeq}</span>
        <strong className="scrubber-current">#{current}</strong>
      </div>
      <div className="timeline-feed">
        <CommitList />
      </div>
    </div>
  );
}
