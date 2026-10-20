/**
 * Tool Merkle State and Witness implementation.
 * Inspired by Mina Protocol's concise state commitment and Merkle verification.
 *
 * Provides O(1) state verification across processes and O(log N) membership proofs
 * for tools in the catalog without transferring the full tool collection.
 */

import { createHash } from 'node:crypto';

export interface MerkleProofStep {
  readonly position: 'left' | 'right';
  readonly hash: string;
}

export interface ToolStateWitness {
  readonly toolName: string;
  readonly leafHash: string;
  readonly proof: readonly MerkleProofStep[];
  readonly stateRoot: string;
}

export interface ToolDescriptorForCommitment {
  readonly name: string;
  readonly domain?: string | null;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Hash a canonical tool leaf node into a 32-byte hexadecimal representation.
 */
export function hashToolLeaf(tool: ToolDescriptorForCommitment): string {
  const schemaStr = tool.inputSchema ? JSON.stringify(tool.inputSchema) : '';
  const canonical = [tool.name, tool.domain ?? '', tool.description ?? '', schemaStr].join('\x1f');
  return sha256Hex(`tool_leaf\x00${canonical}`);
}

/**
 * Combine two child hashes in the Merkle Tree.
 */
function hashNodes(left: string, right: string): string {
  return sha256Hex(`node\x00${left}\x00${right}`);
}

/**
 * Merkle Tree that maintains a succinct cryptographic commitment
 * over all indexed tools in the search engine.
 */
export class ToolMerkleTree {
  private readonly leaves: readonly string[];
  private readonly toolIndexByName: ReadonlyMap<string, number>;
  private readonly levels: readonly (readonly string[])[];
  readonly root: string;

  constructor(tools: readonly ToolDescriptorForCommitment[]) {
    // Sort tools canonically by name to guarantee deterministic state root
    const sorted = [...tools].toSorted((a, b) => a.name.localeCompare(b.name));
    const indexMap = new Map<string, number>();
    const leafHashes: string[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const tool = sorted[i]!;
      indexMap.set(tool.name, i);
      leafHashes.push(hashToolLeaf(tool));
    }

    this.toolIndexByName = indexMap;
    this.leaves = leafHashes;

    if (leafHashes.length === 0) {
      this.root = sha256Hex('empty_merkle_tree');
      this.levels = [];
      return;
    }

    // Build tree levels bottom-up
    const levels: string[][] = [leafHashes];
    let currentLevel = leafHashes;

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i]!;
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1]! : left;
        nextLevel.push(hashNodes(left, right));
      }
      levels.push(nextLevel);
      currentLevel = nextLevel;
    }

    this.levels = levels;
    this.root = currentLevel[0]!;
  }

  /**
   * Total number of committed tools.
   */
  get size(): number {
    return this.leaves.length;
  }

  /**
   * Generate an O(log N) membership witness for a given tool name.
   */
  getWitness(toolName: string): ToolStateWitness | null {
    const index = this.toolIndexByName.get(toolName);
    if (index === undefined) return null;

    const proof: MerkleProofStep[] = [];
    let currentIndex = index;

    for (let l = 0; l < this.levels.length - 1; l++) {
      const level = this.levels[l]!;
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < level.length) {
        proof.push({
          position: isRight ? 'left' : 'right',
          hash: level[siblingIndex]!,
        });
      } else {
        // If odd node with no right sibling, it was paired with itself
        proof.push({
          position: 'right',
          hash: level[currentIndex]!,
        });
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      toolName,
      leafHash: this.leaves[index]!,
      proof,
      stateRoot: this.root,
    };
  }

  /**
   * Succinctly verify a tool state witness against a known state root.
   */
  static verifyWitness(witness: ToolStateWitness, expectedRoot?: string): boolean {
    const targetRoot = expectedRoot ?? witness.stateRoot;
    let currentHash = witness.leafHash;

    for (const step of witness.proof) {
      if (step.position === 'left') {
        currentHash = hashNodes(step.hash, currentHash);
      } else {
        currentHash = hashNodes(currentHash, step.hash);
      }
    }

    return currentHash === targetRoot;
  }
}
