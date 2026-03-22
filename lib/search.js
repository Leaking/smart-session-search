/**
 * Search sessions using case-insensitive exact (substring) matching.
 * No external dependencies needed.
 *
 * When query is empty, returns all sessions.
 * Matches against title, messages, and project fields.
 *
 * @param {any} _unused - kept for API compatibility (was Fuse index)
 * @param {string} query
 * @param {import('./data.js').Session[]} allSessions
 * @returns {{item: Session, matches: object[]}[]}
 */
export function search(_unused, query, allSessions = []) {
  if (!query.trim()) {
    return allSessions.map(item => ({ item, matches: [] }));
  }

  const q = query.toLowerCase();
  const results = [];

  for (const session of allSessions) {
    const matches = [];

    // Match title
    if (session.title && session.title.toLowerCase().includes(q)) {
      matches.push({ key: 'title', value: session.title, indices: findIndices(session.title, q) });
    }

    // Match messages
    for (const msg of session.messages) {
      if (msg.toLowerCase().includes(q)) {
        matches.push({ key: 'messages', value: msg, indices: findIndices(msg, q) });
        break; // one match is enough per session
      }
    }

    // Match project
    if (session.project && session.project.toLowerCase().includes(q)) {
      matches.push({ key: 'project', value: session.project, indices: findIndices(session.project, q) });
    }

    if (matches.length > 0) {
      results.push({ item: session, matches });
    }
  }

  return results;
}

/**
 * Find all occurrence indices of needle in haystack (case-insensitive).
 * Returns [[start, end], ...] format compatible with Fuse.js match indices.
 */
function findIndices(haystack, needle) {
  const indices = [];
  const lower = haystack.toLowerCase();
  let pos = 0;
  while ((pos = lower.indexOf(needle, pos)) !== -1) {
    indices.push([pos, pos + needle.length - 1]);
    pos += needle.length;
  }
  return indices;
}

/**
 * Create index — no-op, kept for API compatibility.
 */
export function createIndex(_sessions) {
  return null;
}
