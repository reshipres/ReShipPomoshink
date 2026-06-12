import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  handleHybridCustomerMessage,
  shouldUseLlmFallback,
} from '../src/index.js';

describe('hybrid support brain', () => {
  it('does not call LLM for confident deterministic answers', async () => {
    let called = false;
    const result = await handleHybridCustomerMessage({
      message: 'доставка',
      llm: {
        client: async () => {
          called = true;
          throw new Error('LLM should not be called');
        },
      },
    });

    assert.equal(result.intent, 'delivery_terms');
    assert.equal(result.action, 'answer');
    assert.equal(result.hybridMode, 'shadow');
    assert.equal(result.llmFallback.status, 'not_requested');
    assert.equal(called, false);
  });

  it('calls mock LLM for other intent in shadow mode without changing customer answer', async () => {
    const result = await handleHybridCustomerMessage({
      message: 'а вот это вообще как работает',
      llm: {
        client: async () => ({
          intent: 'other',
          action: 'ask_clarifying_question',
          answer: 'LLM просит уточнить вопрос.',
          needsHandoff: false,
          handoffReason: null,
          usedFacts: ['support_scope', 'no_invention_policy'],
          confidence: 0.82,
          reason: 'mocked uncertain question',
        }),
      },
    });

    assert.equal(result.deterministicResult.intent, 'other');
    assert.equal(result.llmFallback.status, 'ok');
    assert.equal(result.llmFallback.decision.answer, 'LLM просит уточнить вопрос.');
    assert.notEqual(result.answer, 'LLM просит уточнить вопрос.');
    assert.equal(result.hybridMode, 'shadow');
    assert.equal(result.analyticsEvent.needsReview, true);
  });

  it('can use a safe LLM decision outside shadow mode', async () => {
    const result = await handleHybridCustomerMessage({
      message: 'а вот это вообще как работает',
      llm: {
        shadow: false,
        client: async () => ({
          intent: 'other',
          action: 'ask_clarifying_question',
          answer: 'Уточните, пожалуйста: вопрос про товар, доставку, оплату или уже оформленный заказ?',
          needsHandoff: false,
          handoffReason: null,
          usedFacts: ['support_scope', 'no_invention_policy'],
          confidence: 0.84,
          reason: 'safe clarifying fallback',
        }),
      },
    });

    assert.equal(result.hybridMode, 'llm_fallback');
    assert.equal(result.answer, 'Уточните, пожалуйста: вопрос про товар, доставку, оплату или уже оформленный заказ?');
    assert.equal(result.nextSession.lastAnswer, result.answer);
  });

  it('rejects unsafe LLM decisions without used facts', async () => {
    const result = await handleHybridCustomerMessage({
      message: 'а вот это вообще как работает',
      llm: {
        shadow: false,
        client: async () => ({
          intent: 'other',
          action: 'answer',
          answer: 'Точно гарантирую скидку 100%.',
          needsHandoff: false,
          handoffReason: null,
          usedFacts: [],
          confidence: 0.99,
          reason: 'unsafe',
        }),
      },
    });

    assert.notEqual(result.answer, 'Точно гарантирую скидку 100%.');
    assert.equal(result.hybridMode, 'deterministic');
  });

  it('writes redacted learning events when enabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reship-learning-'));

    try {
      const result = await handleHybridCustomerMessage({
        message: 'мой телефон +7 999 123 45 67, email test@example.com, заказ RS-20250603-EF789',
        source: 'test',
        learning: {
          enabled: true,
          logAll: true,
          dir,
          date: '2026-06-12',
        },
      });
      const raw = await readFile(join(dir, '2026-06-12.jsonl'), 'utf8');
      const event = JSON.parse(raw.trim());

      assert.equal(result.learningLog.status, 'written');
      assert.equal(event.source, 'test');
      assert.match(event.redactedMessage, /\[phone\]/);
      assert.match(event.redactedMessage, /\[email\]/);
      assert.match(event.redactedMessage, /\[order\]/);
      assert.doesNotMatch(raw, /\+7 999 123 45 67/);
      assert.doesNotMatch(raw, /test@example\.com/);
      assert.doesNotMatch(raw, /RS-20250603-EF789/);
      assert.equal(typeof event.final.intent, 'string');
      assert.equal(typeof event.final.confidence, 'number');
      assert.equal(typeof event.final.needsHandoff, 'boolean');
      assert.equal(typeof event.outcome, 'string');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes all hybrid dialog analytics separately from learning candidates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reship-analytics-'));

    try {
      const result = await handleHybridCustomerMessage({
        message: 'доставка в москву',
        source: 'test',
        analytics: {
          enabled: true,
          dir,
          date: '2026-06-12',
        },
      });
      const raw = await readFile(join(dir, '2026-06-12.jsonl'), 'utf8');
      const event = JSON.parse(raw.trim());

      assert.equal(result.intent, 'delivery_terms');
      assert.equal(result.action, 'answer');
      assert.equal(result.analyticsLog.status, 'written');
      assert.equal(result.learningLog.status, 'disabled');
      assert.equal(event.source, 'test');
      assert.equal(event.redactedMessage, 'доставка в москву');
      assert.equal(event.deterministic.intent, 'delivery_terms');
      assert.equal(event.final.intent, 'delivery_terms');
      assert.equal(event.final.confidence > 0.7, true);
      assert.equal(event.final.needsHandoff, false);
      assert.equal(event.outcome, 'answered');
      assert.equal(event.llmFallback.status, 'not_requested');
      assert.equal(event.needsReview, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses LLM fallback only for uncertain deterministic results', () => {
    assert.equal(shouldUseLlmFallback({ intent: 'delivery_terms', confidence: 0.9 }), false);
    assert.equal(shouldUseLlmFallback({ intent: 'other', confidence: 0.45 }), true);
    assert.equal(shouldUseLlmFallback({ intent: 'product_advice', confidence: 0.7 }), true);
    assert.equal(shouldUseLlmFallback({ intent: 'other', confidence: 0.45 }, { enabled: false }), false);
  });
});
