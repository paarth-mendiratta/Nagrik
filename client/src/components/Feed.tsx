import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ReportCard, Report } from './ReportCard';

export function Feed() {
  const [reports, setReports] = useState<Report[]>([]);
  const [sort, setSort] = useState<'priority' | 'recent'>('priority');
  const [stats, setStats] = useState<{ total: number; resolved: number; pending: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.listReports({ sort }), api.stats()])
      .then(([reportsRes, statsRes]) => {
        setReports(reportsRes.reports);
        setStats(statsRes);
      })
      .finally(() => setLoading(false));
  }, [sort]);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 20 }}>
      {stats && (
        <div
          style={{
            display: 'flex',
            gap: 24,
            padding: 16,
            marginBottom: 20,
            borderRadius: 12,
            background: '#111827',
            color: '#fff',
          }}
        >
          <Stat label="Reported" value={stats.total} />
          <Stat label="Resolved" value={stats.resolved} />
          <Stat label="Pending" value={stats.pending} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['priority', 'recent'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid #d1d5db',
              background: sort === s ? '#111827' : '#fff',
              color: sort === s ? '#fff' : '#111827',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {s === 'priority' ? 'Most urgent' : 'Most recent'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ReportCardSkeleton key={i} />
          ))}
        </div>
      ) : reports.length === 0 && stats && stats.total > 0 ? (
        <EmptyResults />
      ) : reports.length === 0 ? (
        <p>No reports yet — be the first to flag an issue.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Gray placeholder matching the ReportCard layout while reports load. */
function ReportCardSkeleton() {
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      <div style={{ width: '100%', height: 180, background: '#e5e7eb' }} />
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ width: 90, height: 16, borderRadius: 4, background: '#e5e7eb' }} />
          <div style={{ width: 70, height: 16, borderRadius: 999, background: '#f3f4f6' }} />
        </div>
        <div style={{ height: 12, borderRadius: 4, background: '#e5e7eb', marginBottom: 6 }} />
        <div style={{ height: 12, borderRadius: 4, background: '#f3f4f6', marginBottom: 10, width: '60%' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 6, borderRadius: 4, background: '#f3f4f6' }} />
          <div style={{ width: 44, height: 12, borderRadius: 4, background: '#f3f4f6' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
          <div style={{ width: 80, height: 12, borderRadius: 4, background: '#f3f4f6' }} />
          <div style={{ width: 40, height: 12, borderRadius: 4, background: '#f3f4f6' }} />
        </div>
      </div>
    </div>
  );
}

/** Shown when reports exist overall but the current filter yields none. */
function EmptyResults() {
  return (
    <div
      style={{
        border: '1px dashed #d1d5db',
        borderRadius: 12,
        padding: '40px 20px',
        textAlign: 'center',
        color: '#6b7280',
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 8 }}>🔍</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
        No reports match this filter
      </div>
      <div style={{ fontSize: 13 }}>Try a different category or check back later.</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
    </div>
  );
}
