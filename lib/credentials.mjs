import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function npmrcPath(home = homedir()) {
  return join(home, '.npmrc');
}

/** Extract the auth token for the public registry from .npmrc, preferring registry.npmjs.org. */
export function parseNpmrcToken(text, host = 'registry.npmjs.org') {
  let fallback = '';
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const index = line.indexOf('_authToken=');
    if (index < 0) continue;
    let token = line.slice(index + '_authToken='.length).trim();
    token = token.replace(/^["']|["']$/g, '');
    if (!token) continue;
    const hostMatch = /^\s*(?:https?:)?\/\/([^/\s]+)/.exec(line);
    if (hostMatch && hostMatch[1] === host) return token;
    if (!fallback) fallback = token;
  }
  return fallback;
}

export function readNpmrcToken(file = npmrcPath()) {
  try {
    return parseNpmrcToken(readFileSync(file, 'utf8'));
  } catch {
    return '';
  }
}
