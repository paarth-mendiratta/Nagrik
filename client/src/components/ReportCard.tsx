import { PriorityBar } from './PriorityBar';

export interface Report {
  id: string;
  category: string;
  description: string;
  photo_url: string;
  ward?: string;
  constituency?: string;
  priority_score: number;
  duplicate_count: number;
  complaint_text?: string | null;
  status: 'pending' | 'acknowledged' | 'resolved' | 'rejected';
  created_at: string;
}

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  acknowledged: { bg: '#dbeafe', text: '#1e40af' },
  resolved: { bg: '#dcfce7', text: '#166534' },
  rejected: { bg: '#fee2e2', text: '#991b1b' },
};

export function ReportCard({ report }: { report: Report }) {
  const days = daysSince(report.created_at);
  const statusStyle = STATUS_STYLES[report.status];

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      <img
        src={report.photo_url}
        alt={report.category}
        style={{ width: '100%', height: 180, objectFit: 'cover' }}
      />
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>
            {report.category.replace('_', ' ')}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 999,
              background: statusStyle.bg,
              color: statusStyle.text,
              textTransform: 'capitalize',
            }}
          >
            {report.status}
          </span>
        </div>

        <p style={{ fontSize: 14, color: '#374151', marginBottom: 10 }}>{report.description}</p>

        <PriorityBar score={report.priority_score} />

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, color: '#6b7280' }}>
          <span>{report.ward || report.constituency || 'Unknown area'}</span>
          <span>{days === 0 ? 'Today' : `${days}d ago`}</span>
        </div>

        {report.complaint_text == null && report.status === 'pending' && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>
            ✍️ Drafting complaint letter…
          </div>
        )}
        {report.complaint_text && (
          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: 12, color: '#2563eb', cursor: 'pointer' }}>
              View draft complaint letter
            </summary>
            <p style={{ fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap', marginTop: 6 }}>
              {report.complaint_text}
            </p>
          </details>
        )}
      </div>
    </div>
  );
}
