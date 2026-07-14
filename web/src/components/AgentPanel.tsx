import { useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';

export function AgentPanel() {
  const agentLog = useGraphStore((s) => s.agentLog);
  const agentBusy = useGraphStore((s) => s.agentBusy);
  const askAgent = useGraphStore((s) => s.askAgent);
  const agentDetail = useGraphStore((s) => s.agentDetail);
  const setAgentDetail = useGraphStore((s) => s.setAgentDetail);
  const [prompt, setPrompt] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [agentLog, agentBusy]);

  const send = () => {
    if (!prompt.trim() || agentBusy) return;
    void askAgent(prompt);
    setPrompt('');
  };

  return (
    <aside className="side-panel agent-panel">
      <h3>✨ Ajan</h3>
      <div className="agent-log" ref={logRef}>
        {agentLog.length === 0 && (
          <p className="empty-note">
            Kanvasla doğal dilde konuşun. Örnekler: <em>"kanvası özetle"</em>, <em>"backend bölgesine üç
            adımlı auth akışı çiz"</em>, <em>"tamamlanan düğümleri listele"</em>. Değişiklikler tek commit
            olarak gider ve geçmişte "ajan:" mesajıyla görünür.
          </p>
        )}
        {agentLog.map((entry, i) => (
          <div key={i} className={`agent-msg ${entry.who}${entry.isError ? ' error' : ''}`}>
            <div className="agent-msg-text">{entry.text}</div>
            {entry.commitSeq !== undefined && <div className="agent-msg-meta">✓ commit #{entry.commitSeq}</div>}
            {entry.branched && <div className="agent-msg-meta">⑂ dala yazıldı</div>}
          </div>
        ))}
        {agentBusy && <div className="agent-msg agent thinking">Düşünüyor…</div>}
      </div>
      <div className="agent-input">
        <div className="agent-detail-switch" title="Çizim isteklerinde ne kadar ayrıntıya girileceği">
          <button
            className={agentDetail === 'proto' ? 'active' : ''}
            onClick={() => setAgentDetail('proto')}
            title="Hızlı iskelet: 3-6 düğüm, kısa açıklamalar"
          >
            Prototip
          </button>
          <button
            className={agentDetail === 'detailed' ? 'active' : ''}
            onClick={() => setAgentDetail('detailed')}
            title="Kapsamlı döküm: alt adımlar, açıklamalar, bağımlılık kenarları"
          >
            Detaylı
          </button>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ajana bir komut yazın… (Enter: gönder, Shift+Enter: yeni satır)"
          rows={3}
          disabled={agentBusy}
        />
        <button className="primary" onClick={send} disabled={agentBusy || !prompt.trim()}>
          Gönder
        </button>
      </div>
    </aside>
  );
}
