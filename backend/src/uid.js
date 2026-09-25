// ─── Patient UIDs, long and short ───
// The UID is a v4 UUID and the only credential the tracker has. The District
// Endocrine text carries it in a shorter spelling: the same 128 bits in base 36,
// 25 characters where the UUID takes 36. Nothing is stored to make that work --
// the short form is the UUID, re-encoded -- so a short link cannot expire or
// collide, and is exactly as hard to guess as the long one. Every route that
// takes a UID goes through resolveUid, which turns either spelling back into the
// UUID before anything touches Redis or monday.
//
// Base 36 rather than 62 because the link goes through medicallymodern.com
// first, and its WordPress redirect lowercases the query string on the way here
// (checked September 2026: ?p=AbC123 arrives as ?p=abc123). Any encoding where
// case carries information would be corrupted in transit.
//
// And not a real short code, medicallymodern.com/t/abc123 or the like, for two
// reasons. That WordPress site 404s every path but /portal, so the query string
// is the only place a code can go. And anything shorter than the UUID has to be
// stored to be looked up, which would make Redis the one thing standing between
// a patient and the only link we ever send them. Nothing else here depends on
// Redis for that.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 36^25 > 2^128 > 36^24, so every UUID fits in exactly 25 characters once padded.
const SHORT_LENGTH = 25;
const UUID_LIMIT = 1n << 128n;

// The short form as it arrives, plus any punctuation stuck to the end. The text
// puts a full stop straight after the link, and a phone that folds it into the
// URL should still land the patient on their tracker.
const SHORT_RE = /^([0-9a-z]{25})[.,;:!?)]*$/;

function shortUid(uid) {
  const str = String(uid);
  if (!UUID_RE.test(str)) return null;
  return BigInt(`0x${str.replace(/-/g, "")}`).toString(36).padStart(SHORT_LENGTH, "0");
}

// Either spelling in, the UUID out -- or null for anything that is neither. A
// UUID passes through exactly as given, as it always has.
function resolveUid(value) {
  const str = String(value ?? "");
  if (UUID_RE.test(str)) return str;

  const match = SHORT_RE.exec(str.toLowerCase());
  if (!match) return null;

  let n = 0n;
  for (const ch of match[1]) n = n * 36n + BigInt(parseInt(ch, 36));
  if (n >= UUID_LIMIT) return null;

  const hex = n.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

module.exports = { UUID_RE, shortUid, resolveUid };
