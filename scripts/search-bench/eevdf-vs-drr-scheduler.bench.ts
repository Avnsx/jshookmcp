/**
 * Benchmark suite: EEVDF (Earliest Eligible Virtual Deadline First) vs DRR (Deficit Round Robin)
 *
 * Evaluates scheduling behavior for multi-agent MCP tool execution:
 * 1. Heterogeneous Mixed Workload: Light interactive agent queries (10ms) vs Heavy batch analysis (150ms).
 * 2. Head-of-Line (HoL) Preemption: Latency of an interactive query arriving behind a burst of heavy tasks.
 * 3. Priority / Weight Differentiation: Service share & latency under asymmetric weights (VIP vs Standard).
 */

import { performance } from 'node:perf_hooks';
import { BrowserSessionCoordinator } from '../../src/server/runtime/BrowserSessionCoordinator';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computePercentiles(values: number[]): {
  min: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  max: number;
  stddev: number;
} {
  if (values.length === 0) {
    return { min: 0, mean: 0, median: 0, p95: 0, p99: 0, max: 0, stddev: 0 };
  }
  const sorted = values.toSorted((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const variance = sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / sorted.length;
  const stddev = Math.sqrt(variance);

  const p50Index = Math.floor(sorted.length * 0.5);
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p99Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));

  return {
    min: Number(sorted[0]!.toFixed(2)),
    mean: Number(mean.toFixed(2)),
    median: Number(sorted[p50Index]!.toFixed(2)),
    p95: Number(sorted[p95Index]!.toFixed(2)),
    p99: Number(sorted[p99Index]!.toFixed(2)),
    max: Number(sorted[sorted.length - 1]!.toFixed(2)),
    stddev: Number(stddev.toFixed(2)),
  };
}

async function runHeterogeneousBenchmark(policy: 'drr-aging' | 'eevdf') {
  const coordinator = new BrowserSessionCoordinator(() => null, {
    policy,
    quantumMs: 100,
    agingMs: 30_000,
    maxPending: 500,
    maxPendingPerSession: 50,
  });

  const interactiveLatencies: number[] = [];
  const heavyLatencies: number[] = [];

  const NUM_SESSIONS = 10;
  const HEAVY_SESSIONS = 2; // Sessions 0, 1

  const tasks: Promise<void>[] = [];
  const startTime = performance.now();

  // Sessions 0 and 1 submit 8 heavy tasks each (simulating 40ms CPU/CDP tasks, hint=150ms)
  for (let s = 0; s < HEAVY_SESSIONS; s++) {
    const sessionId = `heavy-agent-${s}`;
    for (let i = 0; i < 8; i++) {
      const enqueuedAt = performance.now();
      const p = coordinator.runExclusive(
        sessionId,
        async () => {
          await sleep(35);
          heavyLatencies.push(performance.now() - enqueuedAt);
        },
        { costHintMs: 150 },
      );
      tasks.push(p);
    }
  }

  // Sessions 2 to 9 submit 15 interactive queries each (simulating 4ms DOM/eval tasks, hint=10ms)
  for (let s = HEAVY_SESSIONS; s < NUM_SESSIONS; s++) {
    const sessionId = `interactive-agent-${s}`;
    for (let i = 0; i < 15; i++) {
      // Stagger submissions slightly to simulate incoming user prompts
      const enqueuedAt = performance.now();
      const p = coordinator.runExclusive(
        sessionId,
        async () => {
          await sleep(4);
          interactiveLatencies.push(performance.now() - enqueuedAt);
        },
        { costHintMs: 10 },
      );
      tasks.push(p);
    }
  }

  await Promise.all(tasks);
  const totalElapsed = performance.now() - startTime;
  coordinator.dispose();

  return {
    totalElapsed,
    interactive: computePercentiles(interactiveLatencies),
    heavy: computePercentiles(heavyLatencies),
    totalTasks: tasks.length,
    throughput: (tasks.length / (totalElapsed / 1000)).toFixed(1),
  };
}

async function runHeadOfLinePreemptionBenchmark(policy: 'drr-aging' | 'eevdf') {
  const coordinator = new BrowserSessionCoordinator(() => null, {
    policy,
    quantumMs: 250, // default production quantum
    agingMs: 30_000,
  });

  const interactiveDelays: number[] = [];
  const ROUNDS = 5;

  for (let round = 0; round < ROUNDS; round++) {
    // 1. Five separate heavy sessions submit a heavy task each (40ms execution each, hint=200ms)
    // This creates a multi-session queue in front of any newly arriving session.
    const heavyPromises: Promise<void>[] = [];
    for (let h = 0; h < 5; h++) {
      heavyPromises.push(
        coordinator.runExclusive(
          `heavy-session-${round}-${h}`,
          async () => {
            await sleep(35);
          },
          { costHintMs: 200 },
        ),
      );
    }

    // Give 5ms for first heavy task to begin execution
    await sleep(5);

    // 2. Interactive session arrives with an urgent 3ms query (hint=5ms)
    const enqueuedAt = performance.now();
    const interactivePromise = coordinator.runExclusive(
      `interactive-flow-${round}`,
      async () => {
        await sleep(3);
        interactiveDelays.push(performance.now() - enqueuedAt);
      },
      { costHintMs: 5 },
    );

    await Promise.all([...heavyPromises, interactivePromise]);
  }

  coordinator.dispose();
  return computePercentiles(interactiveDelays);
}

async function runWeightedPriorityBenchmark(policy: 'drr-aging' | 'eevdf') {
  const coordinator = new BrowserSessionCoordinator(() => null, {
    policy,
    quantumMs: 100,
    agingMs: 30_000,
    maxPending: 100,
    maxPendingPerSession: 50,
  });

  const vipLatencies: number[] = [];
  const normalLatencies: number[] = [];
  const tasks: Promise<void>[] = [];

  // Concurrently submit 20 tasks to VIP session (weight=4) and 20 tasks to Normal session (weight=1)
  for (let i = 0; i < 20; i++) {
    const tVip = performance.now();
    tasks.push(
      coordinator.runExclusive(
        'vip-session',
        async () => {
          await sleep(10);
          vipLatencies.push(performance.now() - tVip);
        },
        { costHintMs: 30, weight: 4.0 },
      ),
    );

    const tNorm = performance.now();
    tasks.push(
      coordinator.runExclusive(
        'normal-session',
        async () => {
          await sleep(10);
          normalLatencies.push(performance.now() - tNorm);
        },
        { costHintMs: 30, weight: 1.0 },
      ),
    );
  }

  await Promise.all(tasks);
  coordinator.dispose();

  return {
    vip: computePercentiles(vipLatencies),
    normal: computePercentiles(normalLatencies),
  };
}

async function main() {
  console.log('\n======================================================================');
  console.log(' Scheduler Benchmark: DRR (Deficit Round Robin) vs EEVDF (Linux 6.6)');
  console.log('======================================================================\n');

  // -------------------------------------------------------------------------
  // Benchmark 1: Heterogeneous Workload (Interactive Agent vs Heavy Analysis)
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------------');
  console.log(' [1] Heterogeneous Multi-Agent Workload (136 tasks across 10 sessions)');
  console.log('     - 80% Interactive agent queries (eval, DOM lookup, cost=10ms)');
  console.log('     - 20% Heavy background tasks (AST parse, memory trace, cost=150ms)');
  console.log('----------------------------------------------------------------------');

  console.log('Running DRR-Aging baseline...');
  const drrResult = await runHeterogeneousBenchmark('drr-aging');
  console.log('Running EEVDF implementation...');
  const eevdfResult = await runHeterogeneousBenchmark('eevdf');

  console.log('\n--- Interactive Queries Latency (ms) ---');
  console.table({
    'DRR (Deficit Round Robin)': {
      Mean: `${drrResult.interactive.mean} ms`,
      P50: `${drrResult.interactive.median} ms`,
      P95: `${drrResult.interactive.p95} ms`,
      P99: `${drrResult.interactive.p99} ms`,
      Max: `${drrResult.interactive.max} ms`,
      Jitter: `±${drrResult.interactive.stddev} ms`,
    },
    'EEVDF (Linux 6.6 Virtual Deadline)': {
      Mean: `${eevdfResult.interactive.mean} ms`,
      P50: `${eevdfResult.interactive.median} ms`,
      P95: `${eevdfResult.interactive.p95} ms`,
      P99: `${eevdfResult.interactive.p99} ms`,
      Max: `${eevdfResult.interactive.max} ms`,
      Jitter: `±${eevdfResult.interactive.stddev} ms`,
    },
  });

  const p50Improvement = (
    ((drrResult.interactive.median - eevdfResult.interactive.median) /
      drrResult.interactive.median) *
    100
  ).toFixed(1);
  const p95Improvement = (
    ((drrResult.interactive.p95 - eevdfResult.interactive.p95) / drrResult.interactive.p95) *
    100
  ).toFixed(1);
  const jitterImprovement = (
    ((drrResult.interactive.stddev - eevdfResult.interactive.stddev) /
      drrResult.interactive.stddev) *
    100
  ).toFixed(1);

  console.log(
    `>> EEVDF Interactive P50 Latency Improvement: ${p50Improvement}% faster (P95: ${p95Improvement}%, Jitter: ${jitterImprovement}% reduction)`,
  );

  console.log('\n--- Heavy Tasks Completion Latency (ms) ---');
  console.table({
    'DRR (Deficit Round Robin)': {
      Mean: `${drrResult.heavy.mean} ms`,
      P50: `${drrResult.heavy.median} ms`,
      P95: `${drrResult.heavy.p95} ms`,
      Max: `${drrResult.heavy.max} ms`,
    },
    'EEVDF (Linux 6.6 Virtual Deadline)': {
      Mean: `${eevdfResult.heavy.mean} ms`,
      P50: `${eevdfResult.heavy.median} ms`,
      P95: `${eevdfResult.heavy.p95} ms`,
      Max: `${eevdfResult.heavy.max} ms`,
    },
  });

  // -------------------------------------------------------------------------
  // Benchmark 2: Head-of-Line (HoL) Preemption
  // -------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------------');
  console.log(' [2] Head-of-Line (HoL) Blocking & Preemption Response Time');
  console.log('     Arrival of an interactive query while 4 heavy tasks are backlogged');
  console.log('----------------------------------------------------------------------');

  const drrHol = await runHeadOfLinePreemptionBenchmark('drr-aging');
  const eevdfHol = await runHeadOfLinePreemptionBenchmark('eevdf');

  console.table({
    'DRR (HoL Delay)': {
      Mean: `${drrHol.mean} ms`,
      Median: `${drrHol.median} ms`,
      Max: `${drrHol.max} ms`,
    },
    'EEVDF (HoL Delay)': {
      Mean: `${eevdfHol.mean} ms`,
      Median: `${eevdfHol.median} ms`,
      Max: `${eevdfHol.max} ms`,
    },
  });

  const holReduction = (((drrHol.median - eevdfHol.median) / drrHol.median) * 100).toFixed(1);
  console.log(`>> EEVDF HoL Interactive Delay Reduction: ${holReduction}% faster response`);

  // -------------------------------------------------------------------------
  // Benchmark 3: Priority & Weighted Fair Sharing
  // -------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------------');
  console.log(' [3] Weighted Fair Sharing (VIP w=4.0 vs Standard w=1.0)');
  console.log('----------------------------------------------------------------------');

  const drrWeighted = await runWeightedPriorityBenchmark('drr-aging');
  const eevdfWeighted = await runWeightedPriorityBenchmark('eevdf');

  console.table({
    'DRR VIP (w=4)': { Mean: `${drrWeighted.vip.mean} ms`, Median: `${drrWeighted.vip.median} ms` },
    'DRR Standard (w=1)': {
      Mean: `${drrWeighted.normal.mean} ms`,
      Median: `${drrWeighted.normal.median} ms`,
    },
    'EEVDF VIP (w=4)': {
      Mean: `${eevdfWeighted.vip.mean} ms`,
      Median: `${eevdfWeighted.vip.median} ms`,
    },
    'EEVDF Standard (w=1)': {
      Mean: `${eevdfWeighted.normal.mean} ms`,
      Median: `${eevdfWeighted.normal.median} ms`,
    },
  });

  console.log('\n======================================================================');
  console.log(' Scheduler Benchmark Complete');
  console.log('======================================================================\n');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
