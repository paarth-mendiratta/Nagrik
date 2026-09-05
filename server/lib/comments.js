/**
 * Comment body sanitization + crude MVP moderation filter.
 *
 * KNOWN MVP LIMITATION: the blocklist is intentionally crude — a small
 * hardcoded word list, no stemming, no leetspeak handling, no ML. It will
 * miss plenty and occasionally false-positive. It exists to stop the most
 * trivial spam/profanity during a demo, not to be a real moderation system.
 * Swap for a proper filter service before any public launch.
 */

const BLOCKED_WORDS = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'cunt',
  'ranvir', // placeholder for a known spammer name pattern
  'viagra', 'casino', 'crypto giveaway', 'free money',
];

const MAX_COMMENT_LENGTH = 500;

/**
 * Escapes HTML-special characters before storage so a comment like
 * <script>alert(1)</script> renders as inert text (stored-XSS defense
 * in depth — the frontend also renders as text, never innerHTML).
 */
function escapeHtml(str) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}

/**
 * Returns an error message if the comment body is invalid or blocked,
 * or null if it's fine. Validation: non-empty, within length, not on the
 * blocklist (checked pre-escape so word matching isn't confused by entities).
 */
function validateCommentBody(body) {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return 'Comment cannot be empty.';
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    return `Comment is too long — max ${MAX_COMMENT_LENGTH} characters.`;
  }
  const normalized = body.toLowerCase();
  if (BLOCKED_WORDS.some((w) => normalized.includes(w))) {
    return 'Comment blocked by the moderation filter. Please rephrase.';
  }
  return null;
}

module.exports = { escapeHtml, validateCommentBody, MAX_COMMENT_LENGTH };
