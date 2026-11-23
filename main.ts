#!/usr/bin/env node
/**
 * Hand-in entrypoint for the GTA6 city entry.
 *
 * Assembles the directory a scorer reads: game/ and screenshots/ copied as regular
 * files, then dossier.json written by the vendored buildDossier. On top of the bytes
 * buildDossier returns, the dossier carries two fields of this entry's own:
 *
 *   tagline           one line saying what the game is
 *   screenshotCount   how many JPEG files were copied out of screenshots/
 *
 * Both are added to the parsed document and re-serialized with canonicalJson, so key
 * order stays sorted and the same directory still writes the same bytes. The
 * repository root comes from this module's own URL, so the script runs from any
 * working directory.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier, canonicalJson } from './vendor/makefun-game.ts';

/** The repository root: this file's directory, never process.cwd(). */
const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));

/** Directories copied verbatim into the output directory. */
const COPY_DIRS = ['game', 'screenshots'] as const;

/** The dossier's text cap, as the bounty's gate.json asks for it. */
const TEXT_MAX_BYTES = 65536;

/** What the game is, in one line, for the dossier's `tagline` field. */
const TAGLINE = 'An original top-down open-world crime game, drawn with canvas paths.';

/** True for a name whose extension is a JPEG one (`.jpg` or `.jpeg`, any case). */
const JPEG_NAME = /\.jpe?g$/iu;

interface Options {
  output: string;
  /** Suppresses the summary line; the dossier is still written. */
  quiet: boolean;
}

/** Reads --output <dir>; falls back to MAKEFUN_OUTPUT_DIR, then /output. */
function parseArgs(argv: string[]): Options {
  let output = process.env['MAKEFUN_OUTPUT_DIR'] ?? '/output';
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--output' || arg === '-o') {
      const value = argv[i + 1];
      if (value === undefined || value === '') throw new Error(`${arg} needs a directory`);
      output = value;
      i++;
    } else if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length);
    } else if (arg === '--quiet' || arg === '-q') {
      quiet = true;
    } else {
      throw new Error(`unknown argument: ${arg}\nusage: main.ts [--output <dir>] [--quiet]`);
    }
  }
  return { output: resolve(output), quiet };
}

/** True when `path` is an existing directory. */
function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Copies a directory tree into `dest`, creating directories and skipping every entry
 * whose name starts with a dot. Returns the paths copied, relative to `src` and
 * separated by `/`, so the caller can count whatever subset it needs.
 */
function copyTree(src: string, dest: string, prefix = ''): string[] {
  mkdirSync(dest, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      for (const below of copyTree(from, to, `${rel}/`)) copied.push(below);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      copied.push(rel);
    }
  }
  return copied;
}

/**
 * buildDossier's dossier with this entry's `tagline` and `screenshotCount` added.
 * The document is parsed, extended and re-serialized with canonicalJson, so the
 * result keeps buildDossier's sorted-key, no-space spelling.
 */
function withEntryFields(dossier: Uint8Array, screenshotCount: number): Uint8Array {
  const doc = JSON.parse(Buffer.from(dossier).toString('utf8')) as Record<string, unknown>;
  doc['tagline'] = TAGLINE;
  doc['screenshotCount'] = screenshotCount;
  return Buffer.from(canonicalJson(doc), 'utf8');
}

function main(): number {
  const { output: outDir, quiet } = parseArgs(process.argv.slice(2));

  for (const name of COPY_DIRS) {
    if (!isDir(join(REPO_ROOT, name))) {
      console.error(`main: missing ${name}/ directory in ${REPO_ROOT}`);
      return 1;
    }
  }

  mkdirSync(outDir, { recursive: true });

  const copied = new Map<string, string[]>();
  for (const name of COPY_DIRS) {
    copied.set(name, copyTree(join(REPO_ROOT, name), join(outDir, name)));
  }

  const gameFiles = copied.get('game')?.length ?? 0;
  const shotFiles = copied.get('screenshots')?.length ?? 0;
  const screenshotCount = (copied.get('screenshots') ?? []).filter((path) => JPEG_NAME.test(path)).length;

  const dossier = withEntryFields(buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES }), screenshotCount);
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  if (!quiet) {
    console.error(
      `main: copied ${gameFiles} game files and ${shotFiles} screenshots (${screenshotCount} jpg), dossier.json ${dossier.byteLength} bytes into ${outDir}`,
    );
  }
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`main: ${(err as Error).message}`);
  process.exit(1);
}
