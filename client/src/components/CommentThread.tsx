import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface Comment {
  id: string;
  user_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Comment thread under a report card: list, add (logged-in only),
 * hide (author or moderator, soft-delete server-side).
 */
export function CommentThread({ reportId }: { reportId: string }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModerator, setIsModerator] = useState(false);

  useEffect(() => {
    api
      .listComments(reportId)
      .then((res) => setComments(res.comments))
      .catch(() => setComments([]));
    api
      .me()
      .then((res) => setIsModerator(!!res.user?.is_moderator))
      .catch(() => {});
  }, [reportId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await api.addComment(reportId, body.trim());
      setComments((prev) => [...(prev ?? []), res.comment]);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post the comment.');
    } finally {
      setPosting(false);
    }
  }

  async function hide(commentId: string) {
    try {
      await api.hideComment(reportId, commentId);
      setComments((prev) => (prev ?? []).filter((c) => c.id !== commentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not hide the comment.');
    }
  }

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
        💬 Comments {comments ? `(${comments.length})` : ''}
      </div>

      {comments === null ? (
        <div style={{ fontSize: 12, color: '#9ca3af' }}>Loading comments…</div>
      ) : comments.length === 0 ? (
        <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
          No comments yet — be the first.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {comments.map((c) => (
            <div key={c.id} style={{ fontSize: 13, lineHeight: 1.4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontWeight: 600, color: '#111827' }}>{c.author_name}</span>
                <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>{timeAgo(c.created_at)}</span>
              </div>
              <div style={{ color: '#374151' }}>{c.body}</div>
              {(user && (c.user_id === user.id || isModerator)) && (
                <button
                  onClick={() => hide(c.id)}
                  style={{
                    fontSize: 11, color: '#991b1b', background: 'none', border: 'none',
                    padding: 0, cursor: 'pointer', textDecoration: 'underline',
                  }}
                >
                  hide
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {user ? (
        <form onSubmit={submit}>
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment…"
            maxLength={500}
            disabled={posting}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
          />
          {error && <p role="alert" style={{ color: '#dc2626', fontSize: 12, margin: '4px 0' }}>{error}</p>}
          <button
            type="submit"
            disabled={posting || !body.trim()}
            style={{
              marginTop: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8,
              border: '1px solid #111827', background: '#111827', color: '#fff',
              cursor: posting || !body.trim() ? 'not-allowed' : 'pointer',
              opacity: posting || !body.trim() ? 0.5 : 1,
            }}
          >
            {posting ? 'Posting…' : 'Comment'}
          </button>
        </form>
      ) : (
        <div style={{ fontSize: 12, color: '#6b7280' }}>Log in to comment.</div>
      )}
    </div>
  );
}
