import { Annotation, StateGraph, START, END } from '@langchain/langgraph';

import type { ImageInput, ExtractionResult, VisionProvider } from './types.js';
import { checkBeforeCall } from './guardrail.js';
import { validateExtractionResult, OutputValidationError } from './outputValidator.js';
import { normalise } from './signalExtractor.js';

// ── State ─────────────────────────────────────────────────────────────────────

const ExtractionStateAnnotation = Annotation.Root({
  images:        Annotation<ImageInput[]>({ default: () => [] }),
  callerKey:     Annotation<string | undefined>({ default: () => undefined }),
  systemPrompt:  Annotation<string>({ default: () => '' }),
  result:        Annotation<ExtractionResult | undefined>({ default: () => undefined }),
  error:         Annotation<Error | undefined>({ default: () => undefined }),
  blocked:       Annotation<boolean>({ default: () => false }),
  blockedReason: Annotation<string | undefined>({ default: () => undefined }),
  t0:            Annotation<number>({ default: () => Date.now() }),
});

export type ExtractionState = typeof ExtractionStateAnnotation.State;

// ── Nodes (exported for isolated unit testing) ───────────────────────────────

export async function guardrailNode(
  state: ExtractionState,
): Promise<Partial<ExtractionState>> {
  const totalBytes = state.images.reduce((acc, i) => acc + i.bytes.length, 0);
  const decision = checkBeforeCall({
    imageCount: state.images.length,
    totalBytes,
    callerKey: state.callerKey,
  });
  if (!decision.allowed) {
    return { blocked: true, blockedReason: decision.reason ?? 'guardrail veto' };
  }
  return { blocked: false };
}

export function createLlmCallNode(provider: VisionProvider) {
  return async function llmCallNode(
    state: ExtractionState,
  ): Promise<Partial<ExtractionState>> {
    try {
      const result = await provider.extractSignal(state.images, state.systemPrompt);
      return { result };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error(String(err)) };
    }
  };
}

export async function validateNode(
  state: ExtractionState,
): Promise<Partial<ExtractionState>> {
  if (!state.result) return {};
  try {
    validateExtractionResult(state.result);
    return {};
  } catch (err) {
    if (err instanceof OutputValidationError) {
      return { error: err };
    }
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export async function normaliseNode(
  state: ExtractionState,
): Promise<Partial<ExtractionState>> {
  if (!state.result) return {};
  return { result: normalise(state.result) };
}

// ── Routing helpers ───────────────────────────────────────────────────────────

function routeAfterGuardrail(state: ExtractionState): typeof END | 'llm-call' {
  return state.blocked ? END : 'llm-call';
}

function routeAfterLlmCall(state: ExtractionState): typeof END | 'validate' {
  return state.error ? END : 'validate';
}

function routeAfterValidate(state: ExtractionState): typeof END | 'normalise' {
  return state.error ? END : 'normalise';
}

// ── Graph builder ─────────────────────────────────────────────────────────────

/**
 * Build and compile the extraction state graph for a given provider.
 * Compile once at SignalExtractor construction time and reuse across calls.
 *
 * Flow: guardrail → llm-call → validate → normalise
 * Short-circuits to END on blocked or error so SignalExtractor.extract()
 * can inspect final state and throw the appropriate typed error.
 */
export function buildExtractionGraph(provider: VisionProvider) {
  return new StateGraph(ExtractionStateAnnotation)
    .addNode('guardrail', guardrailNode)
    .addNode('llm-call',  createLlmCallNode(provider))
    .addNode('validate',  validateNode)
    .addNode('normalise', normaliseNode)
    .addEdge(START, 'guardrail')
    .addConditionalEdges('guardrail', routeAfterGuardrail)
    .addConditionalEdges('llm-call',  routeAfterLlmCall)
    .addConditionalEdges('validate',  routeAfterValidate)
    .addEdge('normalise', END)
    .compile();
}
