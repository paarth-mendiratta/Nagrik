const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { perUserRateLimit } = require('../middleware/rateLimit');
const { escapeHtml, validateCommentBody } = require('../lib/comments');

const router = express.Router({ mergeParams: true }); // mounts under /api/reports/:id

/**
 * Display name for a comment author: profiles.full_name if set, else the
 * email local-part (before @). Never returns the full email.
 */
function displayName(user) {
  if (!user) return 'unknown';
  // profiles lookup happens lazily in GET; here we only have auth.users
  return user.email ? user.email.split('@')[0] : 'user';
}

/**
 * GET /api/reports/:id/comments — public. Non-hidden comments, oldest
 * first, limit/offset pagination (default 50).
 */
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;

  const { data, error } = await supabaseAdmin
    .from('report_comments')
    .select('id, report_id, user_id, body, created_at')
    .eq('report_id', req.params.id)
    .eq('is_hidden', false)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) return res.status(500).json({ error: error.message });

  // Resolve display names in one profiles query (never full emails)
  const userIds = [...new Set(data.map((c) => c.user_id).filter(Boolean))];
  const names = {};
  if (userIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);
    for (const p of profiles ?? []) names[p.id] = p.full_name || null;
  }

  const comments = data.map((c) => ({
    id: c.id,
    report_id: c.report_id,
    user_id: c.user_id,
    author_name: names[c.user_id] || (c.user_id ? 'user' : 'deleted user'),
    body: c.body,
    created_at: c.created_at,
  }));

  res.json({ comments });
});

/**
 * POST /api/reports/:id/comments — authenticated. Body is validated,
 * blocklist-filtered, and HTML-escaped before storage (stored-XSS defense).
 * Rate limited: 5 comments per user per report per hour.
 */
router.post(
  '/',
  requireAuth,
  perUserRateLimit({
    max: 5,
    keyFn: (req) => `${req.user.id}:${req.params.id}`,
    message: 'Rate limit reached — max 5 comments per report per hour.',
  }),
  async (req, res) => {
    const { body } = req.body;

    const invalid = validateCommentBody(body);
    if (invalid) return res.status(400).json({ error: invalid });

    // verify the report exists (comments on missing reports make no sense)
    const { data: report } = await supabaseAdmin
      .from('reports')
      .select('id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!report) return res.status(404).json({ error: 'report not found' });

    const { data: inserted, error } = await supabaseAdmin
      .from('report_comments')
      .insert({
        report_id: req.params.id,
        user_id: req.user.id,
        body: escapeHtml(body.trim()),
      })
      .select('id, report_id, user_id, body, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // display name: profiles.full_name if set, else email prefix
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', req.user.id)
      .maybeSingle();

    res.status(201).json({
      comment: {
        ...inserted,
        author_name: profile?.full_name || displayName(req.user),
      },
    });
  }
);

/**
 * DELETE /api/reports/:id/comments/:commentId — soft delete (is_hidden =
 * true) preserving the audit trail. Only the comment owner or a moderator.
 */
router.delete('/:commentId', requireAuth, async (req, res) => {
  const { commentId } = req.params;

  const { data: comment, error: fetchErr } = await supabaseAdmin
    .from('report_comments')
    .select('id, user_id')
    .eq('id', commentId)
    .maybeSingle();
  if (fetchErr || !comment) {
    return res.status(404).json({ error: 'comment not found' });
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_moderator')
    .eq('id', req.user.id)
    .maybeSingle();
  const isModerator = !!profile?.is_moderator;

  if (comment.user_id !== req.user.id && !isModerator) {
    return res.status(403).json({
      error: 'only the comment author or a moderator can hide this comment',
    });
  }

  const { error } = await supabaseAdmin
    .from('report_comments')
    .update({ is_hidden: true })
    .eq('id', commentId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
