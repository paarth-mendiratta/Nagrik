/**
 * Priority scoring for Nagrik reports.
 *
 * Combines four signals into a single 0-100 score used to sort the feed
 * and render the priority bar on each report card:
 *   1. Severity      - from AI vision classification (0-10)
 *   2. Duplicates     - how many nearby reports of the same issue
 *   3. Age            - unresolved issues gain priority the longer they sit
 *   4. Category weight - some categories are inherently higher-stakes
 */

const CATEGORY_WEIGHTS = {
  pothole: 6,
  road_damage: 7,
  drainage: 6,
  water_supply: 8,
  streetlight: 5,
  illegal_construction: 6,
  garbage: 4,
  other: 3,
};

const WEIGHTS = {
  severity: 0.4,
  duplicates: 0.25,
  age: 0.2,
  category: 0.15,
};

/** Diminishing-returns curve so 20 duplicate reports doesn't blow past the scale. */
function duplicateScore(duplicateCount) {
  return Math.min(10, Math.log2(duplicateCount + 1) * 3.5);
}

/** Age in days -> 0-10 score, ramps up over ~30 days then plateaus. */
function ageScore(createdAt) {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  return Math.min(10, (ageDays / 30) * 10);
}

/**
 * @param {object} report
 * @param {number} report.severity_score   0-10, from vision classifier
 * @param {number} report.duplicate_count
 * @param {string} report.created_at       ISO timestamp
 * @param {string} report.category
 * @returns {number} priority score, 0-100
 */
function computePriority(report) {
  const severity = clamp(report.severity_score ?? 0, 0, 10);
  const dup = duplicateScore(report.duplicate_count ?? 0);
  const age = ageScore(report.created_at ?? new Date().toISOString());
  const category = CATEGORY_WEIGHTS[report.category] ?? CATEGORY_WEIGHTS.other;

  const raw =
    severity * WEIGHTS.severity +
    dup * WEIGHTS.duplicates +
    age * WEIGHTS.age +
    category * WEIGHTS.category;

  // raw is on a ~0-10 scale (category weight max is 10); scale to 0-100
  return Math.round(clamp(raw, 0, 10) * 10 * 10) / 10;
}

function priorityLabel(score) {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

module.exports = { computePriority, priorityLabel, CATEGORY_WEIGHTS };
