import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildOpenAiResponseRequest,
  createOpenAiLlmClient,
  parseOpenAiResponseJson,
} from '../src/index.js';
import { SUPPORT_LLM_SCHEMA } from '../src/llmFallback.js';

describe('OpenAI LLM client', () => {
  it('builds a Responses API request with structured JSON output', () => {
    const request = buildOpenAiResponseRequest({
      message: 'а вот это как работает?',
      deterministicResult: {
        intent: 'other',
        action: 'ask_clarifying_question',
        confidence: 0.45,
        answer: 'Уточните вопрос.',
      },
      facts: [
        {
          id: 'support_scope',
          title: 'Что умеет помощник',
          intents: ['other'],
          text: 'Помощник отвечает на частые вопросы ReShip.',
        },
      ],
      factIds: ['support_scope'],
      schema: SUPPORT_LLM_SCHEMA,
      model: 'gpt-5-mini',
      reasoningEffort: 'minimal',
      temperature: 0.2,
    });
    const input = JSON.parse(request.input);

    assert.equal(request.model, 'gpt-5-mini');
    assert.equal(request.store, false);
    assert.equal(request.temperature, 0.2);
    assert.deepEqual(request.reasoning, { effort: 'minimal' });
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.text.format.strict, true);
    assert.equal(request.text.format.schema.properties.confidence.minimum, undefined);
    assert.equal(input.message, 'а вот это как работает?');
    assert.equal(input.facts[0].id, 'support_scope');
    assert.match(request.instructions, /не придумывай/i);
  });

  it('parses JSON from a Responses API output_text message', () => {
    const parsed = parseOpenAiResponseJson({
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: '{"intent":"other","action":"ask_clarifying_question","answer":"Уточните вопрос.","needsHandoff":false,"handoffReason":null,"usedFacts":["support_scope"],"confidence":0.81,"reason":"safe"}',
            },
          ],
        },
      ],
    });

    assert.equal(parsed.intent, 'other');
    assert.equal(parsed.confidence, 0.81);
    assert.deepEqual(parsed.usedFacts, ['support_scope']);
  });

  it('calls OpenAI Responses API through injected fetch', async () => {
    const calls = [];
    const client = createOpenAiLlmClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          text: async () => JSON.stringify({
            output_text: '{"intent":"other","action":"ask_clarifying_question","answer":"Уточните вопрос.","needsHandoff":false,"handoffReason":null,"usedFacts":["support_scope"],"confidence":0.8,"reason":"safe"}',
          }),
        };
      },
    });

    const decision = await client({
      message: 'что делать?',
      deterministicResult: { intent: 'other', action: 'ask_clarifying_question', confidence: 0.45 },
      facts: [{ id: 'support_scope', title: 'Что умеет помощник', text: 'Помощник отвечает на частые вопросы ReShip.' }],
      factIds: ['support_scope'],
      schema: SUPPORT_LLM_SCHEMA,
      model: 'gpt-5-mini',
    });

    assert.equal(calls[0].url, 'https://api.openai.test/v1/responses');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
    assert.equal(JSON.parse(calls[0].options.body).store, false);
    assert.equal(decision.answer, 'Уточните вопрос.');
  });
});
