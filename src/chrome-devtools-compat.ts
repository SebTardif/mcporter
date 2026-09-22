import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderChromeDevtoolsAutoConnectPatchSource } from './chrome-devtools-auto-connect-patch.js';
import { resolveChromeDevtoolsAutoConnectCommand } from './chrome-devtools-command.js';
import { ensureWindowsPrivateDirectory } from './chrome-devtools-relay-handoff.js';

const FALLBACK_PATCH_FILENAME = 'mcporter-chrome-devtools-auto-connect-patch.js';

export interface ChromeDevtoolsCompatResult {
  readonly env: Record<string, string>;
  readonly applied: boolean;
  readonly patchPath?: string;
  readonly close?: () => void;
}

interface CompatPatch {
  readonly patchPath: string;
  readonly close?: () => void;
}

export function applyChromeDevtoolsCompat(
  env: Record<string, string>,
  command: string,
  args: readonly string[]
): ChromeDevtoolsCompatResult {
  if (!shouldApplyChromeDevtoolsCompat(command, args, env)) {
    return { env, applied: false };
  }
  const patch = resolveChromeDevtoolsCompatPatch();
  if (!patch) {
    return { env, applied: false };
  }
  const importFlag = `--import=${pathToFileURL(patch.patchPath).href}`;
  const existingOptions = env.NODE_OPTIONS?.trim();
  if (existingOptions?.includes(importFlag)) {
    return { env, applied: true, ...patch };
  }
  return {
    env: {
      ...env,
      NODE_OPTIONS: existingOptions ? `${existingOptions} ${importFlag}` : importFlag,
    },
    applied: true,
    ...patch,
  };
}

export function shouldApplyChromeDevtoolsCompat(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv | Record<string, string> = process.env
): boolean {
  if (env.MCPORTER_DISABLE_CHROME_DEVTOOLS_COMPAT === '1') {
    return false;
  }
  return resolveChromeDevtoolsAutoConnectCommand(command, args).enabled;
}

export function resolveChromeDevtoolsCompatPatch(
  candidates = defaultChromeDevtoolsPatchCandidates(),
  fallbackDir = os.tmpdir()
): CompatPatch | undefined {
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (existing) {
    return { patchPath: existing };
  }
  return writeFallbackPatch(fallbackDir);
}

function defaultChromeDevtoolsPatchCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(here, 'chrome-devtools-auto-connect-patch.js'),
    path.resolve(here, '..', 'dist', 'chrome-devtools-auto-connect-patch.js'),
  ];
}

function writeFallbackPatch(fallbackDir: string): CompatPatch | undefined {
  let directory: string | undefined;
  try {
    if (process.platform === 'win32') {
      const candidate = path.join(fallbackDir, `mcporter-chrome-devtools-${randomBytes(16).toString('hex')}`);
      ensureWindowsPrivateDirectory(candidate);
      directory = candidate;
    } else {
      directory = fs.mkdtempSync(path.join(fallbackDir, 'mcporter-chrome-devtools-'));
    }
    const patchPath = path.join(directory, FALLBACK_PATCH_FILENAME);
    fs.writeFileSync(patchPath, renderChromeDevtoolsAutoConnectPatchSource(), { mode: 0o600, flag: 'wx' });
    const ownedDirectory = directory;
    return { patchPath, close: () => fs.rmSync(ownedDirectory, { recursive: true, force: true }) };
  } catch {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    return undefined;
  }
}
