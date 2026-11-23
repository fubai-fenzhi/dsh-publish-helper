import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const BINARY_EXT = new Set(['.exe', '.dll', '.node', '.so', '.dylib', '.bin', '.zip', '.tar', '.tgz', '.7z', '.rar']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.txt', '.ts']);
const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const ABS_PATH = /(['"])[A-Za-z]:\\[^'"\r\n]+\1/;

const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function walk(root, current = root, out = []) {
  for (const entry of readdirSync(current)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(current, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).replaceAll('\\', '/'));
  }
  return out;
}

function hasAnyFile(root, names, pattern) {
  return names.some((name) => (pattern ? pattern.test(name) : true)) && names.length > 0;
}

/**
 * Local preflight against the submission spec. This is what a contributor's AI runs
 * before handing the package over, and what the one-click publish runs before npm.
 */
export function preflightPackage(dir) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });
  const root = String(dir ?? '').trim();
  const done = () => ({ dir: root, ok: checks.every((check) => check.ok), checks });

  if (!root || !existsSync(root)) {
    add('dir', false, root ? `directory not found: ${root}` : 'package directory is required');
    return done();
  }

  const manifestPath = join(root, 'package.json');
  let pkg = null;
  if (!existsSync(manifestPath)) {
    add('package.json', false, 'missing package.json');
  } else {
    try {
      pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
      add('package.json', true, 'parsed');
    } catch (error) {
      add('package.json', false, `invalid JSON: ${String(error?.message ?? error)}`);
    }
  }

  const files = (() => {
    try {
      return walk(root);
    } catch {
      return [];
    }
  })();
  const basenames = files.map((file) => file.split('/').pop()).filter(Boolean);

  if (pkg) {
    add('name', typeof pkg.name === 'string' && NAME.test(pkg.name), pkg.name ?? 'name is required');
    add('version', typeof pkg.version === 'string' && VERSION.test(pkg.version), pkg.version ?? 'version is required');
    add('private', pkg.private !== true, pkg.private === true ? 'remove private:true before publishing' : 'publishable');
    add('description', typeof pkg.description === 'string' && pkg.description.trim().length > 0, pkg.description || 'description is required');
    add('license', typeof pkg.license === 'string' && pkg.license.trim().length > 0, pkg.license || 'license is required');
    const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    add('repository', typeof repository === 'string' && repository.trim().length > 0, repository || 'repository is required (npm ↔ GitHub link)');
    add('homepage', typeof pkg.homepage === 'string' && pkg.homepage.trim().length > 0, pkg.homepage || 'homepage is required');

    const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : [];
    const missingKeywords = ['dsh-plugin'].filter((key) => !keywords.includes(key));
    add('keywords', missingKeywords.length === 0, missingKeywords.length === 0 ? 'dsh-plugin present' : 'keywords must include dsh-plugin');

    const patch = pkg.dsh?.bundle?.patch;
    if (typeof patch !== 'string' || !patch.trim()) {
      add('dsh.bundle', false, 'package.json must declare dsh.bundle.patch');
    } else if (!existsSync(join(root, patch))) {
      add('dsh.bundle', false, `declared patch does not exist: ${patch}`);
    } else {
      add('dsh.bundle', true, patch);
    }

    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const installScripts = INSTALL_SCRIPTS.filter((name) => typeof scripts[name] === 'string');
    add('install-scripts', installScripts.length === 0, installScripts.length === 0 ? 'none' : `forbidden: ${installScripts.join(', ')}`);
  }

  add('readme', hasAnyFile(root, basenames, /^readme(\.md|\.markdown)?$/i), 'README.md');
  add('license-file', hasAnyFile(root, basenames, /^licen[cs]e(\.md|\.txt)?$/i), 'LICENSE');
  add('node_modules', !files.some((file) => file === 'node_modules' || file.startsWith('node_modules/')), 'no node_modules');

  const binaries = files.filter((file) => BINARY_EXT.has(extname(file).toLowerCase()));
  add('binaries', binaries.length === 0, binaries.length === 0 ? 'none' : `remove: ${binaries.slice(0, 5).join(', ')}`);

  let secrets = [];
  let absolutePaths = [];
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    if (!TEXT_EXT.has(extension)) continue;
    let text;
    try {
      if (statSync(join(root, file)).size > 1024 * 1024) continue;
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    const isTest = file.startsWith('test/') || file.startsWith('tests/') || file.includes('/test/') || file.includes('/tests/');
    for (const pattern of SECRET_PATTERNS) {
      if (!isTest && pattern.test(text)) {
        secrets.push(file);
        break;
      }
    }
    const runtimeFile = file === 'index.js' || file.startsWith('lib/') || file.startsWith('src/');
    if (runtimeFile && ABS_PATH.test(text)) absolutePaths.push(file);
  }
  add('secrets', secrets.length === 0, secrets.length === 0 ? 'none found' : `possible secrets in: ${secrets.slice(0, 5).join(', ')}`);
  add('absolute-paths', absolutePaths.length === 0, absolutePaths.length === 0 ? 'none in runtime code' : `hardcoded paths in: ${absolutePaths.slice(0, 5).join(', ')}`);

  return done();
}
