#!/usr/bin/env bash
# Post-deploy verification for the Nagrik backend.
#
# Usage: ./scripts/verify-deploy.sh https://your-backend.onrender.com
#
# Checks:
#   1. GET  /api/health returns {"ok":true}
#   2. POST /api/auth/login with a bad password returns a proper 401
#      (proves the API is reachable and error handling works — a CORS
#      misconfig shows up here as a network error instead)
#   3. Reports CORS-relevant response headers on a cross-origin-style
#      request so the deployed allowlist can be eyeballed without devtools
set -euo pipefail

BASE="${1:?Usage: verify-deploy.sh <backend-url>  e.g. https://nagrik-api.onrender.com}"
# strip trailing slash so URL joins are predictable
BASE="${BASE%/}"
ORIGIN="${2:-https://nagrik.vercel.app}" # simulated browser origin for CORS checks

pass() { echo "✅ $1"; }
fail() { echo "❌ $1"; FAILED=1; }
FAILED=0

echo "== Nagrik deploy verification =="
echo "Backend: $BASE"
echo "Simulated browser origin: $ORIGIN"
echo

# --- 1. health ---
echo "-- 1. GET /api/health --"
HEALTH_CODE=$(curl -s -o /tmp/nagrik-health.json -w "%{http_code}" "$BASE/api/health")
HEALTH_BODY=$(cat /tmp/nagrik-health.json)
if [ "$HEALTH_CODE" = "200" ] && echo "$HEALTH_BODY" | grep -q '"ok": *true'; then
  pass "health: 200 $HEALTH_BODY"
else
  fail "health: expected 200 {\"ok\":true}, got $HEALTH_CODE $HEALTH_BODY"
fi
echo

# --- 2. bad login -> 401 (not 500, not CORS failure) ---
echo "-- 2. POST /api/auth/login (bad password, cross-origin style) --"
LOGIN_CODE=$(curl -s -o /tmp/nagrik-login.json -w "%{http_code}" \
  -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"email":"probe@deploy.check","password":"wrong-password-on-purpose"}')
LOGIN_BODY=$(cat /tmp/nagrik-login.json)
if [ "$LOGIN_CODE" = "401" ]; then
  pass "login rejects bad credentials with 401: $LOGIN_BODY"
else
  fail "login: expected 401, got $LOGIN_CODE $LOGIN_BODY"
  echo "   (a 0/empty or network error usually means CORS/cloud-function issue;"
  echo "    a 500 means the server crashed handling the request)"
fi
echo

# --- 3. CORS headers ---
echo "-- 3. CORS preflight from $ORIGIN --"
PREFLIGHT=$(curl -s -i -X OPTIONS "$BASE/api/reports" \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type")

ACAO=$(echo "$PREFLIGHT" | grep -i "^access-control-allow-origin:" | tr -d '\r' | awk '{print $2}' || true)
ACAC=$(echo "$PREFLIGHT" | grep -i "^access-control-allow-credentials:" | tr -d '\r' | awk '{print $2}' || true)

if [ -n "$ACAO" ]; then
  if [ "$ACAO" = "$ORIGIN" ]; then
    pass "access-control-allow-origin: $ACAO (exact match for simulated origin)"
  else
    fail "access-control-allow-origin: $ACAO — does NOT match $ORIGIN (check CLIENT_URL on Render)"
  fi
else
  fail "no access-control-allow-origin header — origin rejected or CORS misconfigured"
fi

if [ "$ACAC" = "true" ]; then
  pass "access-control-allow-credentials: true"
else
  fail "access-control-allow-credentials: '$ACAC' — expected 'true' (cookies won't flow cross-origin without it)"
fi
echo

# --- 3b. foreign origin must NOT be allowed ---
echo "-- 3b. CORS preflight from a foreign origin (must be rejected) --"
FOREIGN=$(curl -s -i -X OPTIONS "$BASE/api/reports" \
  -H "Origin: https://evil-example.com" \
  -H "Access-Control-Request-Method: POST")
FOREIGN_ACAO=$(echo "$FOREIGN" | grep -i "^access-control-allow-origin:" | tr -d '\r' | awk '{print $2}' || true)
if [ -z "$FOREIGN_ACAO" ]; then
  pass "foreign origin not granted access (no ACAO header returned)"
elif [ "$FOREIGN_ACAO" = "*" ]; then
  fail "access-control-allow-origin: * — wildcard! CSRF defense is BROKEN, check CLIENT_URL"
else
  fail "foreign origin got ACAO: $FOREIGN_ACAO — expected none"
fi
echo

echo "== Result: $([ $FAILED = 0 ] && echo 'ALL CHECKS PASSED' || echo 'FAILURES ABOVE') =="
exit $FAILED
