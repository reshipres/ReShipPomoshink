import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { handleCustomerMessage, findLatestOrderContext, findOrderContext } from '../src/index.js';

const orders = JSON.parse(readFileSync(new URL('../fixtures/system-orders.json', import.meta.url), 'utf8'));

describe('system order lookup', () => {
  it('finds an order by CDEK tracking number', () => {
    const order = findOrderContext('1234567890', orders);

    assert.equal(order.crmOrderNumber, '6_L');
    assert.equal(order.cdekTrackingNumber, '1234567890');
  });

  it('finds an order by public order number', () => {
    const order = findOrderContext('RS-20250603-EF789', orders);

    assert.equal(order.crmOrderNumber, '8_N');
    assert.equal(order.recipientLastName, 'Петрова');
  });

  it('finds an order by phone number', () => {
    const order = findOrderContext('+7 999 123 45 67', orders);

    assert.equal(order.crmOrderNumber, '6_L');
  });

  it('returns multiple for shared surname', () => {
    const order = findOrderContext('Иванов', orders);

    assert.equal(order.lookupStatus, 'multiple');
  });

  it('finds latest known customer order by customer id', () => {
    const order = findLatestOrderContext({ id: 'customer-ivanov' }, orders);

    assert.equal(order.crmOrderNumber, '7_M');
  });

  it('finds latest known customer order by Telegram id', () => {
    const order = findLatestOrderContext({ telegramId: 'tg-petrova' }, orders);

    assert.equal(order.crmOrderNumber, '8_N');
  });
});

describe('customer-style order lookup conversations', () => {
  it('answers latest known customer order without asking for an id', () => {
    const result = handleCustomerMessage({
      message: 'где мой заказ',
      customer: { id: 'customer-ivanov' },
      orders,
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'answer');
    assert.equal(result.systemLookup.status, 'found');
    assert.match(result.answer, /Нашел заказ #7_M/);
    assert.match(result.answer, /Трек CDEK: 9876543210/);
    assert.doesNotMatch(result.answer, /Пришлите номер заказа/);
  });

  it('answers latest known customer order by known customer phone', () => {
    const result = handleCustomerMessage({
      message: 'заказ',
      customer: { phone: '+7 916 111 22 33' },
      orders,
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'answer');
    assert.equal(result.systemLookup.status, 'found');
    assert.match(result.answer, /Нашел заказ #8_N/);
  });

  it('does not silently reuse latest known order when customer asks for another one', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      customer: { id: 'customer-ivanov' },
      orders,
    });

    const second = handleCustomerMessage({
      message: 'другой',
      session: first.nextSession,
      customer: { id: 'customer-ivanov' },
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'ask_clarifying_question');
    assert.equal(second.systemLookup, undefined);
    assert.match(second.answer, /Если нужен другой заказ/);
  });

  it('answers order status when customer starts with tracking number', () => {
    const result = handleCustomerMessage({
      message: '1234567890',
      orders,
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'answer');
    assert.equal(result.systemLookup.status, 'found');
    assert.match(result.answer, /Нашел заказ #6_L/);
    assert.match(result.answer, /Трек CDEK: 1234567890/);
  });

  it('answers order status when customer starts with public order number', () => {
    const result = handleCustomerMessage({
      message: 'RS-20250603-EF789',
      orders,
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'answer');
    assert.match(result.answer, /Нашел заказ #8_N/);
    assert.match(result.answer, /ожидает получения/);
  });

  it('asks for exact id when surname matches multiple orders', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'Иванов',
      session: first.nextSession,
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'ask_clarifying_question');
    assert.equal(second.systemLookup.status, 'multiple');
    assert.match(second.answer, /несколько похожих заказов/);
  });

  it('answers order status by full name when it is unique', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'Анна Петрова',
      session: first.nextSession,
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /Нашел заказ #8_N/);
  });

  it('answers order status by phone after asking for an identifier', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      orders,
    });

    const second = handleCustomerMessage({
      message: '+7 999 123 45 67',
      session: first.nextSession,
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /Нашел заказ #6_L/);
    assert.doesNotMatch(second.answer, /Пришлите номер заказа/);
  });
});
