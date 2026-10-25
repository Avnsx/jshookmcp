/**
 * The vector-search model is fetched from Hugging Face only when a search needs it, never in the background at start,
 * and the first search that needs it tells the user what is downloaded, from where, and how to skip it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let cacheRoot: string;

beforeEach(() => {
  vi.resetModules();
  cacheRoot = mkdtempSync(join(tmpdir(), 'jshook-models-'));
  process.env.JSHOOK_EMBEDDING_MODEL_CACHE_DIR = cacheRoot;
});
afterEach(() => {
  delete process.env.JSHOOK_EMBEDDING_MODEL_CACHE_DIR;
  delete process.env.SEARCH_VECTOR_PREWARM;
  rmSync(cacheRoot, { recursive: true, force: true });
});

describe('vector-search model notice', () => {
  it('does not prewarm the model in the background by default', async () => {
    const { SEARCH_VECTOR_PREWARM } = await import('@src/constants');
    expect(SEARCH_VECTOR_PREWARM).toBe(false);
  });

  it('names the model, its source, its cache and the opt-out when the model is missing', async () => {
    const { modelDownloadNotice } = await import('@server/search/StaticEmbeddingModel');
    const notice = await modelDownloadNotice('org/model-x');
    expect(notice).toContain('org/model-x');
    expect(notice).toContain('https://huggingface.co');
    expect(notice).toContain(cacheRoot);
    expect(notice).toContain('SEARCH_VECTOR_ENABLED=false');
  });

  it('says nothing once both model files are cached', async () => {
    const { modelCacheDirectory, modelDownloadNotice } =
      await import('@server/search/StaticEmbeddingModel');
    const dir = modelCacheDirectory('org/model-x');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tokenizer.json'), '{}');
    writeFileSync(join(dir, 'model.safetensors'), '');
    expect(await modelDownloadNotice('org/model-x')).toBeUndefined();
  });

  it('the search engine gives the notice once, and none with vector search off', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([], undefined, undefined, undefined, {
      vectorEnabled: true,
      vectorModelId: 'org/model-x',
    } as never);
    expect(await engine.vectorModelNotice()).toContain('org/model-x');
    expect(await engine.vectorModelNotice()).toBeUndefined();
    const off = new ToolSearchEngine([], undefined, undefined, undefined, {
      vectorEnabled: false,
    } as never);
    expect(await off.vectorModelNotice()).toBeUndefined();
  });
});
