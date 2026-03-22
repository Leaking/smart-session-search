import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CLAUDE_DIR = join(homedir(), '.claude');
const HISTORY_FILE = join(CLAUDE_DIR, 'history.jsonl');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const MAX_MSG_LENGTH = 2000;

// ── Types ──

export interface Session {
  sessionId: string;
  title: string;
  project: string;
  timestamp: number;
  messages: string[];
  fileSize: number; // bytes, -1 if file not found
}

export interface PreviewMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface HistoryEntry {
  sessionId?: string;
  display?: string;
  project?: string;
  timestamp?: number;
}

interface SessionData {
  title: string;
  project: string;
  timestamp: number;
  messages: string[];
}

interface ContentBlock {
  type: string;
  text?: string;
}

interface SessionFileEntry {
  type?: string;
  message?: {
    content?: string | ContentBlock[];
  };
}

export interface LoadSessionsOptions {
  projectDir?: string | null;
  includeAssistant?: boolean;
}

/**
 * Encode a project path to the directory name format used by Claude.
 * /Users/foo/bar -> -Users-foo-bar
 */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, '-');
}

/**
 * Load sessions from history.jsonl.
 * Aggregates multiple entries per sessionId into one Session object.
 */
export function loadSessions({ projectDir = null, includeAssistant = false }: LoadSessionsOptions = {}): Session[] {
  if (!existsSync(HISTORY_FILE)) return [];

  const raw = readFileSync(HISTORY_FILE, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);

  // Aggregate by sessionId
  const sessionMap = new Map<string, SessionData>();

  for (const line of lines) {
    let entry: HistoryEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const { sessionId, display, project, timestamp } = entry;
    if (!sessionId) continue;

    // Project filter
    if (projectDir && project !== projectDir) continue;

    // Skip overly long display messages
    if (display && display.length > MAX_MSG_LENGTH) continue;

    if (!sessionMap.has(sessionId)) {
      sessionMap.set(sessionId, {
        title: display || '',
        project: project || '',
        timestamp: timestamp || 0,
        messages: [],
      });
    }

    const session = sessionMap.get(sessionId)!;

    // First display becomes the title; collect all as messages
    if (display) {
      if (!session.title) session.title = display;
      session.messages.push(display);
    }

    // Keep the latest timestamp
    if (timestamp && timestamp > session.timestamp) {
      session.timestamp = timestamp;
    }
  }

  // Build Session array with file size info
  let sessions: Session[] = Array.from(sessionMap.entries()).map(([sessionId, data]) => {
    const fileSize = getSessionFileSize(sessionId, data.project);
    return {
      sessionId,
      title: data.title,
      project: data.project,
      timestamp: data.timestamp,
      messages: data.messages,
      fileSize,
    };
  });

  // Load assistant messages if requested
  if (includeAssistant) {
    for (const session of sessions) {
      const assistantMsgs = loadAssistantMessages(session.sessionId, session.project);
      session.messages.push(...assistantMsgs);
    }
  }

  // Sort by timestamp descending (most recent first)
  sessions.sort((a, b) => b.timestamp - a.timestamp);

  return sessions;
}

/**
 * Get the file size of a session's .jsonl file.
 * Returns -1 if the file doesn't exist.
 */
function getSessionFileSize(sessionId: string, projectPath: string): number {
  if (!projectPath) return -1;
  const encodedPath = encodeProjectPath(projectPath);
  const sessionFile = join(PROJECTS_DIR, encodedPath, `${sessionId}.jsonl`);
  try {
    return statSync(sessionFile).size;
  } catch {
    return -1;
  }
}

/**
 * Load assistant text messages from a session's .jsonl file + subagents.
 */
function loadAssistantMessages(sessionId: string, projectPath: string): string[] {
  const messages: string[] = [];
  if (!projectPath) return messages;

  const encodedPath = encodeProjectPath(projectPath);
  const projectDir = join(PROJECTS_DIR, encodedPath);
  const sessionFile = join(projectDir, `${sessionId}.jsonl`);

  // Main session file
  if (existsSync(sessionFile)) {
    messages.push(...extractAssistantText(sessionFile));
  }

  // Subagent files
  const subagentDir = join(projectDir, sessionId, 'subagents');
  if (existsSync(subagentDir)) {
    try {
      const files = readdirSync(subagentDir).filter((f: string) => f.startsWith('agent-') && f.endsWith('.jsonl'));
      for (const file of files) {
        messages.push(...extractAssistantText(join(subagentDir, file)));
      }
    } catch {
      // ignore read errors
    }
  }

  return messages;
}

/**
 * Extract text blocks from assistant messages in a .jsonl file.
 */
function extractAssistantText(filePath: string): string[] {
  const texts: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return texts;
  }

  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: SessionFileEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== 'assistant') continue;

    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type !== 'text') continue; // skip thinking, tool_use, etc.
      if (typeof block.text === 'string' && block.text.length <= MAX_MSG_LENGTH) {
        texts.push(block.text);
      }
    }
  }

  return texts;
}

/**
 * Load preview messages (user + assistant alternating) for a session.
 * Returns conversation turns for preview display.
 */
export function loadPreviewMessages(sessionId: string, projectPath: string): PreviewMessage[] {
  const result: PreviewMessage[] = [];
  if (!projectPath) return result;

  const encodedPath = encodeProjectPath(projectPath);
  const sessionFile = join(PROJECTS_DIR, encodedPath, `${sessionId}.jsonl`);

  if (!existsSync(sessionFile)) return result;

  let raw: string;
  try {
    raw = readFileSync(sessionFile, 'utf-8');
  } catch {
    return result;
  }

  for (const line of raw.split('\n')) {
    if (!line) continue;

    let entry: SessionFileEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === 'user') {
      // Skip tool_result messages
      if (entry.message?.content && Array.isArray(entry.message.content)) {
        const hasToolResult = entry.message.content.some(b => b.type === 'tool_result');
        if (hasToolResult) continue;
      }

      const text = extractUserText(entry);
      if (text) {
        result.push({ role: 'user', text });
      }
    } else if (entry.type === 'assistant') {
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type === 'text' && block.text) {
          result.push({ role: 'assistant', text: block.text });
          break; // one text block per assistant turn is enough for preview
        }
      }
    }
  }

  return result;
}

/**
 * Extract user message text (handles string and Array<{type, text}> formats).
 */
function extractUserText(entry: SessionFileEntry): string | null {
  const content = entry.message?.content;
  if (!content) return null;

  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const textParts = content
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text!);
    return textParts.join('\n') || null;
  }

  return null;
}
