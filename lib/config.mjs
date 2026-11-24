import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Local settings live beside the user's DSH data, never in a repository. */
export function configPath(home = homedir()) {
  return join(home, '.dsh', 'publish-helper.json');
}

export function readLocalConfig(file = configPath()) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return {
      token: typeof data.token === 'string' ? data.token : '',
      registryRepo: typeof data.registryRepo === 'string' ? data.registryRepo : '',
      npmUser: typeof data.npmUser === 'string' ? data.npmUser : '',
      npmToken: typeof data.npmToken === 'string' ? data.npmToken : '',
      reviewRepos: Array.isArray(data.reviewRepos) ? data.reviewRepos.filter((item) => typeof item === 'string') : [],
    };
  } catch {
    return { token: '', registryRepo: '', npmUser: '', npmToken: '', reviewRepos: [] };
  }
}

export function writeLocalConfig(patch, file = configPath()) {
  const current = readLocalConfig(file);
  const next = { ...current, ...patch };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
