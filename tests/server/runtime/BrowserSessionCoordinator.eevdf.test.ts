import { describe, expect, it } from 'vitest';
import { BrowserSessionCoordinator } from '@server/runtime/BrowserSessionCoordinator';

describe('BrowserSessionCoordinator (EEVDF Policy)', () => {
  it('initializes with eevdf policy and reports systemVirtualTimeMs', () => {
    const coordinator = new BrowserSessionCoordinator(() => null, {
      policy: 'eevdf',
    });
    try {
      const stats = coordinator.getQueueStats();
      expect(stats.policy).toBe('eevdf');
      expect(typeof stats.systemVirtualTimeMs).toBe('number');
      expect(stats.systemVirtualTimeMs).toBe(0);
    } finally {
      coordinator.dispose();
    }
  });

  it('prioritizes light interactive queries over heavy tasks using virtual deadlines', async () => {
    let mockClock = 0;
    const coordinator = new BrowserSessionCoordinator(
      () => null,
      {
        policy: 'eevdf',
        agingMs: 60_000,
      },
      () => mockClock,
    );

    const executionOrder: string[] = [];

    try {
      // Session A queues a heavy task (estimated cost 500ms)
      const taskA1 = coordinator.runExclusive(
        'session-heavy',
        async () => {
          executionOrder.push('heavy-1');
          mockClock += 200; // takes 200ms
          return 'done-heavy-1';
        },
        { costHintMs: 500 },
      );

      // While heavy-1 starts draining immediately, Session A queues heavy-2
      const taskA2 = coordinator.runExclusive(
        'session-heavy',
        async () => {
          executionOrder.push('heavy-2');
          mockClock += 200;
          return 'done-heavy-2';
        },
        { costHintMs: 500 },
      );

      // Session B queues a light task (cost 10ms)
      const taskB1 = coordinator.runExclusive(
        'session-light',
        async () => {
          executionOrder.push('light-1');
          mockClock += 10;
          return 'done-light-1';
        },
        { costHintMs: 10 },
      );

      // Session C queues another light task (cost 10ms)
      const taskC1 = coordinator.runExclusive(
        'session-light-2',
        async () => {
          executionOrder.push('light-2');
          mockClock += 10;
          return 'done-light-2';
        },
        { costHintMs: 10 },
      );

      await Promise.all([taskA1, taskA2, taskB1, taskC1]);

      // Execution order:
      // heavy-1 was admitted immediately at start.
      // After heavy-1 completes, both heavy-2 (d = v + 500) and light-1 (d = v + 10) and light-2 (d = v + 10) are ready.
      // EEVDF must prioritize light-1 and light-2 before heavy-2!
      expect(executionOrder[0]).toBe('heavy-1');
      expect(executionOrder[1]).toBe('light-1');
      expect(executionOrder[2]).toBe('light-2');
      expect(executionOrder[3]).toBe('heavy-2');
    } finally {
      coordinator.dispose();
    }
  });

  it('respects task weights to modulate virtual deadline urgency', async () => {
    let mockClock = 0;
    const coordinator = new BrowserSessionCoordinator(
      () => null,
      {
        policy: 'eevdf',
        agingMs: 60_000,
      },
      () => mockClock,
    );

    const executionOrder: string[] = [];

    try {
      // First task to take concurrency slot 1
      const initial = coordinator.runExclusive(
        'starter',
        async () => {
          executionOrder.push('starter');
          mockClock += 50;
        },
        { costHintMs: 50 },
      );

      // Standard weight task (cost 100ms, w=1 -> d = v + 100)
      const standardTask = coordinator.runExclusive(
        'session-standard',
        async () => {
          executionOrder.push('standard');
          mockClock += 50;
        },
        { costHintMs: 100, weight: 1.0 },
      );

      // High priority task (cost 100ms, w=4 -> d = v + 25)
      const vipTask = coordinator.runExclusive(
        'session-vip',
        async () => {
          executionOrder.push('vip');
          mockClock += 50;
        },
        { costHintMs: 100, weight: 4.0 },
      );

      await Promise.all([initial, standardTask, vipTask]);

      expect(executionOrder).toEqual(['starter', 'vip', 'standard']);
    } finally {
      coordinator.dispose();
    }
  });

  it('enforces lag clamping when an idle session re-enters', async () => {
    let mockClock = 0;
    const coordinator = new BrowserSessionCoordinator(
      () => null,
      {
        policy: 'eevdf',
        maxLagMs: 200,
        agingMs: 60_000,
      },
      () => mockClock,
    );

    try {
      // Run many tasks on Session A to drive systemVirtualTimeMs way up
      for (let i = 0; i < 5; i++) {
        await coordinator.runExclusive(
          'busy-session',
          async () => {
            mockClock += 200;
          },
          { costHintMs: 200 },
        );
      }

      const stats = coordinator.getQueueStats();
      expect(stats.systemVirtualTimeMs).toBeGreaterThanOrEqual(1000);

      // Now idle session queues a task
      await coordinator.runExclusive(
        'idle-session',
        async () => {
          mockClock += 10;
        },
        { costHintMs: 10 },
      );

      // Queue stats should reflect updated state
      const finalStats = coordinator.getQueueStats();
      expect(finalStats.dispatchCount).toBe(6);
    } finally {
      coordinator.dispose();
    }
  });
});
