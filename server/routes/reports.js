const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { computePriority } = require("../lib/priority");
const { findNearbyDuplicate } = require("../lib/duplicates");
const { classifyIssuePhoto, generateComplaintText } = require("../lib/ai");
const { requireAuth } = require("../middleware/auth");
const { perUserRateLimit } = require("../middleware/rateLimit");
const commentsRouter = require("./comments");

const router = express.Router();

// /api/reports/:id/comments — comment thread per report
router.use("/:id/comments", commentsRouter);


/**
 * GET /api/reports
 * Public feed, sorted by priority (default) or recency.
 * Query params: sort=priority|recent, status, category, constituency, limit
 */
router.get("/", async (req, res) => {
  const {
    sort = "priority",
    status,
    category,
    constituency,
    limit = 50,
  } = req.query;

  let query = supabaseAdmin.from("reports").select("*").limit(Number(limit));

  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  if (constituency) query = query.eq("constituency", constituency);

  query = query.order(sort === "recent" ? "created_at" : "priority_score", {
    ascending: false,
  });

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ reports: data });
});

/**
 * POST /api/reports
 * Creates a new report. Photo must already be uploaded to Supabase Storage;
 * client sends the resulting public/signed photo_url.
 * Runs: AI classify -> duplicate check -> priority score -> save, then responds.
 * The AI complaint letter (complaint_text) is drafted asynchronously after
 * the response — the row is created with complaint_text null and filled in
 * a few seconds later (frontend shows a "drafting..." state meanwhile).
 */
// Pre-launch abuse guard: max 10 reports per user per hour.
router.post("/", requireAuth, perUserRateLimit({ max: 10 }), async (req, res) => {
  try {
    const {
      photo_url,
      lat,
      lng,
      ward,
      constituency,
      mla_id,
      description: userDescription,
    } = req.body;

    if (!photo_url || lat == null || lng == null) {
      return res
        .status(400)
        .json({ error: "photo_url, lat, and lng are required" });
    }

    // Photo must be an https URL pointing at an image file type we accept —
    // catches non-image payloads early (before the Claude vision call) and
    // forbids non-https or obviously bogus URLs.
    if (!isValidPhotoUrl(photo_url)) {
      return res.status(400).json({
        error:
          "photo_url must be an https URL ending in .jpg, .jpeg, .png, .webp, or .gif",
      });
    }

    // 1. AI classification — non-blocking on failure: if both attempts
    // fail (timeout/4xx/5xx), save the report unclassified for manual
    // review rather than rejecting the user's submission.
    let category = "other";
    let severity_score = 0;
    let aiDescription = "";
    try {
      ({ category, severity_score, description: aiDescription } =
        await classifyIssuePhoto(photo_url));
    } catch (classifyErr) {
      console.error(
        "[POST /reports] classification failed, saving unclassified:",
        classifyErr.status ?? "",
        classifyErr.message ?? String(classifyErr)
      );
      aiDescription = "Pending manual review";
    }
    const description = userDescription || aiDescription;

    // 2. Duplicate detection
    const dup = await findNearbyDuplicate({ lat, lng, category });
    const duplicate_count = dup ? (dup.duplicate_count ?? 0) + 1 : 0;

    // 3. Priority score
    const created_at = new Date().toISOString();
    const priority_score = computePriority({
      severity_score,
      duplicate_count,
      created_at,
      category,
    });

    // 4. Look up MLA name for the complaint letter, if we have one
    let mlaName = null;
    if (mla_id) {
      const { data: mla } = await supabaseAdmin
        .from("mlas")
        .select("name")
        .eq("id", mla_id)
        .single();
      mlaName = mla?.name ?? null;
    }

    // 5. Insert (complaint_text is drafted async below)
    const { data: inserted, error } = await supabaseAdmin
      .from("reports")
      .insert({
        user_id: req.user.id,
        category,
        description,
        photo_url,
        lat,
        lng,
        ward,
        constituency,
        mla_id: mla_id || null,
        severity_score,
        duplicate_count,
        priority_score,
        created_at,
      })
      .select()
      .single();

    if (error) throw error;

    // 6. If this duplicates an existing report, bump that report's count too
    if (dup) {
      await supabaseAdmin
        .from("reports")
        .update({ duplicate_count: duplicate_count })
        .eq("id", dup.id);
      await supabaseAdmin.from("report_duplicates").insert({
        original_report_id: dup.id,
        duplicate_report_id: inserted.id,
      });
    }

    // 7. Respond now — complaint letter is slow, don't make the user wait.
    res.status(201).json({ report: inserted });

    // 8. Fire-and-forget: draft the official complaint letter and update the
    // row when it's ready. Failures are logged; the report itself is already
    // saved and the user was told submission succeeded.
    generateComplaintText({
      category,
      description,
      ward,
      constituency,
      mlaName,
      lat,
      lng,
      createdAt: created_at,
    })
      .then((complaint_text) =>
        supabaseAdmin
          .from("reports")
          .update({ complaint_text, updated_at: new Date().toISOString() })
          .eq("id", inserted.id)
          .then(({ error: updErr }) => {
            if (updErr) throw updErr;
          }),
      )
      .catch((err) => {
        console.error(
          `complaint draft failed for report ${inserted.id}:`,
          err.message ?? err,
        );
      });
  } catch (err) {
    // err.message verbatim + status code if the SDK attached one; the
    // stringified object alone is undiagnosable.
    console.error(
      `POST /reports failed: ${err.status ?? ""} ${err.message ?? String(err)}`
    );
    res
      .status(500)
      .json({ error: err.message ?? "internal server error" });
  }
});

/**
 * PATCH /api/reports/:id/status
 * Update status (pending/acknowledged/resolved/rejected). Recomputes
 * priority on save (resolved reports drop out of the active feed sort).
 */
router.patch("/:id/status", requireAuth, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ["pending", "acknowledged", "resolved", "rejected"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "invalid status" });
  }

  // Ownership check. The update goes through the service-role client (RLS is
  // bypassed), so we must enforce this here: only the reporting user or a
  // moderator (profiles.is_moderator) may change a report's status.
  const { data: report, error: fetchErr } = await supabaseAdmin
    .from("reports")
    .select("id, user_id")
    .eq("id", req.params.id)
    .single();
  if (fetchErr || !report) {
    return res.status(404).json({ error: "report not found" });
  }
  const { data: profile, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("is_moderator")
    .eq("id", req.user.id)
    .maybeSingle();
  const isModerator = !!profile?.is_moderator;

  if (report.user_id !== req.user.id && !isModerator) {
    return res
      .status(403)
      .json({
        error: "only the reporting user or a moderator can update this report",
      });
  }

  const update = { status, updated_at: new Date().toISOString() };
  if (status === "resolved") update.resolved_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("reports")
    .update(update)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ report: data });
});

/** GET /api/reports/stats - counts for the "X reported, Y resolved" banner */
router.get("/stats/summary", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("reports").select("status");
  if (error) return res.status(500).json({ error: error.message });

  const total = data.length;
  const resolved = data.filter((r) => r.status === "resolved").length;
  res.json({ total, resolved, pending: total - resolved });
});

const PHOTO_URL_PATTERN =
  /^https:\/\/\S+\.(jpg|jpeg|png|webp|gif)(\?\S*)?$/i;

/** Basic server-side photo_url sanity check (type + https). */
function isValidPhotoUrl(url) {
  return typeof url === "string" && PHOTO_URL_PATTERN.test(url);
}

module.exports = router;
