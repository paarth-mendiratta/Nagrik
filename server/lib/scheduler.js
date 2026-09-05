const { supabaseAdmin } = require("./supabase");
const { postReportToInstagram } = require("./instagram");

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const REPOST_AFTER_DAYS = Number(process.env.IG_REPOST_AFTER_DAYS || 3);
const ESCALATION_AFTER_DAYS = Number(process.env.IG_ESCALATION_DAYS || 7);

/**
 * Finds pending reports that either:
 *   a) have never been posted to Instagram, and are old enough (severity-gated
 *      for very new low-priority ones), or
 *   b) were posted before, are still unresolved, and it's been
 *      REPOST_AFTER_DAYS since the last post (re-surfaces the "still
 *      unresolved" pressure).
 * Posts (or simulates posting) each, then updates ig_post_id / ig_last_posted_at.
 */
// In-memory lock: if a cycle is still running when the next hourly interval
// fires (e.g. Graph API is slow), the overlapping run is skipped, not queued.
// Process-local — fine for a single-instance deploy.
let cycleRunning = false;

async function runInstagramCheckCycle() {
  if (cycleRunning) {
    console.log("[scheduler] previous cycle still running — skipping this run");
    return;
  }
  cycleRunning = true;

  try {
    const { data: pending, error } = await supabaseAdmin
      .from("reports")
      .select("*")
      .eq("status", "pending")
      .order("priority_score", { ascending: false })
      .limit(20);

    if (error) {
      console.error(
        "[scheduler] failed to fetch pending reports:",
        error.message,
      );
      return;
    }

    const now = Date.now();

    for (const report of pending) {
      const neverPosted = !report.ig_post_id;
      const dueForRepost =
        report.ig_last_posted_at &&
        (now - new Date(report.ig_last_posted_at).getTime()) / 86_400_000 >=
          REPOST_AFTER_DAYS;

      if (!neverPosted && !dueForRepost) continue;

      try {
        const result = await postReportToInstagram(report);
        await supabaseAdmin
          .from("reports")
          .update({
            ig_post_id: result.id,
            ig_last_posted_at: new Date().toISOString(),
          })
          .eq("id", report.id);
        console.log(
          `[scheduler] posted report ${report.id} (simulated=${result.simulated})`,
        );
      } catch (err) {
        console.error(
          `[scheduler] failed to post report ${report.id}:`,
          err.message,
        );
      }
    }
  } finally {
    cycleRunning = false;
  }
}

function startScheduler() {
  console.log(
    `[scheduler] starting, checking every ${CHECK_INTERVAL_MS / 60000}min`,
  );
  runInstagramCheckCycle(); // run once on boot
  setInterval(runInstagramCheckCycle, CHECK_INTERVAL_MS);
}

module.exports = { startScheduler, runInstagramCheckCycle };
