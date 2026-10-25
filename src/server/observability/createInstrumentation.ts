/**
 * Choose the instrumentation implementation from config.
 *
 * Kept out of `InstrumentationContract.ts` so the contract module stays free
 * of config types, and out of `MCPServer` so the decision is testable on its
 * own.
 *
 * Instrumentation never leaves the process: this build ships no telemetry
 * exporter. The default is `NoopInstrumentation`; `observability.exporter:
 * 'memory'` opts into `InMemoryInstrumentation`, which is bounded and
 * inspectable from inside the process.
 */

import type { Config } from '@internal-types/index';
import { InMemoryInstrumentation } from './InMemoryInstrumentation';
import { type InstrumentationContract, NoopInstrumentation } from './InstrumentationContract';

export function createInstrumentation(
  config: Pick<Config, 'observability'>,
): InstrumentationContract {
  const settings = config.observability;
  if (settings?.exporter === 'memory') {
    return new InMemoryInstrumentation(settings.maxSpans);
  }
  return new NoopInstrumentation();
}
