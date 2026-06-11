import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { handleMessage } from '../src/index.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/client-phrases.json', import.meta.url), 'utf8'));
const conversationScenarios = JSON.parse(readFileSync(new URL('../fixtures/conversation-scenarios.json', import.meta.url), 'utf8'));

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
    assert.match(second.answer, /по этим данным/);
    assert.doesNotMatch(second.answer, /^Проверю заказ\. Пришлите/u);
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

  it('explains when order lookup found nothing', () => {
    const result = handleMessage({
      message: '+7 999 123 45 67',
      orderContext: {
        lookupStatus: 'not_found',
      },
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'ask_clarifying_question');
    assert.match(result.answer, /Не нашел заказ/);
    assert.equal(result.contextRequest.strategy, 'ask_for_hint');
  });

  it('asks for exact identifier when lookup is ambiguous', () => {
    const result = handleMessage({
      message: 'Иванов',
      session: { pendingRequest: { type: 'order', intent: 'order_status' } },
      orderContext: {
        lookupStatus: 'multiple',
      },
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'ask_clarifying_question');
    assert.match(result.answer, /несколько похожих заказов/);
    assert.equal(result.contextRequest.strategy, 'ask_for_exact_hint');
  });

  it('hands off order cases that require manual review', () => {
    const result = handleMessage({
      message: 'где мой заказ',
      orderContext: {
        orderNumber: '6_L',
        status: 'PROCESSING',
        requiresOperator: true,
        operatorReason: 'Статус доставки не обновлялся больше недели.',
      },
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'handoff_to_operator');
    assert.equal(result.handoffReason, 'order_requires_operator');
    assert.match(result.answer, /ручная проверка оператора/);
  });

  it('answers order detail questions without exposing the full phone number', () => {
    const result = handleMessage({
      message: 'какой телефон указан?',
      orderContext: {
        orderNumber: '8_N',
        status: 'PROCESSING',
        recipientPhone: '+7 916 111 22 33',
      },
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'answer');
    assert.match(result.answer, /\+7 \*\*\* \*\*\* 22 33/);
    assert.doesNotMatch(result.answer, /\+7 916 111 22 33/);
  });

  it('answers payment status from order context', () => {
    const result = handleMessage({
      message: 'он оплачен?',
      orderContext: {
        orderNumber: '7_M',
        status: 'shipping',
      },
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'answer');
    assert.match(result.answer, /#7_M/);
    assert.match(result.answer, /оплата зафиксирована/);
    assert.doesNotMatch(result.answer, /Оплата доступна/);
  });
});

describe('low-friction product flow', () => {
  it('does not ask for product name again when customer already sent it', () => {
    const result = handleMessage({ message: 'wlmouse beast max' });

    assert.equal(result.intent, 'availability');
    assert.equal(result.action, 'ask_clarifying_question');
    assert.equal(result.contextRequest.type, 'product');
    assert.equal(result.contextRequest.strategy, 'by_hint');
    assert.match(result.answer, /по этому товару/);
    assert.doesNotMatch(result.answer, /Пришлите ссылку/);
  });

  it('does not ask for product name again for price questions with model', () => {
    const result = handleMessage({ message: 'сколько будет стоить beast max?' });

    assert.equal(result.intent, 'price_discount');
    assert.equal(result.contextRequest.type, 'product');
    assert.equal(result.contextRequest.strategy, 'by_hint');
    assert.match(result.answer, /по этому товару/);
  });

  it('uses product context when customer wants to order the found item', () => {
    const result = handleMessage({
      message: 'тогда беру',
      productContext: {
        name: 'WLmouse Beast Max Black',
        slug: 'wlmouse-beast-max-black',
        quantity: 3,
        price: 15990,
      },
    });

    assert.equal(result.intent, 'order_help');
    assert.equal(result.action, 'answer');
    assert.match(result.answer, /WLmouse Beast Max Black/);
    assert.match(result.answer, /https:\/\/reship\.pro\/product\/wlmouse-beast-max-black/);
    assert.match(result.answer, /3 шт/);
    assert.doesNotMatch(result.answer, /откройте карточку товара/);
  });
});

describe('customer conversation scenarios', () => {
  for (const scenario of conversationScenarios) {
    it(scenario.name, () => {
      let session = {};

      for (const step of scenario.steps) {
        const result = handleMessage({
          message: step.message,
          session: step.session || session,
          orderContext: step.orderContext || null,
          productContext: step.productContext || null,
        });

        assertScenarioExpectation(result, step.expect);
        session = result.nextSession || {};
      }
    });
  }
});

function assertScenarioExpectation(result, expectation) {
  assert.equal(result.intent, expectation.intent);
  assert.equal(result.action, expectation.action);

  if (expectation.handoffReason) {
    assert.equal(result.handoffReason, expectation.handoffReason);
  }

  if (Object.hasOwn(expectation, 'appendToExistingHandoff')) {
    assert.equal(Boolean(result.appendToExistingHandoff), expectation.appendToExistingHandoff);
  }

  if (expectation.contextRequestType) {
    assert.equal(result.contextRequest?.type, expectation.contextRequestType);
  }

  if (expectation.contextRequestStrategy) {
    assert.equal(result.contextRequest?.strategy, expectation.contextRequestStrategy);
  }

  for (const pattern of expectation.answerIncludes || []) {
    assert.match(result.answer, new RegExp(escapeRegExp(pattern), 'u'));
  }

  for (const pattern of expectation.answerExcludes || []) {
    assert.doesNotMatch(result.answer, new RegExp(escapeRegExp(pattern), 'u'));
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
