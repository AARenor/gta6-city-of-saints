// Hand-in entrypoint: copy the playable game and its screenshots into the output directory, then write
// the dossier the scorer compares against. Node 22, the standard library only, erasable TypeScript, so
// it runs as-is under type stripping with no build and no install.
//
//   node main.ts [--output <dir>] [--quiet]
//
// The output directory is --output, else $MAKEFUN_OUTPUT_DIR, else /output. Every source path is
// resolved from this module's own URL, never from the working directory, because the grader runs this
// file from its own cwd.

import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDossier } from './vendor/makefun-game.ts';

/** The repository root, taken from this module's location so the caller's cwd cannot move it. */
const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap, as the bounty's library is held to it. */
const TEXT_MAX_BYTES = 65536;

/** The entry's two directories, handed in exactly as the dossier reads them. */
const ENTRY_DIRS = ['game', 'screenshots'] as const;

type EntryDir = (typeof ENTRY_DIRS)[number];

/** Copy one directory tree, regular files only: dot names, symlinks and special files stay behind. */
function copyTree(src: string, dest: string, tally: { files: number }): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to, tally);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      tally.files += 1;
    }
  }
}

/** Copy repo `game/` or `screenshots/` into the output directory and answer how many files went. */
function copyEntryDir(outputDir: string, name: EntryDir): number {
  const src = join(REPO_ROOT, name);
  let present = false;
  try {
    present = statSync(src).isDirectory();
  } catch {
    present = false;
  }
  if (!present) throw new Error(`no ${name}/ directory at ${src}, which the entry hands in`);
  const tally = { files: 0 };
  copyTree(src, join(outputDir, name), tally);
  return tally.files;
}

/** What the arguments select: the output directory and whether the summary line stays off stderr. */
interface Options {
  outputDir: string;
  quiet: boolean;
}

/**
 * Read the arguments: --output <dir> (or --output=<dir>), else $MAKEFUN_OUTPUT_DIR, else /output, with
 * relative paths against the cwd; --quiet keeps stderr to errors. Anything else is refused.
 */
function optionsFrom(argv: readonly string[]): Options {
  let given: string | null = null;
  let quiet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--output needs a directory');
      given = next;
      i += 1;
    } else if (arg.startsWith('--output=')) {
      given = arg.slice('--output='.length);
      if (given === '') throw new Error('--output needs a directory');
    } else if (arg === '--quiet') {
      quiet = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { outputDir: resolve(given ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output'), quiet };
}

function main(): void {
  const { outputDir, quiet } = optionsFrom(process.argv.slice(2));
  mkdirSync(outputDir, { recursive: true });
  const game = copyEntryDir(outputDir, 'game');
  const screenshots = copyEntryDir(outputDir, 'screenshots');
  const dossier = buildDossier(outputDir, { text_max_bytes: TEXT_MAX_BYTES });
  writeFileSync(join(outputDir, 'dossier.json'), dossier);
  if (!quiet) {
    process.stderr.write(
      `copied ${game} game files and ${screenshots} screenshots to ${outputDir}, dossier.json ${dossier.length} bytes\n`,
    );
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`main.ts: ${(err as Error).message}\n`);
  process.exitCode = 1;
}
