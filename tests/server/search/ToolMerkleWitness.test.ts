import { describe, expect, it } from 'vitest';
import {
  hashToolLeaf,
  ToolMerkleTree,
  type ToolDescriptorForCommitment,
} from '@server/search/ToolMerkleWitness';
import { ToolSearchEngine } from '@server/search/ToolSearchEngineImpl';
import type { Tool } from '@modelcontextprotocol/server';

describe('ToolMerkleWitness & Cryptographic State Commitment', () => {
  const dummyTools: ToolDescriptorForCommitment[] = [
    {
      name: 'memory_scanner',
      domain: 'native',
      description: 'Scans native process memory for patterns',
      inputSchema: { type: 'object', properties: { pattern: { type: 'string' } } },
    },
    {
      name: 'frida_attach',
      domain: 'hook',
      description: 'Attaches Frida to a target PID',
      inputSchema: { type: 'object', properties: { pid: { type: 'number' } } },
    },
    {
      name: 'debugger_step',
      domain: 'debugger',
      description: 'Steps execution in debugger',
      inputSchema: { type: 'object' },
    },
  ];

  it('computes deterministic root hash regardless of input ordering', () => {
    const tree1 = new ToolMerkleTree(dummyTools);
    const tree2 = new ToolMerkleTree(dummyTools.toReversed());

    expect(tree1.root).toMatch(/^[0-9a-f]{64}$/);
    expect(tree1.root).toBe(tree2.root);
    expect(tree1.size).toBe(3);
  });

  it('detects any alteration in tool descriptors', () => {
    const treeOriginal = new ToolMerkleTree(dummyTools);

    const alteredTools: ToolDescriptorForCommitment[] = [
      dummyTools[0]!,
      {
        ...dummyTools[1]!,
        description: 'Attaches Frida to a target PID with stealth options', // altered
      },
      dummyTools[2]!,
    ];
    const treeAltered = new ToolMerkleTree(alteredTools);

    expect(treeAltered.root).not.toBe(treeOriginal.root);
  });

  it('generates valid membership witness and verifies successfully', () => {
    const tree = new ToolMerkleTree(dummyTools);
    const witness = tree.getWitness('frida_attach');

    expect(witness).not.toBeNull();
    expect(witness!.toolName).toBe('frida_attach');
    expect(witness!.stateRoot).toBe(tree.root);
    expect(witness!.leafHash).toBe(hashToolLeaf(dummyTools[1]!));
    expect(witness!.proof.length).toBeGreaterThan(0);

    // Succinct verification
    const isValid = ToolMerkleTree.verifyWitness(witness!);
    expect(isValid).toBe(true);
  });

  it('rejects tampered witnesses', () => {
    const tree = new ToolMerkleTree(dummyTools);
    const witness = tree.getWitness('frida_attach')!;

    // Tamper with leaf hash
    const fakeWitness = {
      ...witness,
      leafHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    };
    expect(ToolMerkleTree.verifyWitness(fakeWitness)).toBe(false);

    // Tamper with expected root
    expect(
      ToolMerkleTree.verifyWitness(
        witness,
        '0000000000000000000000000000000000000000000000000000000000000000',
      ),
    ).toBe(false);
  });

  it('integrates state commitment and witness into ToolSearchEngine', async () => {
    const tools: Tool[] = [
      {
        name: 'test_engine_tool',
        description: 'A tool for testing engine lookup and state root',
        inputSchema: { type: 'object' },
      },
      {
        name: 'another_tool',
        description: 'Another sample tool description',
        inputSchema: { type: 'object' },
      },
    ];

    const engine = new ToolSearchEngine(
      tools,
      new Map([
        ['test_engine_tool', 'test'],
        ['another_tool', 'test'],
      ]),
    );

    // State root exists and is valid
    const root = engine.getStateRoot();
    expect(root).toMatch(/^[0-9a-f]{64}$/);

    // Tool witness can be generated from engine
    const witness = engine.getToolWitness('test_engine_tool');
    expect(witness).not.toBeNull();
    expect(witness!.toolName).toBe('test_engine_tool');
    expect(ToolMerkleTree.verifyWitness(witness!)).toBe(true);

    // Search continues to work with lookup table optimizations
    const results = await engine.search('test engine', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('test_engine_tool');
  });
});
