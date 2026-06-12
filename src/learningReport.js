import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.74;

export async function readLearningInbox({
  dir = 'learning/inbox',
} = {}) {
  let files;
  try {
    files = await readdir(dir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        events: [],
        invalidLines: [],
      };
    }

    throw error;
  }

  const jsonlFiles = files
    .filter((file) => /\.(jsonl|ndjson)$/i.test(file))
    .sort();
  const events = [];
  const invalidLines = [];

  for (const file of jsonlFiles) {
    const filePath = join(dir, file);
    const raw = await readFile(filePath, 'utf8');
    const parsed = parseLearningJsonl(raw, { file });
    events.push(...parsed.events);
    invalidLines.push(...parsed.invalidLines);
  }

  return {
    events,
    invalidLines,
  };
}

export function parseLearningJsonl(raw, { file = 'inline' } = {}) {
  const events = [];
  const invalidLines = [];
  const lines = String(raw || '').split(/\r?\n/);

  lines.forEach((line, index) => {
    const value = line.trim();
    if (!value) return;

    try {
      const event = JSON.parse(value);
      if (event && typeof event === 'object') {
        events.push(event);
        return;
      }

      invalidLines.push({ file, line: index + 1, reason: 'not_object' });
    } catch (error) {
      invalidLines.push({
        file,
        line: index + 1,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return {
    events,
    invalidLines,
  };
}

export function buildLearningReport(events = [], {
  invalidLines = [],
  topLimit = 12,
  lowConfidenceThreshold = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  generatedAt = new Date().toISOString(),
} = {}) {
  const safeEvents = Array.isArray(events) ? events.filter((event) => event && typeof event === 'object') : [];
  const reviewEvents = safeEvents.filter((event) => isReviewCandidate(event, { lowConfidenceThreshold }));
  const topMessages = summarizeTopMessages(reviewEvents, { topLimit, lowConfidenceThreshold });

  return {
    generatedAt,
    totals: {
      events: safeEvents.length,
      invalidLines: invalidLines.length,
      reviewCandidates: reviewEvents.length,
      answered: safeEvents.filter((event) => event.outcome === 'answered').length,
      needsClarification: safeEvents.filter((event) => event.outcome === 'needs_clarification').length,
      handoff: safeEvents.filter((event) => event.outcome === 'handoff').length,
      llmRequested: safeEvents.filter((event) => event.llmFallback?.status && event.llmFallback.status !== 'not_requested').length,
      llmOk: safeEvents.filter((event) => event.llmFallback?.status === 'ok').length,
      llmErrors: safeEvents.filter((event) => event.llmFallback?.status === 'error').length,
    },
    byDeterministicIntent: countBy(safeEvents, (event) => event.deterministic?.intent || 'unknown'),
    byFinalIntent: countBy(safeEvents, (event) => event.final?.intent || 'unknown'),
    byOutcome: countBy(safeEvents, (event) => event.outcome || 'unknown'),
    topMessages,
    llmTransitions: summarizeLlmTransitions(safeEvents, { topLimit }),
    ruleBacklog: buildRuleBacklog(reviewEvents, { topLimit, lowConfidenceThreshold }),
  };
}

export function formatLearningReport(report = {}) {
  const totals = report.totals || {};
  const lines = [
    '# Learning inbox report',
    '',
    `events: ${totals.events || 0}`,
    `reviewCandidates: ${totals.reviewCandidates || 0}`,
    `invalidLines: ${totals.invalidLines || 0}`,
    `answered: ${totals.answered || 0}`,
    `needsClarification: ${totals.needsClarification || 0}`,
    `handoff: ${totals.handoff || 0}`,
    `llmRequested: ${totals.llmRequested || 0}`,
    '',
    '## Rule backlog',
  ];

  if (!report.ruleBacklog?.length) {
    lines.push('- no candidates yet');
  } else {
    for (const item of report.ruleBacklog) {
      lines.push(`- ${item.reason}: ${item.count} events -> ${item.suggestedNextStep}`);
      for (const example of item.examples.slice(0, 3)) {
        lines.push(`  example: ${example}`);
      }
    }
  }

  lines.push('', '## LLM transitions');
  if (!report.llmTransitions?.length) {
    lines.push('- no transitions yet');
  } else {
    for (const item of report.llmTransitions) {
      lines.push(`- ${item.from.intent}/${item.from.action} -> ${item.to.intent}/${item.to.action}: ${item.count}`);
      for (const example of item.examples.slice(0, 3)) {
        lines.push(`  example: ${example}`);
      }
    }
  }

  lines.push('', '## Top review messages');
  if (!report.topMessages?.length) {
    lines.push('- no messages yet');
  } else {
    for (const item of report.topMessages) {
      lines.push(`- x${item.count} [${item.reason}] ${item.redactedMessage}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function isReviewCandidate(event, { lowConfidenceThreshold }) {
  const deterministic = event.deterministic || {};
  const final = event.final || {};

  return Boolean(event.needsReview)
    || deterministic.intent === 'other'
    || final.intent === 'other'
    || Number(deterministic.confidence || 0) < lowConfidenceThreshold
    || Number(final.confidence || 0) < lowConfidenceThreshold
    || event.outcome === 'handoff'
    || final.handoffReason === 'llm_handoff'
    || hasLlmTransition(event);
}

function summarizeTopMessages(events, { topLimit, lowConfidenceThreshold }) {
  const buckets = new Map();

  for (const event of events) {
    const redactedMessage = normalizeRedactedMessage(event.redactedMessage);
    if (!redactedMessage) continue;

    const key = [
      redactedMessage,
      event.deterministic?.intent || 'unknown',
      event.final?.intent || 'unknown',
      event.final?.action || 'unknown',
    ].join('|');
    const bucket = buckets.get(key) || {
      redactedMessage,
      count: 0,
      deterministicIntent: event.deterministic?.intent || 'unknown',
      finalIntent: event.final?.intent || 'unknown',
      finalAction: event.final?.action || 'unknown',
      outcome: event.outcome || 'unknown',
      reason: reviewReason(event, { lowConfidenceThreshold }),
      usedFactIds: new Set(),
    };

    bucket.count += 1;
    for (const factId of event.usedFactIds || []) {
      bucket.usedFactIds.add(factId);
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort(compareCountThenMessage)
    .slice(0, topLimit)
    .map((bucket) => ({
      ...bucket,
      usedFactIds: [...bucket.usedFactIds],
    }));
}

function summarizeLlmTransitions(events, { topLimit }) {
  const buckets = new Map();

  for (const event of events) {
    const decision = event.llmFallback?.decision;
    if (event.llmFallback?.status !== 'ok' || !decision) continue;

    const from = {
      intent: event.deterministic?.intent || 'unknown',
      action: event.deterministic?.action || 'unknown',
    };
    const to = {
      intent: decision.intent || 'unknown',
      action: decision.action || 'unknown',
    };
    if (from.intent === to.intent && from.action === to.action) continue;

    const key = `${from.intent}/${from.action}->${to.intent}/${to.action}`;
    const bucket = buckets.get(key) || {
      from,
      to,
      count: 0,
      examples: [],
    };

    bucket.count += 1;
    pushUniqueExample(bucket.examples, normalizeRedactedMessage(event.redactedMessage));
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, topLimit);
}

function buildRuleBacklog(events, { topLimit, lowConfidenceThreshold }) {
  const buckets = new Map();

  for (const event of events) {
    const reason = reviewReason(event, { lowConfidenceThreshold });
    const key = [
      reason,
      event.deterministic?.intent || 'unknown',
      event.final?.intent || 'unknown',
      event.final?.action || 'unknown',
      event.final?.handoffReason || 'none',
    ].join('|');
    const bucket = buckets.get(key) || {
      reason,
      count: 0,
      deterministicIntent: event.deterministic?.intent || 'unknown',
      finalIntent: event.final?.intent || 'unknown',
      finalAction: event.final?.action || 'unknown',
      handoffReason: event.final?.handoffReason || 'none',
      examples: [],
      suggestedNextStep: suggestedNextStep(reason, event),
    };

    bucket.count += 1;
    pushUniqueExample(bucket.examples, normalizeRedactedMessage(event.redactedMessage));
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, topLimit);
}

function countBy(events, keyFn) {
  const counts = new Map();
  for (const event of events) {
    const key = keyFn(event);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function reviewReason(event, { lowConfidenceThreshold }) {
  const deterministic = event.deterministic || {};
  const final = event.final || {};

  if (final.handoffReason === 'llm_handoff') return 'llm_handoff';
  if (hasLlmTransition(event)) return 'llm_transition';
  if (deterministic.intent === 'other' || final.intent === 'other') return 'other';
  if (event.outcome === 'handoff') return `handoff:${final.handoffReason || 'none'}`;
  if (Number(deterministic.confidence || 0) < lowConfidenceThreshold) return 'low_deterministic_confidence';
  if (Number(final.confidence || 0) < lowConfidenceThreshold) return 'low_final_confidence';
  if (deterministic.contextRequest?.type === 'general') return 'general_clarification';
  return 'review';
}

function suggestedNextStep(reason, event) {
  if (reason === 'other') {
    return 'review examples, then add a deterministic intent rule plus synthetic fixture if the pattern repeats';
  }

  if (reason.startsWith('handoff:')) {
    return 'check whether this handoff is correct; if operators answer with the same template, promote it into a safe scenario';
  }

  if (reason === 'llm_handoff') {
    return 'inspect why LLM requested handoff and decide whether deterministic layer should route it directly';
  }

  if (reason === 'llm_transition') {
    return 'review safe LLM transition and promote repeated pattern into a deterministic rule with fixtures';
  }

  if (reason.includes('confidence')) {
    return `strengthen the existing ${event.final?.intent || event.deterministic?.intent || 'intent'} rule or add clarifying fixture`;
  }

  return 'inspect examples and decide whether this is a new fixture, a support fact, or an operator-only case';
}

function hasLlmTransition(event = {}) {
  const decision = event.llmFallback?.decision;
  if (event.llmFallback?.status !== 'ok' || !decision) return false;

  return (decision.intent || 'unknown') !== (event.deterministic?.intent || 'unknown')
    || (decision.action || 'unknown') !== (event.deterministic?.action || 'unknown')
    || Boolean(decision.needsHandoff) !== Boolean(event.deterministic?.needsHandoff);
}

function normalizeRedactedMessage(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function pushUniqueExample(examples, value) {
  if (!value || examples.includes(value)) return;
  if (examples.length >= 5) return;
  examples.push(value);
}

function compareCountThenMessage(left, right) {
  return right.count - left.count || left.redactedMessage.localeCompare(right.redactedMessage);
}
