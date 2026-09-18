// ============================================================
// Document merge — the data-integrity rule for the QA vault
// ============================================================
// The vault syncs as one JSON blob. Every client pushes its whole copy of
// localStorage, so a client that loaded before someone else's upload will
// push a blob that is missing that upload. Writing such a blob verbatim
// erases the newer attachment for everyone — which is how PDF attachments
// went missing in Sept 2026.
//
// The rule enforced here: a push may add and update, but it may never erase
// an attachment pointer it simply hadn't heard about yet. Deletion of a whole
// document stays possible, but only through an explicit tombstone.
//
// Used server-side by /api/data/backup. The browser adapter applies the same
// rule when hydrating, so neither direction can drop an attachment.

const upper = (v) => String(v == null ? "" : v).toUpperCase();

/** A pointer is only useful if it names a file that actually exists in Drive. */
function namesDriveFile(att) {
  return !!(att && typeof att === "object" && att.driveFileId);
}

/**
 * Decide which of two attachment records survives.
 * A pointer naming a real Drive file always beats one that does not, so a
 * stale `null` can never overwrite a real upload. When both name a file, the
 * more recent upload wins — that is a genuine replacement, not a stale write.
 */
export function pickAttachment(incoming, existing) {
  if (namesDriveFile(incoming) && namesDriveFile(existing)) {
    if (incoming.driveFileId === existing.driveFileId) return incoming;
    return (existing.uploadedAt || "") > (incoming.uploadedAt || "") ? existing : incoming;
  }
  if (namesDriveFile(existing)) return existing;
  if (namesDriveFile(incoming)) return incoming;
  return incoming !== undefined && incoming !== null ? incoming : (existing ?? null);
}

/** Identity of a revision-history entry, for union-ing two histories. */
const historyKey = (h) =>
  JSON.stringify([h && h.version, h && h.date, h && h.author, h && h.changes]);

/**
 * Union two revision histories without losing an entry from either side.
 * Incoming order is preserved; anything only the existing copy knows about is
 * appended rather than dropped.
 */
export function mergeHistory(incoming, existing) {
  const a = Array.isArray(incoming) ? incoming : [];
  const b = Array.isArray(existing) ? existing : [];
  if (!b.length) return a;
  if (!a.length) return b;
  const seen = new Set(a.map(historyKey));
  const extra = b.filter((h) => !seen.has(historyKey(h)));
  return extra.length ? [...a, ...extra] : a;
}

/** Merge one document record. Incoming wins on metadata; attachments are protected. */
export function mergeDocument(incoming, existing) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const merged = { ...existing, ...incoming };
  merged.wordFile = pickAttachment(incoming.wordFile, existing.wordFile);
  merged.pdfFile = pickAttachment(incoming.pdfFile, existing.pdfFile);
  const history = mergeHistory(incoming.history, existing.history);
  if (history.length) merged.history = history;
  return merged;
}

/**
 * Merge a pushed document array against what is already stored.
 *
 * - documents in either side are kept (union by id, case-insensitive)
 * - shared documents take the incoming metadata, but keep any attachment the
 *   incoming copy has lost track of
 * - documents named by a tombstone are removed, so real deletions still work
 */
export function mergeDocuments(incoming, existing, tombstoneIds = []) {
  const out = new Map();
  for (const d of Array.isArray(existing) ? existing : []) {
    if (d && d.id != null) out.set(upper(d.id), d);
  }
  for (const d of Array.isArray(incoming) ? incoming : []) {
    if (!d || d.id == null) continue;
    const key = upper(d.id);
    out.set(key, mergeDocument(d, out.get(key)));
  }
  for (const id of tombstoneIds) out.delete(upper(id));
  return Array.from(out.values());
}

/** Union two tombstone lists by id, so a stale push cannot undelete a document. */
export function mergeTombstones(incoming, existing) {
  const out = new Map();
  for (const t of Array.isArray(existing) ? existing : []) {
    if (t && t.id != null) out.set(upper(t.id), t);
  }
  for (const t of Array.isArray(incoming) ? incoming : []) {
    if (t && t.id != null && !out.has(upper(t.id))) out.set(upper(t.id), t);
  }
  return Array.from(out.values());
}

/** Union two audit-log arrays, newest first, without dropping either side's entries. */
export function mergeAuditLogs(incoming, existing, cap = 5000) {
  const a = Array.isArray(incoming) ? incoming : [];
  const b = Array.isArray(existing) ? existing : [];
  if (!b.length) return a.slice(0, cap);
  if (!a.length) return b.slice(0, cap);
  const key = (l) => JSON.stringify([l && l.timestamp, l && l.user, l && l.action, l && l.division]);
  const seen = new Set(a.map(key));
  const extra = b.filter((l) => !seen.has(key(l)));
  return [...a, ...extra].slice(0, cap);
}

const parse = (raw, fallback) => {
  if (raw == null) return fallback;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

/**
 * Merge a pushed `{velite_*: json-string}` payload against the stored one.
 *
 * Keys are carried across verbatim except the three where a blind overwrite
 * loses data: documents, tombstones and the audit log. A key the push omits
 * entirely is kept from storage rather than dropped.
 *
 * Returns { data, stats } — stats is for the audit line, so a suppressed
 * erase is visible in the logs rather than silent.
 */
export function mergeBackupPayload(incomingData, existingData) {
  const incoming = incomingData || {};
  const existing = existingData || {};
  const merged = { ...existing, ...incoming };
  const stats = { documents: 0, attachmentsPreserved: 0, documentsRecovered: 0 };

  if (!existing.velite_documents) return { data: merged, stats };

  const exDocs = parse(existing.velite_documents, []);
  const inDocs = parse(incoming.velite_documents, null);
  if (inDocs === null) return { data: merged, stats };

  const tombs = mergeTombstones(
    parse(incoming.velite_doc_tombstones, []),
    parse(existing.velite_doc_tombstones, [])
  );

  const inById = new Map(inDocs.filter((d) => d && d.id != null).map((d) => [upper(d.id), d]));
  for (const prev of exDocs) {
    if (!prev || prev.id == null) continue;
    const now = inById.get(upper(prev.id));
    if (!now) {
      stats.documentsRecovered++;
      continue;
    }
    for (const slot of ["wordFile", "pdfFile"]) {
      if (namesDriveFile(prev[slot]) && !namesDriveFile(now[slot])) stats.attachmentsPreserved++;
    }
  }

  const docs = mergeDocuments(inDocs, exDocs, tombs.map((t) => t.id));
  stats.documents = docs.length;

  merged.velite_documents = JSON.stringify(docs);
  merged.velite_doc_tombstones = JSON.stringify(tombs);
  merged.velite_audit_logs = JSON.stringify(
    mergeAuditLogs(parse(incoming.velite_audit_logs, []), parse(existing.velite_audit_logs, []))
  );
  return { data: merged, stats };
}
