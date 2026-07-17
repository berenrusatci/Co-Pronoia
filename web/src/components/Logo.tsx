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

/** Google'ın resmî çok renkli "G" işareti — sabit marka renkleri, temaya bağlanmaz. */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.8-6.8C35.6 2.4 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.9 6.1C12.3 13.6 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.8 6.6-9.5 6.6-16z" />
      <path fill="#FBBC05" d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.1-5.5c-2 1.3-4.6 2.1-8.1 2.1-6.4 0-11.7-4.1-13.6-9.6l-7.9 6.1C6.4 42.6 14.6 48 24 48z" />
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
