import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildLearningReport,
  formatLearningReport,
  parseLearningJsonl,
  readLearningInbox,
} from '../src/index.js';

describe('learning inbox report', () => {
  it('parses jsonl events and keeps invalid lines as report evidence', () => {
    const parsed = parseLearningJsonl([
      JSON.stringify(learningEvent({
        redactedMessage: 'непонятный вопрос',
        deterministicIntent: 'other',
        finalIntent: 'other',
      })),
      'not-json',
      '',
    ].join('\n'), { file: 'test.jsonl' });

    assert.equal(parsed.events.length, 1);
    assert.equal(parsed.invalidLines.length, 1);
    assert.equal(parsed.invalidLines[0].file, 'test.jsonl');
    assert.equal(parsed.invalidLines[0].line, 2);
  });

  it('builds a backlog from other, handoff and low-confidence candidates', () => {
    const report = buildLearningReport([
      learningEvent({
        redactedMessage: 'непонятный вопрос',
        deterministicIntent: 'other',
        finalIntent: 'other',
        confidence: 0.52,
      }),
      learningEvent({
        redactedMessage: 'непонятный вопрос',
        deterministicIntent: 'other',
        finalIntent: 'other',
        confidence: 0.52,
      }),
      learningEvent({
        redactedMessage: 'хочу поменять адрес',
        deterministicIntent: 'order_change',
        finalIntent: 'order_change',
        finalAction: 'handoff_to_operator',
        outcome: 'handoff',
        handoffReason: 'order_change',
        confidence: 0.88,
      }),
      learningEvent({
        redactedMessage: 'можно подробнее',
        deterministicIntent: 'product_advice',
        finalIntent: 'product_advice',
        confidence: 0.61,
      }),
    ], {
      generatedAt: '2026-06-12T00:00:00.000Z',
    });

    assert.equal(report.totals.events, 4);
    assert.equal(report.totals.reviewCandidates, 4);
    assert.equal(report.totals.handoff, 1);
    assert.equal(report.byDeterministicIntent[0].key, 'other');
    assert.equal(report.byDeterministicIntent[0].count, 2);
    assert.equal(report.topMessages[0].redactedMessage, 'непонятный вопрос');
    assert.equal(report.topMessages[0].count, 2);
    assert.equal(report.ruleBacklog[0].reason, 'other');
    assert.match(formatLearningReport(report), /Rule backlog/);
  });

  it('surfaces LLM transitions as deterministic rule candidates', () => {
    const report = buildLearningReport([
      learningEvent({
        redactedMessage: 'как отправка идет',
        deterministicIntent: 'other',
        finalIntent: 'other',
        llmDecision: {
          intent: 'delivery_terms',
          action: 'answer',
          confidence: 0.84,
          needsHandoff: false,
          handoffReason: null,
          usedFacts: ['delivery_policy'],
        },
      }),
    ]);

    assert.equal(report.llmTransitions.length, 1);
    assert.deepEqual(report.llmTransitions[0].from, {
      intent: 'other',
      action: 'ask_clarifying_question',
    });
    assert.deepEqual(report.llmTransitions[0].to, {
      intent: 'delivery_terms',
      action: 'answer',
    });
    assert.equal(report.llmTransitions[0].examples[0], 'как отправка идет');
  });

  it('reads multiple inbox files and ignores missing inbox directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reship-learning-report-'));

    try {
      await writeFile(join(dir, '2026-06-12.jsonl'), `${JSON.stringify(learningEvent({
        redactedMessage: 'первый вопрос',
        deterministicIntent: 'other',
        finalIntent: 'other',
      }))}\n`, 'utf8');
      await writeFile(join(dir, '2026-06-13.ndjson'), `${JSON.stringify(learningEvent({
        redactedMessage: 'второй вопрос',
        deterministicIntent: 'payment',
        finalIntent: 'payment',
      }))}\n`, 'utf8');
      await writeFile(join(dir, 'notes.txt'), 'ignore me', 'utf8');

      const inbox = await readLearningInbox({ dir });
      assert.equal(inbox.events.length, 2);
      assert.equal(inbox.invalidLines.length, 0);

      const missing = await readLearningInbox({ dir: join(dir, 'missing') });
      assert.deepEqual(missing, {
        events: [],
        invalidLines: [],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function learningEvent({
  redactedMessage,
  deterministicIntent,
  finalIntent,
  confidence = 0.7,
  finalAction = 'ask_clarifying_question',
  outcome = 'needs_clarification',
  handoffReason = 'none',
  llmDecision = null,
} = {}) {
  return {
    timestamp: '2026-06-12T00:00:00.000Z',
    source: 'test',
    redactedMessage,
    deterministic: {
      intent: deterministicIntent,
      action: 'ask_clarifying_question',
      confidence,
      needsHandoff: false,
      handoffReason: 'none',
      systemLookup: null,
      contextRequest: null,
    },
    final: {
      intent: finalIntent,
      action: finalAction,
      confidence,
      needsHandoff: finalAction === 'handoff_to_operator',
      handoffReason,
      systemLookup: null,
      contextRequest: null,
    },
    llmFallback: llmDecision
      ? {
        status: 'ok',
        model: 'mock-support-brain-v1',
        reason: 'test',
        decision: llmDecision,
      }
      : {
        status: 'not_requested',
        model: 'mock-support-brain-v1',
        reason: 'deterministic_result_confident',
        decision: null,
      },
    usedFactIds: ['support_scope'],
    needsReview: deterministicIntent === 'other' || confidence < 0.74,
    outcome,
  };
}
