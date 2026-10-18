// Compares the customer's KYC name with the payer name from the payment email.
// Returns "full", "partial" or "none".
const TITLES = new Set(["mr", "mrs", "ms", "miss", "mister", "shri", "sri", "smt", "dr"]);

function tokens(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t));
}

// true when two words differ by at most one letter
function withinOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenMatch(a, b) {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0]; // initial, like "K" for "Kumar"
  return a.length >= 5 && b.length >= 5 && withinOne(a, b); // small spelling slip
}

export function compareNames(expected, actual) {
  const A = tokens(expected);
  const B = tokens(actual);
  if (!A.length || !B.length) return "none";

  // same words in any order = full match
  if ([...A].sort().join(" ") === [...B].sort().join(" ")) return "full";

  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  const used = new Set();

  for (const t of short) {
    let found = -1;
    for (let i = 0; i < long.length; i++) {
      if (!used.has(i) && long[i] === t) { found = i; break; }
    }
    if (found < 0) {
      for (let i = 0; i < long.length; i++) {
        if (!used.has(i) && tokenMatch(t, long[i])) { found = i; break; }
      }
    }
    if (found < 0) return "none";
    used.add(found);
  }
  return "partial";
}
