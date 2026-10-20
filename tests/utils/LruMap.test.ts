import { describe, expect, it, vi } from 'vitest';
import { LruMap } from '@utils/LruMap';

describe('LruMap', () => {
  it('enforces capacity and LRU eviction', () => {
    const map = new LruMap<string, number>(2);
    map.set('a', 1);
    map.set('b', 2);
    expect(map.get('a')).toBe(1); // promote 'a'
    map.set('c', 3); // evict 'b'

    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(false);
    expect(map.has('c')).toBe(true);
  });

  it('triggers onEvict callback on capacity overflow', () => {
    const onEvict = vi.fn();
    const map = new LruMap<string, number>(2, onEvict);
    map.set('x', 10);
    map.set('y', 20);
    map.set('z', 30); // should evict 'x'

    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith('x', 10);
  });

  it('peek does not reorder elements', () => {
    const onEvict = vi.fn();
    const map = new LruMap<string, number>(2, onEvict);
    map.set('a', 1);
    map.set('b', 2);
    expect(map.peek('a')).toBe(1); // peek should NOT promote 'a'
    map.set('c', 3); // should evict 'a' since it was oldest

    expect(onEvict).toHaveBeenCalledWith('a', 1);
    expect(map.has('a')).toBe(false);
  });
});
