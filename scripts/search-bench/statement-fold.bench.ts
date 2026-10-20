/**
 * Before/after benchmark for the search statement fold:
 * exact-name vs single-token latency, feedback-storm cache misses,
 * and whether a tool call learns from a search that did not return it.
 *
 * Run: pnpm exec tsx scripts/search-bench/statement-fold.bench.ts <label>
 */
import { writeFileSync } from 'node:fs';
import type { Tool } from '@modelcontextprotocol/server';
import {
  SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE,
  SEARCH_FEEDBACK_FOLD_SIZE,
  SEARCH_VECTOR_LEARN_UP,
} from '@src/constants';
import type { SearchConfig } from '@internal-types/config';
import { BM25ScorerImpl } from '@server/search/BM25Scorer';
import { ToolSearchEngine } from '@server/search/ToolSearchEngineImpl';

const DOC_COUNT = 240;
const STORM_ITERS = 32;
const WARM_ITERS = 200;
const COLD_ITERS = 30;

const searchConfig = {
  queryCategoryProfiles: [],
  cjkQueryAliases: [],
  intentToolBoostRules: [],
  vectorEnabled: false,
  vectorDynamicWeight: true,
  vectorCosineWeight: 0.45,
  feedbackFoldSize: 4,
} as SearchConfig;

interface FakeEmbed {
  embedCalls: number;
  batchCalls: number;
}

function makeCatalog(): { tools: Tool[]; domains: Map<string, string> } {
  const domains = new Map<string, string>();
  const tools: Tool[] = [];
  const families = ['browser', 'debugger', 'network', 'hook', 'memory', 'wasm'];
  for (let i = 0; i < DOC_COUNT; i++) {
    const family = families[i % families.length]!;
    const name = `fam${i % 30}_tool_${i}`;
    const domain = family;
    const description =
      i === 0
        ? 'navigate page url in the browser'
        : i === 5
          ? 'pause execution breakpoint only'
          : i === 1 || i === 6
            ? 'sharedtokenxyz action'
            : `${family} generic work item ${i}`;
    tools.push({
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: { targetUrl: { type: 'string', description: 'Target URL' } },
      },
    });
    domains.set(name, domain);
  }
  return { tools, domains };
}

function unit(axis: 0 | 1): Float32Array {
  const vec = new Float32Array(4);
  vec[axis] = 1;
  return vec;
}

function installFakeEmbed(engine: ToolSearchEngine): FakeEmbed {
  const stats: FakeEmbed = { embedCalls: 0, batchCalls: 0 };
  const up = unit(0);
  const down = unit(1);
  const host = engine as unknown as {
    embeddingEngine: unknown;
    toolEmbeddings: Float32Array[] | null;
    prewarmPromise: Promise<void> | null;
  };
  // Seed the catalog directly so a background prewarm cannot race the bench.
  host.prewarmPromise = null;
  host.toolEmbeddings = Array.from({ length: DOC_COUNT }, (_, index) => (index === 0 ? up : down));
  host.embeddingEngine = {
    embedBatch: async (texts: string[]) => {
      stats.batchCalls += 1;
      return texts.map((_, index) => (index === 0 ? up : down));
    },
    embed: async (text: string) => {
      stats.embedCalls += 1;
      if (text.toLowerCase().includes('pause')) return down;
      // Successive misses flip fam0 between rank 0 and "not in the ranking".
      return stats.embedCalls % 2 === 1 ? up : down;
    },
  };
  return stats;
}

async function timeMs(iterations: number, fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  return performance.now() - start;
}

function epochOf(engine: ToolSearchEngine): number | null {
  const tracker = engine.getFeedbackTracker() as { getFeedbackEpoch?: () => number };
  return typeof tracker.getFeedbackEpoch === 'function' ? tracker.getFeedbackEpoch() : null;
}

async function main(): Promise<void> {
  const label = process.argv[2] ?? 'run';
  const { tools, domains } = makeCatalog();
  const scorer = new BM25ScorerImpl(searchConfig);
  const tokenReport = {
    navigate: scorer.tokenise('navigate').length,
    browser: scorer.tokenise('browser').length,
    exact: scorer.tokenise('fam0_tool_0').length,
  };

  const lexical = new ToolSearchEngine(tools, domains, undefined, undefined, searchConfig);
  await lexical.search('fam0_tool_0', 5);
  const exactColdMs = await timeMs(1, () => lexical.search('fam30_tool_30', 5));
  const exactWarmMs = await timeMs(WARM_ITERS, () => lexical.search('fam0_tool_0', 5));
  await lexical.search('browser', 5);
  const singleColdMs = await timeMs(1, () => lexical.search('debugger', 5));
  const singleWarmMs = await timeMs(WARM_ITERS, () => lexical.search('browser', 5));
  const coldEngine = new ToolSearchEngine(tools, domains, undefined, undefined, searchConfig);
  let coldN = 0;
  const multiColdMeasured = await timeMs(COLD_ITERS, async () => {
    coldN += 1;
    await coldEngine.search(`generic work item ${coldN + 100}`, 5);
  });
  const multiWarmMs = await timeMs(WARM_ITERS, () => lexical.search('navigate page url', 5));

  const vectorConfig = { ...searchConfig, vectorEnabled: true } as SearchConfig;
  const stormEngine = new ToolSearchEngine(tools, domains, undefined, undefined, vectorConfig);
  const stormEmbed = installFakeEmbed(stormEngine);
  const weightBeforeStorm = stormEngine.getFeedbackTracker().getVectorWeight();
  let stormIncluded = 0;
  const stormMs = await timeMs(STORM_ITERS, async () => {
    const results = await stormEngine.search('navigate page url', DOC_COUNT);
    if (results.some((result) => result.name === 'fam0_tool_0')) stormIncluded += 1;
    stormEngine.recordToolCallFeedback('fam0_tool_0', 'navigate page url');
  });
  const stormTop = await stormEngine.search('navigate page url', 5);

  const misbind = new ToolSearchEngine(tools, domains, undefined, undefined, vectorConfig);
  installFakeEmbed(misbind);
  const first = await misbind.search('navigate page url', 5);
  const second = await misbind.search('pause execution breakpoint', 5);
  const target = first[0]?.name ?? 'fam0_tool_0';
  const targetInSecond = second.some((result) => result.name === target);
  const weightBeforeMisbind = misbind.getFeedbackTracker().getVectorWeight();
  for (let i = 0; i < 4; i++) misbind.recordToolCallFeedback(target, 'navigate page url');
  const weightAfterMisbind = misbind.getFeedbackTracker().getVectorWeight();

  const tierEngine = new ToolSearchEngine(tools, domains, undefined, undefined, searchConfig);
  const browserTop = await tierEngine.search(
    'sharedtokenxyz action',
    5,
    undefined,
    new Set(['browser']),
  );
  const debuggerTop = await tierEngine.search(
    'sharedtokenxyz action',
    5,
    undefined,
    new Set(['debugger']),
  );

  const report = {
    label,
    docCount: DOC_COUNT,
    learnUp: SEARCH_VECTOR_LEARN_UP,
    tolerance: SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE,
    foldSizeConstant:
      typeof SEARCH_FEEDBACK_FOLD_SIZE === 'number' ? SEARCH_FEEDBACK_FOLD_SIZE : null,
    tokens: tokenReport,
    lexical: {
      exactColdMs: round(exactColdMs),
      exactWarmMsPerOp: round(exactWarmMs / WARM_ITERS),
      singleColdMs: round(singleColdMs),
      singleWarmMsPerOp: round(singleWarmMs / WARM_ITERS),
      multiColdMsPerOp: round(multiColdMeasured / COLD_ITERS),
      multiWarmMsPerOp: round(multiWarmMs / WARM_ITERS),
    },
    storm: {
      iterations: STORM_ITERS,
      totalMs: round(stormMs),
      msPerIter: round(stormMs / STORM_ITERS),
      embedCalls: stormEmbed.embedCalls,
      batchCalls: stormEmbed.batchCalls,
      targetIncluded: stormIncluded,
      weightDelta: round(stormEngine.getFeedbackTracker().getVectorWeight() - weightBeforeStorm),
      epoch: epochOf(stormEngine),
      top: stormTop[0]?.name ?? null,
    },
    misbind: {
      target,
      targetInSecond,
      weightDelta: round(weightAfterMisbind - weightBeforeMisbind),
      epoch: epochOf(misbind),
    },
    tier: {
      browserTop: browserTop[0]?.name ?? null,
      debuggerTop: debuggerTop[0]?.name ?? null,
    },
  };

  const path = `/tmp/search-bench-${label}.json`;
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

await main();
