#!/usr/bin/env node

import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import Fuse from "fuse.js";

const CLAUDE_DIR = path.join(os.homedir(), ".claude", "projects");
const MAX_PREVIEW_LEN = 120;

function getAllSessionFiles() {
  const files = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  }
  walk(CLAUDE_DIR);
  return files;
}

function parseProjectName(filePath) {
  const rel = path.relative(CLAUDE_DIR, filePath);
  const parts = rel.split(path.sep);
  // project dir is encoded as -Users-foo-bar => /Users/foo/bar
  const projectDir = parts.slice(0, -1).join(path.sep);
  return projectDir.replace(/^-/, "/").replace(/-/g, "/");
}

function extractUserMessages(filePath) {
  const messages = [];
  let content;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return messages;
  }
  const lines = content.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "user" && obj.message?.content) {
        const text =
          typeof obj.message.content === "string"
            ? obj.message.content
            : Array.isArray(obj.message.content)
              ? obj.message.content
                  .filter((b) => b.type === "text")
                  .map((b) => b.text)
                  .join(" ")
              : "";
        if (text.trim()) {
          messages.push({
            text: text.trim(),
            timestamp: obj.timestamp || "",
          });
        }
      }
    } catch {
      // skip malformed lines
    }
  }
  return messages;
}

function buildIndex() {
  const sessionFiles = getAllSessionFiles();
  const records = [];

  for (const file of sessionFiles) {
    const sessionId = path.basename(file, ".jsonl");
    const project = parseProjectName(file);
    const messages = extractUserMessages(file);
    const stat = fs.statSync(file);

    for (const msg of messages) {
      records.push({
        sessionId,
        project,
        text: msg.text,
        timestamp: msg.timestamp,
        lastModified: stat.mtime,
        filePath: file,
      });
    }
  }

  return records;
}

function highlight(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return truncate(text);

  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 80);
  let snippet = "";
  if (start > 0) snippet += "...";
  snippet += text.slice(start, idx);
  snippet += `\x1b[1;33m${text.slice(idx, idx + query.length)}\x1b[0m`;
  snippet += text.slice(idx + query.length, end);
  if (end < text.length) snippet += "...";
  return snippet;
}

function truncate(text) {
  if (text.length <= MAX_PREVIEW_LEN) return text;
  return text.slice(0, MAX_PREVIEW_LEN) + "...";
}

function exactSearch(records, query) {
  const q = query.toLowerCase();
  const results = [];
  for (const rec of records) {
    if (rec.text.toLowerCase().includes(q)) {
      results.push({ ...rec, score: 0 });
    }
  }
  return results;
}

function fuzzySearch(records, query) {
  const fuse = new Fuse(records, {
    keys: ["text"],
    threshold: 0.4,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
  return fuse.search(query).map((r) => ({
    ...r.item,
    score: r.score,
  }));
}

function formatTime(ts) {
  if (!ts) return "unknown";
  try {
    const d = new Date(ts);
    return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  } catch {
    return ts;
  }
}

function printResults(results, query, mode) {
  if (results.length === 0) {
    console.log("\x1b[31mNo results found.\x1b[0m\n");
    return;
  }

  // group by session
  const grouped = new Map();
  for (const r of results) {
    const key = r.sessionId;
    if (!grouped.has(key)) {
      grouped.set(key, { project: r.project, sessionId: r.sessionId, matches: [] });
    }
    grouped.get(key).matches.push(r);
  }

  console.log(
    `\n\x1b[1;32mFound ${results.length} match(es) in ${grouped.size} session(s)\x1b[0m\n`
  );

  let count = 0;
  for (const [, group] of grouped) {
    if (count >= 20) {
      console.log(`\x1b[2m... and ${grouped.size - 20} more sessions\x1b[0m`);
      break;
    }
    console.log(
      `\x1b[1;36m📁 ${group.project}\x1b[0m  \x1b[2m(${group.sessionId})\x1b[0m`
    );
    const shown = group.matches.slice(0, 5);
    for (const m of shown) {
      const preview =
        mode === "exact" ? highlight(m.text, query) : truncate(m.text);
      console.log(`   \x1b[2m${formatTime(m.timestamp)}\x1b[0m`);
      console.log(`   ${preview}`);
      console.log();
    }
    if (group.matches.length > 5) {
      console.log(
        `   \x1b[2m... and ${group.matches.length - 5} more matches\x1b[0m\n`
      );
    }
    count++;
  }
}

function printUsage() {
  console.log(`
\x1b[1mclaude-session-search (css)\x1b[0m - Search Claude Code session history

\x1b[1mUsage:\x1b[0m
  css <keyword>              Exact keyword search
  css -f <keyword>           Fuzzy search
  css -i                     Interactive mode
  css --stats                Show session statistics

\x1b[1mExamples:\x1b[0m
  css "马斯克"               Search for exact keyword
  css -f "musk tweets"       Fuzzy search
  css -i                     Enter interactive search mode
`);
}

function showStats(records) {
  const sessions = new Set(records.map((r) => r.sessionId));
  const projects = new Set(records.map((r) => r.project));
  console.log(`\n\x1b[1mSession Statistics\x1b[0m`);
  console.log(`  Total sessions:       ${sessions.size}`);
  console.log(`  Total projects:       ${projects.size}`);
  console.log(`  Total user messages:  ${records.length}`);
  console.log(`\n\x1b[1mProjects:\x1b[0m`);
  const projCounts = {};
  for (const r of records) {
    projCounts[r.project] = (projCounts[r.project] || 0) + 1;
  }
  const sorted = Object.entries(projCounts).sort((a, b) => b[1] - a[1]);
  for (const [proj, count] of sorted) {
    console.log(`  ${proj}: ${count} messages`);
  }
  console.log();
}

async function interactiveMode(records) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(
    '\x1b[1mInteractive search mode\x1b[0m (prefix with "~" for fuzzy, "q" to quit)\n'
  );

  const ask = () => {
    rl.question("\x1b[1;35msearch>\x1b[0m ", (input) => {
      const q = input.trim();
      if (!q || q === "q" || q === "quit" || q === "exit") {
        rl.close();
        return;
      }
      if (q.startsWith("~")) {
        const keyword = q.slice(1).trim();
        if (keyword) {
          const results = fuzzySearch(records, keyword);
          printResults(results, keyword, "fuzzy");
        }
      } else {
        const results = exactSearch(records, q);
        printResults(results, q, "exact");
      }
      ask();
    });
  };
  ask();
}

// Main
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  printUsage();
  process.exit(0);
}

console.log("\x1b[2mIndexing sessions...\x1b[0m");
const records = buildIndex();
console.log(`\x1b[2mLoaded ${records.length} user messages from ${new Set(records.map(r => r.sessionId)).size} sessions\x1b[0m`);

if (args[0] === "--stats") {
  showStats(records);
} else if (args[0] === "-i") {
  await interactiveMode(records);
} else if (args[0] === "-f" && args[1]) {
  const query = args.slice(1).join(" ");
  const results = fuzzySearch(records, query);
  printResults(results, query, "fuzzy");
} else {
  const query = args.join(" ");
  const results = exactSearch(records, query);
  printResults(results, query, "exact");
}
