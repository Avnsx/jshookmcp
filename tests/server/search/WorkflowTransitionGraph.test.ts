import { describe, expect, it } from 'vitest';
import { WorkflowTransitionGraph } from '@server/search/WorkflowTransitionGraph';

describe('search/WorkflowTransitionGraph', () => {
  it('returns empty boost map when activeToolNames is undefined or empty', () => {
    expect(WorkflowTransitionGraph.getTransitionBoosts().size).toBe(0);
    expect(WorkflowTransitionGraph.getTransitionBoosts(new Set()).size).toBe(0);
  });

  it('provides sequential transition boosts for active tools', () => {
    const active = new Set(['browser_launch']);
    const boosts = WorkflowTransitionGraph.getTransitionBoosts(active);

    expect(boosts.has('page_navigate')).toBe(true);
    expect(boosts.has('browser_attach')).toBe(true);
    expect(boosts.get('page_navigate')).toBeGreaterThan(1.0);
  });

  it('aggregates and caps multi-active transition boosts', () => {
    const active = new Set(['network_enable', 'network_monitor']);
    const boosts = WorkflowTransitionGraph.getTransitionBoosts(active);

    expect(boosts.has('network_get_requests')).toBe(true);
    expect(boosts.get('network_get_requests')!).toBeLessThanOrEqual(1.4);
  });

  it('ignores unknown or unregistered tools safely', () => {
    const active = new Set(['unknown_custom_tool']);
    const boosts = WorkflowTransitionGraph.getTransitionBoosts(active);
    expect(boosts.size).toBe(0);
  });
});
