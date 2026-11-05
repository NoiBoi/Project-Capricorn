import type { WatchCondition } from './attention';
import type { Observation } from './contracts';
import type { CapabilityReceipt } from '../../core/capabilities';
export type RecordInput = { id: string; at: number; inference?: { model: string; requestId?: string; usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } } } & (
  | { kind: 'user' | 'assistant'; text: string; viaVoice?: boolean }
  | { kind: 'observation'; observationId: string; observation?: Observation; conditions?: readonly WatchCondition[]; evidenceContext?: 'current' | 'historical' }
  | { kind: 'tool-call'; requestId: string; name: string; arguments: string }
  | { kind: 'tool-result'; requestId: string; receipt: CapabilityReceipt; result?: unknown }
);
export type ConversationRecord = RecordInput & { sequence: number };
export interface ConversationPage { id: string; records: ConversationRecord[] }
export interface Model { id: string; label: string; contextTokens?: number; supportsImages?: boolean }
export interface ModelCall { id: string; name: string; arguments: string }
export interface ProviderResult { text: string; calls: ModelCall[]; outputOrder?: ({ type: 'text'; text: string } | { type: 'call'; callId: string })[]; usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }; requestId?: string }
export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
export interface ModelInput { identity: string; workingState?: unknown; records: ConversationRecord[]; tools: ToolSchema[]; images?: { observationId: string; dataUrl: string; capturedAt?: number }[] }
export interface CognitiveProvider {
  models(signal: AbortSignal): Promise<Model[]>;
  infer(model: Model, input: ModelInput, signal: AbortSignal, delta: (text: string) => void): Promise<ProviderResult>;
  shutdown(): void;
}
