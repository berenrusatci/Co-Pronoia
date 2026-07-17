/**
 * "Defne + commit ağacı" alternatif logo işareti — claude.ai/design "Co-pronoia Logo"
 * projesindeki #cp-alt sembolünden. Renkler temaya CSS değişkenleriyle bağlanır:
 * gövde/kenarlar currentColor (--cp-ink), yapraklar --cp-leaf, commit noktaları --cp-dot.
 */
export function CpMark({ className = 'cp-mark' }: { className?: string }) {
  const leaf = 'M0 0 Q6.5 -6 13.5 -1 Q6.5 4 0 0';
  return (
    <svg className={className} viewBox="0 0 96 96" aria-hidden="true">
      <g fill="none" stroke="var(--cp-leaf)" strokeWidth={2} strokeLinecap="round">
        <path d="M44 86 C27 81 14.5 65 13.5 44" />
        <path d="M52 86 C69 81 81.5 65 82.5 44" />
      </g>
      <g fill="var(--cp-leaf)">
        <path d={leaf} transform="translate(34 82.5) rotate(200)" />
        <path d={leaf} transform="translate(24.5 75.5) rotate(215) scale(0.9)" />
        <path d={leaf} transform="translate(18 66) rotate(232) scale(0.85)" />
        <path d={leaf} transform="translate(14.5 55) rotate(250) scale(0.8)" />
        <path d={leaf} transform="translate(13.5 44) rotate(268) scale(0.7)" />
        <path d={leaf} transform="translate(62 82.5) rotate(-20) scale(-1,1)" />
        <path d={leaf} transform="translate(71.5 75.5) rotate(-35) scale(-0.9,0.9)" />
        <path d={leaf} transform="translate(78 66) rotate(-52) scale(-0.85,0.85)" />
        <path d={leaf} transform="translate(81.5 55) rotate(-70) scale(-0.8,0.8)" />
        <path d={leaf} transform="translate(82.5 44) rotate(-88) scale(-0.7,0.7)" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
        <path d="M48 66 C44 58 40 53 38 44" />
        <path d="M48 66 C52 58 56 53 58 44" />
        <path d="M38 44 C40 35 44 30 48 24" />
        <path d="M58 44 C56 35 52 30 48 24" />
      </g>
      <circle cx="48" cy="66" r="4.5" fill="var(--cp-dot)" />
      <circle cx="38" cy="44" r="4" fill="var(--cp-dot)" />
      <circle cx="58" cy="44" r="4" fill="var(--cp-dot)" />
      <circle cx="48" cy="24" r="5" fill="var(--cp-dot)" />
    </svg>
  );
}

/** İşaret + Cinzel serifli "CO·PRONOIA" yazısı — toolbar ve giriş kartlarındaki ortak marka kilidi. */
export function Brand() {
  return (
    <span className="brand-lockup">
      <CpMark />
      <span className="brand-word">CO·PRONOIA</span>
    </span>
  );
}
