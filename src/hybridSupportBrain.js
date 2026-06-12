import { handleCustomerMessage } from './customerAdapter.js';
import { isSafeLlmDecision, runLlmFallback } from './llmFallback.js';
import {
  appendAnalyticsEvent,
  appendLearningEvent,
  buildAnalyticsEvent,
  shouldLogForLearning,
} from './learningLogger.js';
import { retrieveSupportFacts } from './supportFacts.js';

export async function handleHybridCustomerMessage({
  message,
  session = {},
  customer = {},
  orders = [],
  products = [],
  llm = {},
  analytics = {},
  learning = {},
  source = 'unknown',
} = {}) {
  const deterministicResult = handleCustomerMessage({
    message,
    session,
    customer,
    orders,
    products,
  });
  const facts = retrieveSupportFacts(message, deterministicResult);
  const llmFallback = await maybeRunLlmFallback({
    message,
    deterministicResult,
    facts,
    llm,
  });
  const finalResult = chooseFinalResult({
    deterministicResult,
    llmFallback,
    facts,
    llm,
  });
  const analyticsEvent = buildAnalyticsEvent({
    message,
    deterministicResult,
    finalResult,
    llmFallback,
    facts,
    source,
  });
  const analyticsLog = await maybeWriteAnalyticsEvent({
    analyticsEvent,
    analytics,
  });
  const learningLog = await maybeWriteLearningEvent({
    analyticsEvent,
    deterministicResult,
    finalResult,
    learning,
  });

  return {
    ...finalResult,
    deterministicResult,
    llmFallback,
    supportFacts: facts,
    analyticsEvent,
    analyticsLog,
    learningLog,
  };
}

export function shouldUseLlmFallback(result = {}, {
  enabled = true,
  lowConfidenceThreshold = 0.74,
} = {}) {
  if (!enabled) return false;
  if (result.intent === 'other') return true;
  if (Number(result.confidence || 0) < lowConfidenceThreshold) return true;
  if (result.action === 'ask_clarifying_question' && result.contextRequest?.type === 'general') return true;
  return false;
}

async function maybeRunLlmFallback({
  message,
  deterministicResult,
  facts,
  llm,
}) {
  const enabled = llm.enabled !== false;
  const shouldRun = shouldUseLlmFallback(deterministicResult, {
    enabled,
    lowConfidenceThreshold: llm.lowConfidenceThreshold ?? 0.74,
  });

  if (!shouldRun) {
    return {
      status: 'not_requested',
      model: llm.model || 'mock-support-brain-v1',
      reason: 'deterministic_result_confident',
    };
  }

  return runLlmFallback({
    message,
    deterministicResult,
    facts,
    client: llm.client,
    model: llm.model || 'mock-support-brain-v1',
  });
}

function chooseFinalResult({
  deterministicResult,
  llmFallback,
  facts,
  llm,
}) {
  const shadow = llm.shadow !== false;
  const decision = llmFallback?.decision || null;

  if (shadow || llmFallback?.status !== 'ok' || !isSafeLlmDecision(decision, facts, {
    minConfidence: llm.minSafeConfidence ?? 0.74,
  })) {
    return {
      ...deterministicResult,
      hybridMode: shadow ? 'shadow' : 'deterministic',
    };
  }

  const finalResult = {
    ...deterministicResult,
    intent: decision.intent,
    action: decision.action,
    confidence: decision.confidence,
    answer: decision.answer,
    needsHandoff: decision.needsHandoff,
    handoffReason: decision.handoffReason || 'none',
    suggestedReplies: deterministicResult.suggestedReplies || [],
    hybridMode: 'llm_fallback',
  };

  return {
    ...finalResult,
    nextSession: syncNextSession(deterministicResult.nextSession, finalResult),
  };
}

async function maybeWriteLearningEvent({
  analyticsEvent,
  deterministicResult,
  finalResult,
  learning,
}) {
  if (!learning.enabled) {
    return {
      status: 'disabled',
    };
  }

  const shouldWrite = learning.logAll === true
    || analyticsEvent.needsReview === true
    || shouldLogForLearning(deterministicResult, {
      lowConfidenceThreshold: learning.lowConfidenceThreshold ?? 0.74,
    })
    || shouldLogForLearning(finalResult, {
      lowConfidenceThreshold: learning.lowConfidenceThreshold ?? 0.74,
    });

  if (!shouldWrite) {
    return {
      status: 'skipped',
      reason: 'not_learning_candidate',
    };
  }

  return appendLearningEvent(analyticsEvent, {
    dir: learning.dir || 'learning/inbox',
    date: learning.date,
  });
}

async function maybeWriteAnalyticsEvent({
  analyticsEvent,
  analytics,
}) {
  if (!analytics.enabled) {
    return {
      status: 'disabled',
    };
  }

  return appendAnalyticsEvent(analyticsEvent, {
    dir: analytics.dir || 'learning/events',
    date: analytics.date,
  });
}

function syncNextSession(nextSession = {}, result = {}) {
  const synced = {
    ...nextSession,
    lastIntent: result.intent,
    lastAction: result.action,
    lastAnswer: result.answer,
  };

  if (result.needsHandoff) {
    synced.activeHandoff = {
      intent: result.intent,
      reason: result.handoffReason,
      subject: result.ticketSubject || 'Вопрос оператору',
    };
  }

  return synced;
}
