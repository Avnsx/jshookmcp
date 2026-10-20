import { describe, expect, it } from 'vitest';
import { EevdfScheduler } from '@server/runtime/EevdfScheduler';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('EevdfScheduler (Earliest Eligible Virtual Deadline First)', () => {
  it('prioritizes tasks with earlier virtual deadlines over heavy tasks', async () => {
    // Single concurrency to test ordering strictly
    const scheduler = new EevdfScheduler({ maxConcurrency: 1 });
    const executionOrder: string[] = [];

    // Session A queues a heavy task (estimated 200ms)
    // Session B queues a light task (estimated 10ms)
    // Session C queues an interactive task (estimated 5ms)

    const pHeavy = scheduler.schedule({
      id: 'task-heavy',
      sessionId: 'session-heavy',
      costHintMs: 200,
      fn: async () => {
        await delay(30);
        executionOrder.push('heavy');
        return 'heavy-done';
      },
    });

    const pLight = scheduler.schedule({
      id: 'task-light',
      sessionId: 'session-light',
      costHintMs: 10,
      fn: async () => {
        await delay(5);
        executionOrder.push('light');
        return 'light-done';
      },
    });

    const pUltraLight = scheduler.schedule({
      id: 'task-ultra',
      sessionId: 'session-ultra',
      costHintMs: 2,
      fn: async () => {
        await delay(5);
        executionOrder.push('ultra-light');
        return 'ultra-done';
      },
    });

    await Promise.all([pHeavy, pLight, pUltraLight]);

    // First scheduled was 'heavy' because it was enqueued when queue was empty and dispatched immediately.
    // But when choosing between 'light' and 'ultra-light' that arrived during heavy's execution,
    // ultra-light has a closer virtual deadline (2ms vs 10ms) and must be dispatched before light!
    expect(executionOrder[0]).toBe('heavy');
    expect(executionOrder[1]).toBe('ultra-light');
    expect(executionOrder[2]).toBe('light');
  });

  it('maintains system virtual time monotonicity and advances vruntime', async () => {
    const scheduler = new EevdfScheduler({ maxConcurrency: 1 });

    await scheduler.schedule({
      id: 't1',
      sessionId: 's1',
      costHintMs: 10,
      fn: async () => {
        await delay(10);
        return true;
      },
    });

    expect(scheduler.getSystemVirtualTime()).toBeGreaterThan(0);
    const s1 = scheduler.getSessionState('s1');
    expect(s1).toBeDefined();
    expect(s1!.taskCount).toBe(1);
    expect(s1!.vruntimeMs).toBeGreaterThan(0);
  });

  it('enforces concurrency limit', async () => {
    const scheduler = new EevdfScheduler({ maxConcurrency: 2 });
    let concurrentCount = 0;
    let maxObserved = 0;

    const runTask = async () => {
      concurrentCount++;
      maxObserved = Math.max(maxObserved, concurrentCount);
      await delay(20);
      concurrentCount--;
    };

    const tasks = Array.from({ length: 6 }, (_, i) =>
      scheduler.schedule({
        id: `c-${i}`,
        sessionId: `sess-${i % 2}`,
        fn: runTask,
      }),
    );

    await Promise.all(tasks);
    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  it('clamps excessive negative lag when an idle session re-enters', async () => {
    const scheduler = new EevdfScheduler({ maxConcurrency: 1, maxLagMs: 50 });

    // Advance system time with a heavy session
    await scheduler.schedule({
      id: 'h1',
      sessionId: 'heavy',
      costHintMs: 200,
      fn: async () => delay(100),
    });

    const sysVTime = scheduler.getSystemVirtualTime();
    expect(sysVTime).toBeGreaterThanOrEqual(100);

    // Now an old session that was idle at vruntime = 0 schedules again
    // Its lag should be clamped so vruntime >= sysVTime - maxLagMs (>= 50)
    await scheduler.schedule({
      id: 'w1',
      sessionId: 'waker',
      costHintMs: 10,
      fn: async () => delay(5),
    });

    const wakerState = scheduler.getSessionState('waker');
    expect(wakerState!.vruntimeMs).toBeGreaterThanOrEqual(sysVTime - 60);
  });
});
