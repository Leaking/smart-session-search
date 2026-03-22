import type { Session } from './data.js';

export interface SearchMatch {
  key: 'title' | 'messages' | 'project';
  value: string;
  indices: [number, number][];
}

export interface SearchResult {
  item: Session;
  matches: SearchMatch[];
}

/**
 * Search sessions using case-insensitive exact (substring) matching.
 *
 * When query is empty, returns all sessions in original order.
 * Matches against title, messages, and project fields.
 */
export function search(query: string, sessions: Session[]): SearchResult[] {
  if (!query.trim()) {
    return sessions.map(item => ({ item, matches: [] }));
  }

  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const session of sessions) {
    const matches: SearchMatch[] = [];

    if (session.title?.toLowerCase().includes(q)) {
      matches.push({ key: 'title', value: session.title, indices: findIndices(session.title, q) });
    }

    for (const msg of session.messages) {
      if (msg.toLowerCase().includes(q)) {
        matches.push({ key: 'messages', value: msg, indices: findIndices(msg, q) });
        break;
      }
    }

    if (session.project?.toLowerCase().includes(q)) {
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
 */
function findIndices(haystack: string, needle: string): [number, number][] {
  const indices: [number, number][] = [];
  const lower = haystack.toLowerCase();
  let pos = 0;
  while ((pos = lower.indexOf(needle, pos)) !== -1) {
    indices.push([pos, pos + needle.length - 1]);
    pos += needle.length;
  }
  return indices;
}
