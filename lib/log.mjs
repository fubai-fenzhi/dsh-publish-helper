import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Local audit trail of every publish/recall, kept beside the settings file. */
export function publishLogPath(home = homedir()) {
  return join(home, '.dsh', 'publish-helper-log.json');
}

export function readPublishLog(file = publishLogPath()) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function appendPublishLog(entry, file = publishLogPath()) {
  const list = readPublishLog(file);
  const record = { at: new Date().toISOString(), ...entry };
  list.push(record);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  return record;
}
