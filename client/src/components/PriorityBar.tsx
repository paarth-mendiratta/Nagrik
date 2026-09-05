function labelAndColor(score: number): { label: string; color: string } {
  if (score >= 75) return { label: 'Critical', color: '#dc2626' };
  if (score >= 50) return { label: 'High', color: '#ea580c' };
  if (score >= 25) return { label: 'Medium', color: '#ca8a04' };
  return { label: 'Low', color: '#16a34a' };
}

export function PriorityBar({ score }: { score: number }) {
  const { label, color } = labelAndColor(score);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 4,
          background: '#e5e7eb',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.min(100, score)}%`,
            height: '100%',
            background: color,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color }}>{label}</span>
    </div>
  );
}
