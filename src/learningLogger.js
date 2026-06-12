import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export function buildAnalyticsEvent({
  message,
  deterministicResult,
  finalResult,
  llmFallback = null,
  facts = [],
  source = 'unknown',
  timestamp = new Date().toISOString(),
} = {}) {
  const result = finalResult || deterministicResult || {};
  const deterministic = deterministicResult || {};

  return {
    timestamp,
    source,
    redactedMessage: redactLearningText(message),
    deterministic: summarizeResult(deterministic),
    final: summarizeResult(result),
    llmFallback: summarizeLlmFallback(llmFallback),
    usedFactIds: facts.map((fact) => fact.id).filter(Boolean),
    needsReview: shouldLogForLearning(deterministic) || shouldLogForLearning(result),
    outcome: classifyOutcome(result),
  };
}

export function shouldLogForLearning(result = {}, { lowConfidenceThreshold = 0.74 } = {}) {
  return result.intent === 'other'
    || Number(result.confidence || 0) < lowConfidenceThreshold
    || (result.action === 'ask_clarifying_question' && result.contextRequest?.type === 'general')
    || result.handoffReason === 'angry_customer'
    || result.handoffReason === 'llm_handoff';
}

export async function appendLearningEvent(event, {
  dir = 'learning/inbox',
  date = eventDate(event?.timestamp),
} = {}) {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${date}.jsonl`);
  await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  return { status: 'written', filePath };
}

export function redactLearningText(value = '') {
  return String(value)
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[url]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/RS-\d{8}-[A-Z0-9]{5,32}/gi, '[order]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[phone]')
    .replace(/\b\d{1,8}[_\s-]?[A-ZА-Я]{1,3}\b/gi, '[order]')
    .replace(/\b\d{4,}\b/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeResult(result = {}) {
  return {
    intent: result.intent || 'unknown',
    action: result.action || 'unknown',
    confidence: Number(result.confidence || 0),
    needsHandoff: Boolean(result.needsHandoff),
    handoffReason: result.handoffReason || 'none',
    systemLookup: result.systemLookup || null,
    contextRequest: result.contextRequest
      ? {
        type: result.contextRequest.type || null,
        strategy: result.contextRequest.strategy || null,
      }
      : null,
  };
}

function summarizeLlmFallback(llmFallback) {
  if (!llmFallback) return null;

  return {
    status: llmFallback.status || 'unknown',
    model: llmFallback.model || null,
    reason: llmFallback.reason || llmFallback.decision?.reason || null,
    decision: llmFallback.decision
      ? {
        intent: llmFallback.decision.intent,
        action: llmFallback.decision.action,
        confidence: llmFallback.decision.confidence,
        needsHandoff: llmFallback.decision.needsHandoff,
        handoffReason: llmFallback.decision.handoffReason || null,
        usedFacts: llmFallback.decision.usedFacts || [],
      }
      : null,
  };
}

function classifyOutcome(result = {}) {
  if (result.action === 'handoff_to_operator' || result.needsHandoff) return 'handoff';
  if (result.action === 'answer') return 'answered';
  if (result.action === 'ask_clarifying_question') return 'needs_clarification';
  return 'unknown';
}

function eventDate(timestamp) {
  const date = new Date(timestamp || Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}
