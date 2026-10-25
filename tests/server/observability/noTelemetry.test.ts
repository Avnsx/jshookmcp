/**
 * This fork ships no telemetry: nothing in the build can send spans, metrics or
 * an install id off the machine. Instrumentation stays in-process (no-op by
 * default, or the bounded in-memory backend on request).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = join(__dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|mts|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

describe('no telemetry', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.JSHOOK_OBSERVABILITY_EXPORTER;
  });
  afterEach(() => {
    delete process.env.JSHOOK_OBSERVABILITY_EXPORTER;
  });

  it('declares no OpenTelemetry exporter or proxy-agent dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Partial<
      Record<string, Record<string, string>>
    >;
    const names = ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) =>
      Object.keys(pkg[field] ?? {}),
    );
    expect(
      names.filter((name) => name.startsWith('@opentelemetry/') || name === 'https-proxy-agent'),
    ).toEqual([]);
  });

  it('contains no exporter, ingress endpoint or install id in its sources', () => {
    const offenders = sourceFiles(join(root, 'src')).filter((file) =>
      /@opentelemetry\/|OtlpInstrumentation|telemetry\.614447|getOrCreateInstallId/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });

  // An invalid value falls back to the default (with a logged error), as every config field does.
  it('defaults to no instrumentation and offers no network exporter', async () => {
    const { getConfig } = await import('@utils/config');
    expect(getConfig().observability?.exporter).toBe('none');
    vi.resetModules();
    process.env.JSHOOK_OBSERVABILITY_EXPORTER = 'otlp';
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getConfig: withOtlp } = await import('@utils/config');
    expect(withOtlp().observability?.exporter).toBe('none');
    errors.mockRestore();
  });
});
