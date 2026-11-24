import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

import { preflightPackage } from './preflight.mjs';

export function inboxDir(home = homedir(), custom) {
  return custom || join(home, '.dsh', 'publish-helper-inbox');
}

/** Reject absolute paths, drive letters and `..` segments before extracting an archive. */
export function isSafeEntry(name) {
  const normalized = String(name ?? '').replaceAll('\\', '/').trim();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(normalized)) return false;
  return !normalized.split('/').includes('..');
}

/** List zip archives (and already-extracted directories) waiting in the inbox. */
export function listInbox(dir = inboxDir()) {
  mkdirSync(dir, { recursive: true });
  const items = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    items.push({
      name: entry,
      path: full,
      size: stat.isDirectory() ? 0 : stat.size,
      directory: stat.isDirectory(),
      updatedAt: stat.mtime.toISOString(),
    });
  }
  return items.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

/**
 * Extract a zip into `dest` using bsdtar, after validating every entry name.
 * `run` is injected (the host uses runCommand) so this stays testable.
 */
export async function safeExtractZip({ zip, dest, run }) {
  const list = await run('tar', ['-tf', zip]);
  if (list.code !== 0) {
    throw new Error(`cannot list archive ${zip}: ${String(list.stderr || '').slice(-500)}`);
  }
  const entries = String(list.stdout ?? '').split(/\r?\n/).filter(Boolean);
  const unsafe = entries.filter((entry) => !isSafeEntry(entry));
  if (unsafe.length > 0) {
    throw new Error(`archive contains unsafe paths: ${unsafe.slice(0, 5).join(', ')}`);
  }
  mkdirSync(dest, { recursive: true });
  const extract = await run('tar', ['-xf', zip, '-C', dest]);
  if (extract.code !== 0) {
    throw new Error(`cannot extract ${zip}: ${String(extract.stderr || '').slice(-500)}`);
  }
  return entries.length;
}

/** Extract one inbox zip and run preflight on it. Nothing is executed. */
export async function intakeZip({ zip, root = inboxDir(), run, preflight = preflightPackage } = {}) {
  if (!existsSync(zip)) throw new Error(`archive not found: ${zip}`);
  const target = join(root, basename(zip).replace(/\.zip$/i, ''));
  await safeExtractZip({ zip, dest: target, run });
  return { dir: target, preflight: preflight(target) };
}
