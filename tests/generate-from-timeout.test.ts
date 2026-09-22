import { describe, expect, it } from 'vitest';
import type { CliArtifactMetadata } from '../src/cli-metadata.js';
import { parseGenerateFlags } from '../src/cli/generate/flags.js';
import { resolveGenerateRequestFromArtifact } from '../src/cli/generate/template-data.js';

const metadata: CliArtifactMetadata = {
  schemaVersion: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  generator: { name: 'mcporter', version: '0.0.0' },
  server: {
    name: 'demo',
    definition: {
      name: 'demo',
      command: { kind: 'http', url: 'https://example.com/mcp' },
    },
  },
  artifact: { path: '/tmp/demo', kind: 'template' },
  invocation: {
    serverRef: 'demo',
    runtime: 'node',
    timeoutMs: 45_000,
    minify: false,
  },
};

describe('generate-cli --from timeout', () => {
  it('restores the artifact timeout when --timeout is omitted', () => {
    const request = resolveGenerateRequestFromArtifact(parseGenerateFlags(['--from', '/tmp/demo']), metadata, {});
    expect(request.timeoutMs).toBe(45_000);
  });

  it('lets an explicit --timeout override the artifact value', () => {
    const request = resolveGenerateRequestFromArtifact(
      parseGenerateFlags(['--from', '/tmp/demo', '--timeout', '12000']),
      metadata,
      {}
    );
    expect(request.timeoutMs).toBe(12_000);
  });
});
