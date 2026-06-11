import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { handleMessage } from '../src/index.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/client-phrases.json', import.meta.url), 'utf8'));

describe('ReShipPomoshink intent regression', () => {
  for (const fixture of fixtures) {
    it(`${fixture.message} -> ${fixture.intent}`, () => {
      const result = handleMessage({
        message: fixture.message,
        session: fixture.session || {},
      });

      assert.equal(result.intent, fixture.intent);
      assert.equal(result.action, fixture.action);
    });
  }
});

describe('order answer quality', () => {
  it('explains order status without leaking raw system fields', () => {
    const result = handleMessage({
      message: 'где мой заказ',
      orderContext: {
        orderNumber: '6_L',
        status: 'PROCESSING',
        deliveryMethod: 'CDEK_PVZ',
        cdekTrackingNumber: '1234567890',
        updatedAt: '2026-06-11T18:30:00.000Z',
      },
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'answer');
    assert.match(result.answer, /Нашел заказ #6_L/);
    assert.match(result.answer, /в обработке/);
    assert.match(result.answer, /Трек CDEK: 1234567890/);
    assert.doesNotMatch(result.answer, /PROCESSING/);
  });

  it('does not answer order status to plain greeting even when order context exists', () => {
    const result = handleMessage({
      message: 'привет',
      orderContext: {
        orderNumber: '6_L',
        status: 'PROCESSING',
      },
    });

    assert.equal(result.intent, 'greeting');
    assert.doesNotMatch(result.answer, /6_L/);
  });

  it('keeps pending order lookup request for the next customer message', () => {
    const first = handleMessage({ message: 'где мой заказ' });

    assert.equal(first.intent, 'order_status');
    assert.equal(first.action, 'ask_clarifying_question');
    assert.equal(first.nextSession.pendingRequest.type, 'order');

    const second = handleMessage({
      message: '+7 999 123 45 67',
      session: first.nextSession,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'ask_clarifying_question');
    assert.equal(second.contextRequest.type, 'order');
    assert.equal(second.contextRequest.strategy, 'by_hint');
  });

  it('clears pending request after answering with order context', () => {
    const result = handleMessage({
      message: '+7 999 123 45 67',
      session: { pendingRequest: { type: 'order', intent: 'order_status' } },
      orderContext: {
        orderNumber: '6_L',
        status: 'PROCESSING',
      },
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'answer');
    assert.equal(result.nextSession.pendingRequest, undefined);
  });
});
