/**
 * DreamRSI: Counterfactual Strategy Ablation & Interference Simulator
 *
 * Based on the DreamRSI paradigm (arXiv:2609.14858: Recursive Self-Improvement
 * through Emerging Worlds - Google DeepMind / UMD / UVA).
 *
 * Treats the 185 evaluation cases (Agent Workflows, Shorthands, Signatures,
 * Out-of-Domain Negatives, Chaining Transitions, Baseline Fixtures) as a frozen
 * "World Simulator".
 *
 * Runs counterfactual offline "dreaming" across strategy policy combinations
 * to detect:
 * 1. Negative strategy interference (destructive superposition: A + B < A)
 * 2. Over-optimization / over-constraining bottlenecks
 * 3. The true Pareto frontier of search engine strategy bundles
 */

import { initRegistry } from '../../src/server/registry/index';
import { allTools } from '../../src/server/ToolCatalog';
import {
  ToolSearchEngine,
  type SearchStrategyFlags,
} from '../../src/server/search/ToolSearchEngineImpl';
import { buildSearchQualityFixture } from '../../tests/server/search/fixtures/search-quality.fixture';

interface TestCase {
  id: string;
  query: string;
  expectedTools: string[];
  category: string;
}

interface NegativeTestCase {
  id: string;
  query: string;
  category: string;
}

interface SequentialCase {
  id: string;
  activeTools: string[];
  query: string;
  expectedTool: string;
}

// ── World Simulator Ground Truth Dataset (185 cases) ──

const AGENT_WORKFLOW_CASES: TestCase[] = [
  {
    id: 'agent-network-intercept',
    query: 'intercept HTTPS API requests and responses in real time',
    expectedTools: ['network_intercept', 'network_enable', 'network_monitor'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-search-scripts-crypto',
    query: 'search loaded scripts for AES encryption key and iv',
    expectedTools: ['search_in_scripts', 'detect_crypto'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-debugger-pause-step',
    query: 'pause execution and step to the next line in debugger',
    expectedTools: ['debugger_pause', 'debugger_step', 'debug_pause'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-memory-search-string',
    query: 'search process memory for ASCII and UTF-8 strings',
    expectedTools: ['memory_search_string', 'binary_strings_extract', 'memory_scan'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-jadx-decompile-dex',
    query: 'decompile Dalvik bytecode to Java classes with JADX',
    expectedTools: ['jadx_decompile', 'jadx_decompile_apk'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-frida-find-symbols',
    query: 'enumerate exported functions and symbols from native library',
    expectedTools: ['frida_find_symbols', 'frida_enumerate_functions', 'nemu_list_symbols'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-sourcemap-fetch',
    query: 'discover and parse sourcemap from production bundle',
    expectedTools: ['sourcemap_fetch_and_parse', 'sourcemap_discover'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-nemu-call-symbol',
    query: 'emulate native ELF shared object symbol invocation',
    expectedTools: ['nemu_call_symbol', 'unidbg_call'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-v8-heap-leak',
    query: 'inspect V8 heap snapshot to locate detached DOM memory leaks',
    expectedTools: ['v8_heap_find_leaks', 'v8_heap_snapshot_analyze'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-tls-pinning-bypass',
    query: 'bypass TLS certificate pinning and inspect handshake',
    expectedTools: ['tls_cert_pin_bypass', 'tls_cert_pin_bypass_frida', 'tls_parse_handshake'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-memory-scan-int',
    query: 'scan memory address space for exact integer value',
    expectedTools: ['memory_first_scan', 'memory_scan', 'memory_read_typed'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-exploit-rop-chain',
    query: 'build automated ROP chain gadget payload for x86_64 buffer overflow',
    expectedTools: ['exploit_build_rop_chain', 'exploit_find_gadgets'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-wasm-decompile-inspect',
    query: 'decompile WebAssembly binary module to readable C pseudocode',
    expectedTools: ['wasm_decompile', 'wasm_to_c', 'wasm_disassemble'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-stealth-fingerprint',
    query: 'generate realistic browser fingerprint to pass anti-bot bot-detect',
    expectedTools: ['stealth_generate_fingerprint', 'stealth_inject', 'stealth_verify'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-adb-apk-pull-install',
    query: 'pull installed APK package from connected Android device',
    expectedTools: ['adb_apk_pull', 'adb_file_pull'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-mojo-ipc-monitor',
    query: 'sniff and decode Chromium internal Mojo IPC interface messages',
    expectedTools: ['mojo_monitor', 'mojo_decode_message', 'mojo_messages_get'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-webgpu-shader-disasm',
    query: 'inspect and disassemble WebGPU WGSL compute shader pipeline',
    expectedTools: ['webgpu_shader_disassemble', 'webgpu_pipeline_dump'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-graphql-enum-schema',
    query: 'introspect GraphQL endpoint schema and extract queries',
    expectedTools: ['graphql_introspect', 'graphql_enum_schema', 'graphql_extract_queries'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-canvas-scene-dump',
    query: 'dump canvas WebGL render tree and pick interactive objects',
    expectedTools: ['canvas_scene_dump', 'canvas_pick_object_at_point'],
    category: 'Agent Workflows',
  },
  {
    id: 'agent-dart-flutter-objects',
    query: 'inspect Flutter Dart VM snapshot object pool and symbol table',
    expectedTools: ['dart_object_pool_dump', 'dart_inspect_object_pool', 'dart_symbolize'],
    category: 'Agent Workflows',
  },
];

const SHORTHAND_CASES: TestCase[] = [
  {
    id: 'short-set-bp',
    query: 'set bp on function offset',
    expectedTools: ['breakpoint', 'debugger_run_to_location'],
    category: 'Shorthand',
  },
  {
    id: 'short-mem-scan',
    query: 'mem scan 4-byte int',
    expectedTools: ['memory_scan', 'memory_first_scan'],
    category: 'Shorthand',
  },
  {
    id: 'short-enum-syms',
    query: 'enum exported native syms',
    expectedTools: ['frida_enumerate_functions', 'frida_find_symbols', 'nemu_list_symbols'],
    category: 'Shorthand',
  },
  {
    id: 'short-dex-classes',
    query: 'decompile dex classes',
    expectedTools: ['jadx_decompile', 'jadx_decompile_apk', 'apk_dex_intake'],
    category: 'Shorthand',
  },
  {
    id: 'short-pcap-pkts',
    query: 'read pcap network pkts',
    expectedTools: ['pcap_read', 'pcapng_read'],
    category: 'Shorthand',
  },
  {
    id: 'short-cpu-regs',
    query: 'read cpu regs state',
    expectedTools: ['nemu_set_registers', 'nemu_regs_restore'],
    category: 'Shorthand',
  },
  {
    id: 'short-rop-gadget',
    query: 'find rop gadget stack pivot',
    expectedTools: ['exploit_find_gadgets', 'exploit_build_stack_pivot'],
    category: 'Shorthand',
  },
  {
    id: 'short-proc-threads',
    query: 'list active proc threads',
    expectedTools: ['process_enum_threads', 'process_list'],
    category: 'Shorthand',
  },
  {
    id: 'short-tls-pin-bypass',
    query: 'tls cert pin bypass frida',
    expectedTools: ['tls_cert_pin_bypass_frida', 'tls_cert_pin_bypass'],
    category: 'Shorthand',
  },
  {
    id: 'short-auth-token',
    query: 'extract auth token from traffic',
    expectedTools: ['network_extract_auth'],
    category: 'Shorthand',
  },
  {
    id: 'short-apk-libs',
    query: 'dump apk native libs',
    expectedTools: ['apk_native_libs_list', 'adb_pull_native_libs', 'nemu_extract_apk_libs'],
    category: 'Shorthand',
  },
  {
    id: 'short-syscall-etw',
    query: 'trace syscall etw monitor',
    expectedTools: ['syscall_start_monitor', 'syscall_capture_events'],
    category: 'Shorthand',
  },
  {
    id: 'short-v8-turbofan',
    query: 'inspect v8 turbofan jit graph',
    expectedTools: ['v8_turbofan_graph', 'v8_turbofan_inspect'],
    category: 'Shorthand',
  },
  {
    id: 'short-wasm-decompile',
    query: 'decompile wasm module',
    expectedTools: ['wasm_decompile', 'wasm_disassemble'],
    category: 'Shorthand',
  },
  {
    id: 'short-inject-dll',
    query: 'inject dll into proc',
    expectedTools: ['inject_dll', 'inject_shellcode'],
    category: 'Shorthand',
  },
  {
    id: 'short-export-har',
    query: 'export har capture',
    expectedTools: ['network_export_har'],
    category: 'Shorthand',
  },
  {
    id: 'short-solve-captcha',
    query: 'solve turnstile captcha challenge',
    expectedTools: ['captcha_detect', 'captcha_wait', 'captcha_vision_solve'],
    category: 'Shorthand',
  },
  {
    id: 'short-diff-heaps',
    query: 'diff v8 heap snapshots',
    expectedTools: ['v8_heap_diff', 'diff_heap_snapshots'],
    category: 'Shorthand',
  },
  {
    id: 'short-ast-pipeline',
    query: 'deobfuscate ast transform pipeline',
    expectedTools: ['ast_transform_apply', 'js_deobfuscate_pipeline', 'webcrack_unpack'],
    category: 'Shorthand',
  },
  {
    id: 'short-dbg-eval',
    query: 'dbg evaluate expression',
    expectedTools: ['debugger_evaluate', 'page_evaluate'],
    category: 'Shorthand',
  },
];

const SIGNATURE_CASES: TestCase[] = [
  {
    id: 'sig-click-selector-timeout',
    query: 'click button accepting selector and timeout',
    expectedTools: ['page_click'],
    category: 'Signature',
  },
  {
    id: 'sig-navigate-url',
    query: 'navigate page requiring url and waitUntil',
    expectedTools: ['page_navigate'],
    category: 'Signature',
  },
  {
    id: 'sig-attach-target',
    query: 'attach frida requiring target process',
    expectedTools: ['frida_attach'],
    category: 'Signature',
  },
  {
    id: 'sig-memory-scan-address',
    query: 'scan memory accepting address and byte pattern',
    expectedTools: ['memory_scan', 'memory_aob_scan'],
    category: 'Signature',
  },
  {
    id: 'sig-nemu-call-session-address',
    query: 'call symbol with sessionId and address',
    expectedTools: ['nemu_call_address', 'nemu_call_symbol'],
    category: 'Signature',
  },
  {
    id: 'sig-write-memory-value',
    query: 'write bytes with address and value to memory',
    expectedTools: ['memory_write_value', 'memory_write'],
    category: 'Signature',
  },
  {
    id: 'sig-code-caves-minsize',
    query: 'find code caves requiring minSize and pid',
    expectedTools: ['memory_code_caves'],
    category: 'Signature',
  },
  {
    id: 'sig-logcat-filterspec',
    query: 'read logcat accepting filterSpec and maxLines',
    expectedTools: ['adb_logcat_query'],
    category: 'Signature',
  },
  {
    id: 'sig-decompile-apkpath',
    query: 'decompile apk requiring apkPath and outputDir',
    expectedTools: ['jadx_decompile_apk'],
    category: 'Signature',
  },
  {
    id: 'sig-ws-send-frame',
    query: 'send frame accepting connectionId and payload',
    expectedTools: ['ws_send_frame', 'websocket_send_frame'],
    category: 'Signature',
  },
  {
    id: 'sig-type-text-selector',
    query: 'type text into input requiring selector and text',
    expectedTools: ['page_type'],
    category: 'Signature',
  },
  {
    id: 'sig-screenshot-format',
    query: 'screenshot accepting fullPage and format',
    expectedTools: ['page_screenshot'],
    category: 'Signature',
  },
  {
    id: 'sig-eval-expression',
    query: 'evaluate expression on page requiring script',
    expectedTools: ['page_evaluate', 'debugger_evaluate'],
    category: 'Signature',
  },
  {
    id: 'sig-breakpoint-location',
    query: 'set breakpoint requiring line and column',
    expectedTools: ['breakpoint'],
    category: 'Signature',
  },
  {
    id: 'sig-stealth-useragent',
    query: 'configure stealth setting userAgent and platform',
    expectedTools: ['stealth_set_user_agent', 'stealth_inject'],
    category: 'Signature',
  },
];

const NEGATIVE_CASES: NegativeTestCase[] = [
  { id: 'neg-bake-cake', query: 'how to bake a chocolate cake at home', category: 'Cooking' },
  {
    id: 'neg-weather-tokyo',
    query: 'what is the current weather forecast for Tokyo',
    category: 'Weather',
  },
  {
    id: 'neg-eigenvalues',
    query: 'calculate eigenvalues and eigenvectors of a 3x3 matrix',
    category: 'Math',
  },
  {
    id: 'neg-movie-recom',
    query: 'recommend a top-rated sci-fi movie on Netflix',
    category: 'Entertainment',
  },
  {
    id: 'neg-poem-autumn',
    query: 'write a rhyming poem about golden autumn leaves',
    category: 'Poetry',
  },
  {
    id: 'neg-pizza-dough',
    query: 'authentic Neapolitan pizza dough yeast fermentation recipe',
    category: 'Cooking',
  },
  {
    id: 'neg-roman-empire',
    query: 'history of the Roman Empire from Augustus to Fall of Constantinople',
    category: 'History',
  },
  {
    id: 'neg-calories-avocado',
    query: 'how many calories and healthy fats are in an avocado',
    category: 'Nutrition',
  },
  {
    id: 'neg-marathon-training',
    query: 'training plan to run a marathon under three hours',
    category: 'Fitness',
  },
  {
    id: 'neg-photosynthesis',
    query: 'explain photosynthesis light-dependent reactions in chloroplasts',
    category: 'Biology',
  },
  {
    id: 'neg-dog-breeds',
    query: 'best hypoallergenic dog breeds for small apartment living',
    category: 'Pets',
  },
  {
    id: 'neg-world-cup',
    query: 'who won the FIFA World Cup final in 1998 in France',
    category: 'Sports',
  },
  {
    id: 'neg-jane-austen',
    query: 'literary analysis and character review of Pride and Prejudice',
    category: 'Literature',
  },
  {
    id: 'neg-general-relativity',
    query: 'explain Einstein theory of spacetime curvature and general relativity',
    category: 'Physics',
  },
  {
    id: 'neg-change-tire',
    query: 'step by step instructions to safely change a flat tire on highway',
    category: 'Automotive',
  },
  {
    id: 'neg-guitar-chords',
    query: 'learn beginner acoustic guitar chords C major and G minor',
    category: 'Music',
  },
  {
    id: 'neg-solar-system',
    query: 'orbital period and distance of Jupiter and Saturn from the Sun',
    category: 'Astronomy',
  },
  {
    id: 'neg-french-revolution',
    query: 'causes and key events of the French Revolution storming the Bastille',
    category: 'History',
  },
  {
    id: 'neg-indoor-plants',
    query: 'watering schedule and indirect sunlight care for monstera deliciosa',
    category: 'Gardening',
  },
  {
    id: 'neg-meditation-mind',
    query: 'mindfulness breathing meditation techniques for stress reduction',
    category: 'Wellness',
  },
];

const SEQUENTIAL_WORKFLOW_CASES: SequentialCase[] = [
  {
    id: 'seq-launch-nav',
    activeTools: ['browser_launch'],
    query: 'open target URL',
    expectedTool: 'page_navigate',
  },
  {
    id: 'seq-nav-click',
    activeTools: ['page_navigate'],
    query: 'click submit button',
    expectedTool: 'page_click',
  },
  {
    id: 'seq-net-extract',
    activeTools: ['network_monitor', 'network_get_requests'],
    query: 'get auth bearer token',
    expectedTool: 'network_extract_auth',
  },
  {
    id: 'seq-frida-script',
    activeTools: ['frida_attach'],
    query: 'execute hooking script',
    expectedTool: 'frida_run_script',
  },
  {
    id: 'seq-mem-scan',
    activeTools: ['memory_first_scan'],
    query: 'filter matched values',
    expectedTool: 'memory_next_scan',
  },
  {
    id: 'seq-v8-diff',
    activeTools: ['v8_heap_snapshot_capture'],
    query: 'compare memory snapshots',
    expectedTool: 'v8_heap_diff',
  },
  {
    id: 'seq-wasm-decompile',
    activeTools: ['wasm_dump'],
    query: 'reverse wasm binary',
    expectedTool: 'wasm_decompile',
  },
  {
    id: 'seq-proto-infer',
    activeTools: ['proto_auto_detect'],
    query: 'extract protobuf fields',
    expectedTool: 'proto_infer_fields',
  },
];

// ── Policy Configuration Vector ──

interface PolicyVector {
  name: string;
  flags: SearchStrategyFlags;
}

interface EvaluationResult {
  policyName: string;
  flags: SearchStrategyFlags;
  workflowsHit3: number;
  shorthandsHit3: number;
  signatureHit3: number;
  sequentialHit3: number;
  fixtureHit3: number;
  rejectionRate: number; // Anti-hallucination specificity
  diversityRate: number;
  compositeScore: number;
  seqDetails: Array<{ id: string; query: string; expected: string; hits: string[] }>;
}

// ── Metric Calculation Helpers ──

function evaluateHits(
  cases: TestCase[],
  results: Array<{ name: string; score: number }[]>,
  topK: number,
): number {
  let hits = 0;
  for (let i = 0; i < cases.length; i++) {
    const expected = cases[i]!.expectedTools;
    const candidates = results[i]!.slice(0, topK).map((r) => r.name);
    if (candidates.some((c) => expected.includes(c))) {
      hits++;
    }
  }
  return (hits / cases.length) * 100;
}

function evaluateDiversity(results: Array<{ name: string; domain?: string | null }[]>): number {
  let totalUniqueRatio = 0;
  let count = 0;
  for (const list of results) {
    if (list.length === 0) continue;
    const top5 = list.slice(0, 5);
    const domains = new Set(top5.map((t) => t.domain ?? 'core'));
    totalUniqueRatio += domains.size / top5.length;
    count++;
  }
  return count > 0 ? (totalUniqueRatio / count) * 100 : 0;
}

async function runDreamSimulation(
  engine: ToolSearchEngine,
  fixtureEngine: ToolSearchEngine,
  policy: PolicyVector,
  fixtureCases: TestCase[],
): Promise<EvaluationResult> {
  // Configure policy in world simulator
  engine.setStrategyFlags(policy.flags);
  fixtureEngine.setStrategyFlags(policy.flags);

  // 1. Evaluate Agent Workflows
  const workflowResults: Array<{ name: string; score: number }[]> = [];
  for (const tc of AGENT_WORKFLOW_CASES) {
    const res = await engine.search(tc.query, 10);
    workflowResults.push(res);
  }
  const workflowsHit3 = evaluateHits(AGENT_WORKFLOW_CASES, workflowResults, 3);

  // 2. Evaluate Shorthand Queries
  const shorthandResults: Array<{ name: string; score: number }[]> = [];
  for (const tc of SHORTHAND_CASES) {
    const res = await engine.search(tc.query, 10);
    shorthandResults.push(res);
  }
  const shorthandsHit3 = evaluateHits(SHORTHAND_CASES, shorthandResults, 3);

  // 3. Evaluate Signature Queries
  const signatureResults: Array<{ name: string; score: number }[]> = [];
  for (const tc of SIGNATURE_CASES) {
    const res = await engine.search(tc.query, 10);
    signatureResults.push(res);
  }
  const signatureHit3 = evaluateHits(SIGNATURE_CASES, signatureResults, 3);

  // 4. Evaluate Sequential Workflow Chaining
  let seqHits = 0;
  const seqDetails: Array<{ id: string; query: string; expected: string; hits: string[] }> = [];
  for (const sc of SEQUENTIAL_WORKFLOW_CASES) {
    const res = await engine.search(sc.query, 3, new Set(sc.activeTools));
    const matched = res.some((r) => r.name === sc.expectedTool);
    if (matched) {
      seqHits++;
    }
    seqDetails.push({
      id: sc.id,
      query: sc.query,
      expected: sc.expectedTool,
      hits: res.map((r) => r.name),
    });
  }
  const sequentialHit3 = (seqHits / SEQUENTIAL_WORKFLOW_CASES.length) * 100;

  // 5. Evaluate Baseline Fixtures
  const fixtureResults: Array<{ name: string; score: number }[]> = [];
  for (const fc of fixtureCases) {
    const res = await fixtureEngine.search(fc.query, 10);
    fixtureResults.push(res);
  }
  const fixtureHit3 = evaluateHits(fixtureCases, fixtureResults, 3);

  // 6. Evaluate Negative Queries (Rejection / Specificity)
  let rejected = 0;
  for (const nc of NEGATIVE_CASES) {
    const res = await engine.search(nc.query, 10);
    if (res.length === 0) rejected++;
  }
  const rejectionRate = (rejected / NEGATIVE_CASES.length) * 100;

  // 7. Measure Top-5 Domain Diversity
  const diversityRate = evaluateDiversity(workflowResults);

  // Composite Harmonic Objective Score:
  // F-measure between average retrieval recall (across all 5 suites) and anti-hallucination specificity
  const avgRecall =
    workflowsHit3 * 0.25 +
    shorthandsHit3 * 0.25 +
    signatureHit3 * 0.2 +
    sequentialHit3 * 0.15 +
    fixtureHit3 * 0.15;

  // Composite Score = 0.65 * Recall + 0.35 * Specificity (penalizing hallucination leaks)
  const compositeScore = Math.round((avgRecall * 0.65 + rejectionRate * 0.35) * 100) / 100;

  return {
    policyName: policy.name,
    flags: policy.flags,
    workflowsHit3,
    shorthandsHit3,
    signatureHit3,
    sequentialHit3,
    fixtureHit3,
    rejectionRate,
    diversityRate,
    compositeScore,
    seqDetails,
  };
}

async function main(): Promise<void> {
  console.log('='.repeat(80));
  console.log('DreamRSI: Counterfactual Strategy Ablation & Interference Simulator');
  console.log('Theory: Recursive Self-Improvement through Emerging Worlds (DeepMind / UMD / UVA)');
  console.log('='.repeat(80));

  await initRegistry();
  const engine = new ToolSearchEngine(allTools);
  const fixture = buildSearchQualityFixture();
  const fixtureEngine = new ToolSearchEngine(fixture.tools, fixture.domainByToolName);
  const fixtureCases: TestCase[] = fixture.cases.map((c) => ({
    id: c.query,
    query: c.query,
    expectedTools: [c.expectedTool],
    category: 'StandardFixture',
  }));

  console.log(
    `World Simulator Initialized: 713 tools, 185 frozen test cases across 6 dimensions.\n`,
  );

  // ── Define Candidate Policy Configurations for Counterfactual Dreaming ──
  const policies: PolicyVector[] = [
    {
      name: 'P0: Pure Baseline (All OFF)',
      flags: {
        enableSynonyms: false,
        enableTypeSchema: false,
        enableOutOfDomainGating: false,
        enableScoreCalibration: false,
        enableMMR: false,
        enableWorkflowTransitions: false,
      },
    },
    {
      name: 'P1: Only Synonyms (S1)',
      flags: {
        enableSynonyms: true,
        enableTypeSchema: false,
        enableOutOfDomainGating: false,
        enableScoreCalibration: false,
        enableMMR: false,
        enableWorkflowTransitions: false,
      },
    },
    {
      name: 'P2: Only TypeSchema (S2)',
      flags: {
        enableSynonyms: false,
        enableTypeSchema: true,
        enableOutOfDomainGating: false,
        enableScoreCalibration: false,
        enableMMR: false,
        enableWorkflowTransitions: false,
      },
    },
    {
      name: 'P3: Only OutOfDomainGating (S3)',
      flags: {
        enableSynonyms: false,
        enableTypeSchema: false,
        enableOutOfDomainGating: true,
        enableScoreCalibration: false,
        enableMMR: false,
        enableWorkflowTransitions: false,
      },
    },
    {
      name: 'P4: Only ScoreCalibration (S4)',
      flags: {
        enableSynonyms: false,
        enableTypeSchema: false,
        enableOutOfDomainGating: false,
        enableScoreCalibration: true,
        enableMMR: false,
        enableWorkflowTransitions: false,
      },
    },
    {
      name: 'P5: Only MMR (S5)',
      flags: {
        enableSynonyms: false,
        enableTypeSchema: false,
        enableOutOfDomainGating: false,
        enableScoreCalibration: false,
        enableMMR: true,
        enableWorkflowTransitions: false,
      },
    },
    {
      name: 'P6: Only WorkflowTransition (S6)',
      flags: {
        enableSynonyms: false,
        enableTypeSchema: false,
        enableOutOfDomainGating: false,
        enableScoreCalibration: false,
        enableMMR: false,
        enableWorkflowTransitions: true,
      },
    },
    // Pairwise Interactions & Synergies
    {
      name: 'P7: Gating + Calibration (S3+S4 anti-hallucination dual-shield)',
      flags: {
        enableSynonyms: false,
        enableTypeSchema: false,
        enableOutOfDomainGating: true,
        enableScoreCalibration: true,
        enableMMR: false,
        enableWorkflowTransitions: false,
      },
    },
    {
      name: 'P8: Synonyms + Schema (S1+S2 representation)',
      flags: {
        enableSynonyms: true,
        enableTypeSchema: true,
        enableOutOfDomainGating: false,
        enableScoreCalibration: false,
        enableMMR: false,
        enableWorkflowTransitions: false,
      },
    },
    {
      name: 'P9: MMR + WorkflowTransition (S5+S6 recommendation conflict check)',
      flags: {
        enableSynonyms: false,
        enableTypeSchema: false,
        enableOutOfDomainGating: false,
        enableScoreCalibration: false,
        enableMMR: true,
        enableWorkflowTransitions: true,
      },
    },
    // Leave-One-Out Ablation (Testing Over-Optimization & Negative Interference from All-ON)
    {
      name: 'P10: All-ON minus MMR (Drop S5)',
      flags: {
        enableSynonyms: true,
        enableTypeSchema: true,
        enableOutOfDomainGating: true,
        enableScoreCalibration: true,
        enableMMR: false,
        enableWorkflowTransitions: true,
      },
    },
    {
      name: 'P11: All-ON minus Calibration (Drop S4)',
      flags: {
        enableSynonyms: true,
        enableTypeSchema: true,
        enableOutOfDomainGating: true,
        enableScoreCalibration: false,
        enableMMR: true,
        enableWorkflowTransitions: true,
      },
    },
    {
      name: 'P12: All-ON minus Gating (Drop S3)',
      flags: {
        enableSynonyms: true,
        enableTypeSchema: true,
        enableOutOfDomainGating: false,
        enableScoreCalibration: true,
        enableMMR: true,
        enableWorkflowTransitions: true,
      },
    },
    {
      name: 'P13: All-ON minus TypeSchema (Drop S2)',
      flags: {
        enableSynonyms: true,
        enableTypeSchema: false,
        enableOutOfDomainGating: true,
        enableScoreCalibration: true,
        enableMMR: true,
        enableWorkflowTransitions: true,
      },
    },
    {
      name: 'P14: All-ON minus Synonyms (Drop S1)',
      flags: {
        enableSynonyms: false,
        enableTypeSchema: true,
        enableOutOfDomainGating: true,
        enableScoreCalibration: true,
        enableMMR: true,
        enableWorkflowTransitions: true,
      },
    },
    {
      name: 'P15: All-ON minus WorkflowTransition (Drop S6)',
      flags: {
        enableSynonyms: true,
        enableTypeSchema: true,
        enableOutOfDomainGating: true,
        enableScoreCalibration: true,
        enableMMR: true,
        enableWorkflowTransitions: false,
      },
    },
    // The Full Stack
    {
      name: 'P16: Full Stack (All 6 ON)',
      flags: {
        enableSynonyms: true,
        enableTypeSchema: true,
        enableOutOfDomainGating: true,
        enableScoreCalibration: true,
        enableMMR: true,
        enableWorkflowTransitions: true,
      },
    },
  ];

  console.log(
    `Simulating counterfactual dreaming across ${policies.length} strategy configurations...`,
  );
  const results: EvaluationResult[] = [];

  for (const pol of policies) {
    const res = await runDreamSimulation(engine, fixtureEngine, pol, fixtureCases);
    results.push(res);
  }

  // Display Simulation Results Table
  console.log('\n' + '='.repeat(105));
  console.log(
    'DREAM-RSI POLICY SIMULATION MATRIX (Replay over 185 Tasks in Frozen World Simulator)',
  );
  console.log('='.repeat(105));
  console.log(
    'Policy Configuration'.padEnd(38) +
      'Workflows'.padStart(10) +
      'Shorthands'.padStart(11) +
      'Signature'.padStart(10) +
      'WorkflowSeq'.padStart(12) +
      'Rejection'.padStart(11) +
      'Diversity'.padStart(10) +
      'Utility'.padStart(10),
  );
  console.log('-'.repeat(105));

  for (const r of results) {
    console.log(
      r.policyName.padEnd(38) +
        `${r.workflowsHit3.toFixed(1)}%`.padStart(10) +
        `${r.shorthandsHit3.toFixed(1)}%`.padStart(11) +
        `${r.signatureHit3.toFixed(1)}%`.padStart(10) +
        `${r.sequentialHit3.toFixed(1)}%`.padStart(12) +
        `${r.rejectionRate.toFixed(1)}%`.padStart(11) +
        `${r.diversityRate.toFixed(1)}%`.padStart(10) +
        `${r.compositeScore.toFixed(2)}`.padStart(10),
    );
  }
  console.log('='.repeat(105));

  // ── Interference & Over-Optimization Diagnostic ──
  console.log('\n' + '='.repeat(80));
  console.log('STRATEGY INTERFERENCE & OVER-OPTIMIZATION ANALYSIS (DreamRSI Findings)');
  console.log('='.repeat(80));

  const fullStack = results.find((r) => r.policyName.includes('Full Stack'))!;
  const baseline = results.find((r) => r.policyName.includes('Pure Baseline'))!;

  console.log(`Baseline Utility   : ${baseline.compositeScore}`);
  console.log(`Full Stack Utility : ${fullStack.compositeScore}`);

  // Find best configuration overall
  const sortedByScore = results.toSorted((a, b) => b.compositeScore - a.compositeScore);
  const bestPolicy = sortedByScore[0]!;
  console.log(
    `\nGlobal Optimum in Dream Simulator: "${bestPolicy.policyName}" (Utility: ${bestPolicy.compositeScore})`,
  );

  // Detect negative interference
  console.log('\nLeave-One-Out Sensitivity Analysis (Negative Interference Check):');
  const leaveOneOuts = results.filter((r) => r.policyName.includes('minus'));
  for (const loo of leaveOneOuts) {
    const diff = loo.compositeScore - fullStack.compositeScore;
    const isInterfering = diff > 0;
    const status = isInterfering
      ? `⚠️ OVER-OPTIMIZATION DETECTED (+${diff.toFixed(2)} when removed!)`
      : `✅ Positive Synergy (${diff.toFixed(2)} when removed)`;
    console.log(
      `  - Dropping ${loo.policyName.split('minus ')[1]!.padEnd(25)}: Utility ${loo.compositeScore.toFixed(2)} [${status}]`,
    );
  }

  // Detect specific pair conflict: MMR vs Workflow
  const pMmrOnly = results.find((r) => r.policyName.includes('Only MMR'))!;
  const pWfOnly = results.find((r) => r.policyName.includes('Only WorkflowTransition'))!;
  const pMmrWf = results.find((r) => r.policyName.includes('MMR + WorkflowTransition'))!;
  console.log(
    '\nSpecific Dyadic Conflict Check: MMR (Diversity) vs. Workflow Transition (Chaining):',
  );
  console.log(`  - Only MMR Sequential Chaining Hit@3: ${pMmrOnly.sequentialHit3.toFixed(1)}%`);
  console.log(`  - Only Workflow Sequential Chaining Hit@3: ${pWfOnly.sequentialHit3.toFixed(1)}%`);
  console.log(`  - MMR + Workflow Sequential Chaining Hit@3: ${pMmrWf.sequentialHit3.toFixed(1)}%`);

  // Microscopic Case Interference: P16 vs P12 (Gating suppresses sequential queries)
  const p12 = results.find((r) => r.policyName.includes('minus Gating'))!;
  console.log('\nMicroscopic Conflict Trace: Gating vs Sequential Queries (P16 vs P12):');
  for (let i = 0; i < SEQUENTIAL_WORKFLOW_CASES.length; i++) {
    const caseItem = SEQUENTIAL_WORKFLOW_CASES[i]!;
    const p16Hit = fullStack.seqDetails[i]!.hits.includes(caseItem.expectedTool);
    const p12Hit = p12.seqDetails[i]!.hits.includes(caseItem.expectedTool);
    if (p16Hit !== p12Hit) {
      console.log(
        `  - Case [${caseItem.id}] "${caseItem.query}" (expected: ${caseItem.expectedTool}):`,
      );
      console.log(
        `    * Full Stack (with Gating): [${fullStack.seqDetails[i]!.hits.join(', ')}] -> ${p16Hit ? 'HIT' : 'MISSED/SUPPRESSED'}`,
      );
      console.log(
        `    * P12 (without Gating)    : [${p12.seqDetails[i]!.hits.join(', ')}] -> ${p12Hit ? 'HIT' : 'MISSED/SUPPRESSED'}`,
      );
    }
  }

  console.log('\n' + '='.repeat(80));
}

void main();
