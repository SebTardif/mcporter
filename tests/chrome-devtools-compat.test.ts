import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  patchChromeDevtoolsMcp,
  renderChromeDevtoolsAutoConnectPatchSource,
} from '../src/chrome-devtools-auto-connect-patch.js';
import {
  applyChromeDevtoolsCompat,
  resolveChromeDevtoolsCompatPatch,
  shouldApplyChromeDevtoolsCompat,
} from '../src/chrome-devtools-compat.js';

describe('chrome-devtools compatibility', () => {
  afterEach(() => {
    delete process.env.MCPORTER_DISABLE_CHROME_DEVTOOLS_COMPAT;
    vi.restoreAllMocks();
  });

  it('enables the patch for autoConnect chrome-devtools commands', () => {
    expect(shouldApplyChromeDevtoolsCompat('npx', ['-y', 'chrome-devtools-mcp@latest', '--autoConnect'])).toBe(true);
    expect(shouldApplyChromeDevtoolsCompat('npx', ['-y', 'chrome-devtools-mcp', '--auto-connect'])).toBe(true);
    expect(shouldApplyChromeDevtoolsCompat('npx', ['chrome-devtools-mcp', '--autoConnect=true'])).toBe(true);
    expect(shouldApplyChromeDevtoolsCompat('npx', ['chrome-devtools-mcp', '--auto-connect=TRUE'])).toBe(false);
    expect(shouldApplyChromeDevtoolsCompat('npx', ['chrome-devtools-mcp', '--autoConnect', 'true'])).toBe(true);
    expect(shouldApplyChromeDevtoolsCompat('npx', ['chrome-devtools-mcp', '--autoConnect=false'])).toBe(false);
    expect(shouldApplyChromeDevtoolsCompat('npx', ['chrome-devtools-mcp', '--autoConnect', 'false'])).toBe(false);
    expect(shouldApplyChromeDevtoolsCompat('npx', ['chrome-devtools-mcp', '--no-autoConnect'])).toBe(false);
    expect(shouldApplyChromeDevtoolsCompat('npm', ['exec', '--', 'chrome-devtools-mcp@latest', '--autoConnect'])).toBe(
      false
    );
    expect(
      shouldApplyChromeDevtoolsCompat('npm', ['exec', '--', 'chrome-devtools-mcp@latest', '--', '--autoConnect'])
    ).toBe(false);
  });

  it('does not patch non-autoConnect commands', () => {
    expect(shouldApplyChromeDevtoolsCompat('npx', ['-y', 'chrome-devtools-mcp@latest'])).toBe(false);
  });

  it('allows opting out of the compatibility patch', () => {
    process.env.MCPORTER_DISABLE_CHROME_DEVTOOLS_COMPAT = '1';

    expect(shouldApplyChromeDevtoolsCompat('npx', ['-y', 'chrome-devtools-mcp@latest', '--autoConnect'])).toBe(false);
  });

  it('allows opting out from the merged server env', () => {
    const result = applyChromeDevtoolsCompat({ MCPORTER_DISABLE_CHROME_DEVTOOLS_COMPAT: '1' }, 'npx', [
      '-y',
      'chrome-devtools-mcp@latest',
      '--autoConnect',
    ]);

    expect(result).toEqual({ env: { MCPORTER_DISABLE_CHROME_DEVTOOLS_COMPAT: '1' }, applied: false });
  });

  it('injects a NODE_OPTIONS import for matching commands', () => {
    const result = applyChromeDevtoolsCompat({}, 'npx', ['-y', 'chrome-devtools-mcp@latest', '--autoConnect']);

    expect(result.applied).toBe(true);
    expect(result.env.NODE_OPTIONS).toContain('--import=file://');
    expect(result.env.NODE_OPTIONS).toContain('chrome-devtools-auto-connect-patch.js');
  });

  it('preserves existing NODE_OPTIONS', () => {
    const result = applyChromeDevtoolsCompat({ NODE_OPTIONS: '--trace-warnings' }, 'npx', [
      '-y',
      'chrome-devtools-mcp@latest',
      '--autoConnect',
    ]);

    expect(result.applied).toBe(true);
    expect(result.env.NODE_OPTIONS).toContain('--trace-warnings');
    expect(result.env.NODE_OPTIONS).toContain('chrome-devtools-auto-connect-patch.js');
  });

  it('materializes a JavaScript fallback patch when build output is missing', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-cdpmcp-fallback-'));

    const patch = resolveChromeDevtoolsCompatPatch([], tmp);
    const patchPath = patch?.patchPath;

    expect(patchPath).toMatch(/mcporter-chrome-devtools-.*[/\\]mcporter-chrome-devtools-auto-connect-patch\.js$/);
    expect(path.dirname(patchPath!)).not.toBe(tmp);
    await expect(fs.readFile(patchPath!, 'utf8')).resolves.toBe(renderChromeDevtoolsAutoConnectPatchSource());
    await expect(import(`${pathToFileURL(patchPath!).href}?test=${Date.now()}`)).resolves.toBeDefined();
    patch?.close?.();
    await expect(fs.stat(path.dirname(patchPath!))).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it.runIf(process.platform !== 'win32')('never overwrites a pre-created fallback symlink', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-patch-symlink-'));
    const victim = path.join(tmp, 'unrelated.txt');
    try {
      await fs.writeFile(victim, 'keep');
      await fs.symlink(victim, path.join(tmp, 'mcporter-chrome-devtools-auto-connect-patch.js'));
      const patch = resolveChromeDevtoolsCompatPatch([], tmp);
      const patchPath = patch?.patchPath;
      expect(patchPath).toBeDefined();
      expect(await fs.readFile(victim, 'utf8')).toBe('keep');
      expect((await fs.stat(path.dirname(patchPath!))).mode & 0o777).toBe(0o700);
      expect((await fs.stat(patchPath!)).mode & 0o777).toBe(0o600);
      patch?.close?.();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('removes the private directory if writing the fallback fails', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-patch-failure-'));
    vi.spyOn(fsSync, 'writeFileSync').mockImplementation(() => {
      throw new Error('synthetic write failure');
    });
    try {
      expect(resolveChromeDevtoolsCompatPatch([], tmp)).toBeUndefined();
      expect(await fs.readdir(tmp)).toEqual([]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('patches an npx .bin symlink target idempotently', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-cdpmcp-'));
    const packageBinDir = path.join(tmp, 'node_modules/chrome-devtools-mcp/build/src/bin');
    const binDir = path.join(tmp, 'node_modules/.bin');
    const contextPath = path.join(tmp, 'node_modules/chrome-devtools-mcp/build/src/McpContext.js');
    const binPath = path.join(packageBinDir, 'chrome-devtools-mcp.js');
    const shimPath = path.join(binDir, 'chrome-devtools-mcp');

    await fs.mkdir(packageBinDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(binPath, '#!/usr/bin/env node\n');
    await fs.writeFile(
      contextPath,
      `const NAVIGATION_TIMEOUT = 10_000;
async function detect(page, mcpPage) {
                if (await page.hasDevTools()) {
                    mcpPage.devToolsPage = await page.openDevTools();
                }
}
`
    );
    await fs.symlink('../chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js', shimPath);

    patchChromeDevtoolsMcp(shimPath);
    patchChromeDevtoolsMcp(shimPath);

    const patched = await fs.readFile(contextPath, 'utf8');
    expect(patched.match(/MCPORTER_DEVTOOLS_TIMEOUT_PATCH/g)).toHaveLength(1);
    expect(patched).toContain('mcporterWithTimeout(page.hasDevTools(), false)');
    expect(patched).toContain('mcporterWithTimeout(page.openDevTools(), undefined)');
  });
});
