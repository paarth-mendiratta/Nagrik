/**
 * Instagram auto-posting via the Meta Graph API.
 *
 * SETUP REQUIRED (do this on Day 1, not later - approval can be slow):
 *   1. Instagram account must be a Business or Creator account.
 *   2. Connect it to a Facebook Page, create a Meta App at developers.facebook.com.
 *   3. Get a long-lived Page Access Token with instagram_basic +
 *      instagram_content_publish permissions.
 *   4. Set IG_BUSINESS_ACCOUNT_ID and IG_ACCESS_TOKEN in .env.
 *
 * FALLBACK: if API access is stuck in review during the hackathon, set
 * IG_SIMULATE=true in .env - posts will be logged/stored instead of actually
 * published, and the frontend can render them in an Instagram-styled mock
 * feed component for the demo.
 */

const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

const SIMULATE = process.env.IG_SIMULATE === 'true';
const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
}

function buildCaption(report) {
  const days = daysSince(report.created_at);
  const location = report.ward || report.constituency || 'unknown ward';
  return (
    `🚧 UNRESOLVED — ${days} day${days === 1 ? '' : 's'} and counting\n\n` +
    `Category: ${report.category.replace('_', ' ')}\n` +
    `Location: ${location}\n` +
    `${report.description ? report.description + '\n\n' : '\n'}` +
    `Status: Pending official action.\n` +
    `#Nagrik #CivicAccountability #${(report.constituency || '').replace(/\s+/g, '')}`
  );
}

/**
 * Posts (or simulates posting) a report to Instagram. Returns the post id
 * (real or simulated) so it can be saved on the report row.
 */
async function postReportToInstagram(report) {
  const caption = buildCaption(report);

  if (SIMULATE || !IG_BUSINESS_ACCOUNT_ID || !IG_ACCESS_TOKEN) {
    const fakeId = `sim_${report.id}_${Date.now()}`;
    console.log(`[IG SIMULATE] Would post report ${report.id}:\n${caption}`);
    return { id: fakeId, simulated: true, caption };
  }

  // Step 1: create a media container
  const containerRes = await fetch(
    `${GRAPH_API_BASE}/${IG_BUSINESS_ACCOUNT_ID}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: report.photo_url,
        caption,
        access_token: IG_ACCESS_TOKEN,
      }),
    }
  ).then((r) => r.json());

  if (containerRes.error) throw new Error(JSON.stringify(containerRes.error));

  // Step 2: publish the container
  const publishRes = await fetch(
    `${GRAPH_API_BASE}/${IG_BUSINESS_ACCOUNT_ID}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerRes.id,
        access_token: IG_ACCESS_TOKEN,
      }),
    }
  ).then((r) => r.json());

  if (publishRes.error) throw new Error(JSON.stringify(publishRes.error));

  return { id: publishRes.id, simulated: false, caption };
}

module.exports = { postReportToInstagram, buildCaption };
