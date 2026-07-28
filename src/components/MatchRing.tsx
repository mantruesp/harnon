export default function MatchRing({ score }: { score?: number }) {
  const r = 20, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, score || 0));
  const col = pct >= 80 ? "#0F8A5F" : pct >= 60 ? "#0E7C7B" : "#C77C1E";
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" style={{ flex: "none" }}>
      <circle cx="26" cy="26" r={r} fill="none" stroke="#E3EAE8" strokeWidth="5" />
      <circle cx="26" cy="26" r={r} fill="none" stroke={col} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 26 26)" />
      <text x="26" y="30" textAnchor="middle" fontSize="14" fontWeight="700" fill={col}
        fontFamily="'Space Grotesk',sans-serif">{pct}</text>
    </svg>
  );
}
