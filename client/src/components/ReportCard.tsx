import { useEffect, useState } from 'react';
import { PriorityBar } from './PriorityBar';
import { api } from '../lib/api';
import { CommentThread } from './CommentThread';

export interface Report {
  id: string;
  user_id?: string | null;
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

export function ReportCard({ report, onStatusChange }: { report: Report; onStatusChange?: (id: string, status: Report['status']) => void }) {
  const [status, setStatus] = useState<Report['status']>(report.status);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isModerator, setIsModerator] = useState(false);

  // auth is checked lazily so the card works on the public feed (no user)
  // while still enabling owner/moderator actions when logged in
  useEffect(() => {
    api.me()
      .then((res) => {
        setUserId(res.user?.id ?? null);
        setIsModerator(!!res.user?.is_moderator);
      })
      .catch(() => {});
  }, []);

  const canAct = !!userId && (report.user_id === userId || isModerator);
  const days = daysSince(report.created_at);
  const statusStyle = STATUS_STYLES[status];

  async function handleStatus(next: Report['status']) {
    const prev = status;
    setBusy(true);
    setActionError(null);
    setStatus(next); // optimistic
    try {
      await api.updateStatus(report.id, next);
      onStatusChange?.(report.id, next);
    } catch (err) {
      setStatus(prev); // rollback
      setActionError(err instanceof Error ? err.message : 'Could not update — try again.');
    } finally {
      setBusy(false);
    }
  }

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
            {status}
          </span>
        </div>

        <p style={{ fontSize: 14, color: '#374151', marginBottom: 10 }}>{report.description}</p>

        {report.category === 'other' && report.description === 'Pending manual review' && (
          <div style={{ fontSize: 12, color: '#b45309', marginBottom: 10, fontStyle: 'italic' }}>
            ⏳ AI classification pending — you can edit this manually
          </div>
        )}

        <PriorityBar score={report.priority_score} />

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, color: '#6b7280' }}>
          <span>{report.ward || report.constituency || 'Unknown area'}</span>
          <span>{days === 0 ? 'Today' : `${days}d ago`}</span>
        </div>

        {report.duplicate_count > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
            Also reported by {report.duplicate_count} other{report.duplicate_count === 1 ? '' : 's'} nearby
          </div>
        )}

        {canAct && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {status !== 'acknowledged' && (
              <ActionButton disabled={busy} color="#1e40af" onClick={() => handleStatus('acknowledged')}>
                Acknowledge
              </ActionButton>
            )}
            {status !== 'resolved' && (
              <ActionButton disabled={busy} color="#166534" onClick={() => handleStatus('resolved')}>
                ✓ Resolve
              </ActionButton>
            )}
            {status !== 'rejected' && (
              <ActionButton disabled={busy} color="#991b1b" onClick={() => handleStatus('rejected')}>
                Reject
              </ActionButton>
            )}
          </div>
        )}

        {actionError && <p role="alert" style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{actionError}</p>}

        {report.complaint_text == null && status === 'pending' && (
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

        <CommentThread reportId={report.id} />
      </div>
    </div>
  );
}

function ActionButton({ children, onClick, disabled, color }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; color: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: '5px 10px',
        borderRadius: 8,
        border: `1px solid ${color}`,
        color,
        background: '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
