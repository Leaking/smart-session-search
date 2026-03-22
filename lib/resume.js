import { spawnSync } from 'node:child_process';

/**
 * Resume a Claude Code session.
 * Uses spawnSync with cwd to handle cross-project resume.
 *
 * @param {string} sessionId
 * @param {string} projectDir - The project directory where this session belongs
 */
export function resumeSession(sessionId, projectDir) {
  // Restore terminal state
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
  }
  process.stdout.write('\x1b[?1049l'); // exit alternate screen
  process.stdout.write('\x1b[?25h');   // show cursor

  const cwd = projectDir || process.cwd();

  const { status } = spawnSync('claude', ['--resume', sessionId], {
    stdio: 'inherit',
    cwd,
  });

  process.exit(status ?? 0);
}
