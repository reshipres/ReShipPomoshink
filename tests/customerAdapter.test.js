import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  handleCustomerMessage,
  findLatestOrderContext,
  findOrderContext,
  findProductContext,
} from '../src/index.js';

const orders = JSON.parse(readFileSync(new URL('../fixtures/system-orders.json', import.meta.url), 'utf8'));
const products = JSON.parse(readFileSync(new URL('../fixtures/system-products.json', import.meta.url), 'utf8'));

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

  it('finds an order by short CRM number variants', () => {
    assert.equal(findOrderContext('6_L', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('№6_L', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('#6_L', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('номер заказа №6_L', orders).crmOrderNumber, '6_L');
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

describe('system product lookup', () => {
  it('finds a product by public product URL', () => {
    const product = findProductContext('https://reship.pro/product/wlmouse-beast-max-black', products);

    assert.equal(product.slug, 'wlmouse-beast-max-black');
  });

  it('finds a product by model alias inside a customer question', () => {
    const product = findProductContext('wlmouse beast max есть?', products);

    assert.equal(product.name, 'WLmouse Beast Max Black');
  });

  it('returns multiple when the model hint is ambiguous', () => {
    const product = findProductContext('beast', products);

    assert.equal(product.lookupStatus, 'multiple');
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
      message: 'а другой?',
      session: first.nextSession,
      customer: { id: 'customer-ivanov' },
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'ask_clarifying_question');
    assert.equal(second.systemLookup, undefined);
    assert.equal(second.nextSession.lastOrderLookup, undefined);
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
    assert.equal(result.nextSession.lastOrderLookup.crmOrderNumber, '6_L');
  });

  it('answers delivery follow-up without asking for order id again', () => {
    const first = handleCustomerMessage({
      message: '1234567890',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'а когда приедет?',
      session: first.nextSession,
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /Нашел заказ #6_L/);
    assert.doesNotMatch(second.answer, /Пришлите номер заказа/);
    assert.doesNotMatch(second.answer, /Не нашел заказ/);
  });

  it('answers pickup follow-up after a short order number', () => {
    const first = handleCustomerMessage({
      message: '6_L',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'а где забрать?',
      session: first.nextSession,
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /Нашел заказ #6_L/);
    assert.match(second.answer, /Способ получения/);
  });

  it('answers follow-up from the latest known customer order', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      customer: { id: 'customer-ivanov' },
      orders,
    });

    const second = handleCustomerMessage({
      message: 'когда доставка?',
      session: first.nextSession,
      customer: { id: 'customer-ivanov' },
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /Нашел заказ #7_M/);
    assert.doesNotMatch(second.answer, /Не нашел заказ/);
  });

  it('answers order status when customer sends a short CRM number', () => {
    for (const message of ['6_L', '№6_L', '#6_L', 'заказ 6_L', 'номер заказа №6_L']) {
      const result = handleCustomerMessage({ message, orders });

      assert.equal(result.intent, 'order_status');
      assert.equal(result.action, 'answer');
      assert.equal(result.systemLookup.status, 'found');
      assert.match(result.answer, /Нашел заказ #6_L/);
      assert.doesNotMatch(result.answer, /Пришлите номер заказа/);
    }
  });

  it('does not confuse a CDEK tracking question with delivery data', () => {
    const result = handleCustomerMessage({
      message: 'что с сдэк 1234567890',
      orders,
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'answer');
    assert.equal(result.systemLookup.status, 'found');
    assert.match(result.answer, /Нашел заказ #6_L/);
    assert.doesNotMatch(result.answer, /данные доставки/);
  });

  it('hands off when customer says tracking does not update', () => {
    const result = handleCustomerMessage({
      message: 'трек не обновляется 1234567890',
      orders,
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'handoff_to_operator');
    assert.equal(result.handoffReason, 'order_delivery_review');
    assert.equal(result.systemLookup.status, 'found');
    assert.match(result.answer, /Передаю оператору/);
    assert.match(result.answer, /1234567890/);
  });

  it('hands off stuck delivery issue for a known customer order', () => {
    const result = handleCustomerMessage({
      message: 'мой заказ завис',
      customer: { id: 'customer-ivanov' },
      orders,
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'handoff_to_operator');
    assert.equal(result.handoffReason, 'order_delivery_review');
    assert.equal(result.systemLookup.status, 'found');
    assert.match(result.answer, /#7_M/);
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

describe('customer-style product lookup conversations', () => {
  it('answers availability when customer sends a known model', () => {
    const result = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    assert.equal(result.intent, 'availability');
    assert.equal(result.action, 'answer');
    assert.equal(result.systemLookup.status, 'found');
    assert.match(result.answer, /WLmouse Beast Max Black/);
    assert.match(result.answer, /В наличии 3 шт/);
    assert.doesNotMatch(result.answer, /Пришлите ссылку/);
  });

  it('answers price when customer sends a known model', () => {
    const result = handleCustomerMessage({
      message: 'сколько beast max стоит?',
      products,
    });

    assert.equal(result.intent, 'price_discount');
    assert.equal(result.action, 'answer');
    assert.equal(result.systemLookup.status, 'found');
    assert.match(result.answer, /15\s?990/);
  });

  it('asks for exact model when product hint is ambiguous', () => {
    const result = handleCustomerMessage({
      message: 'beast есть?',
      products,
    });

    assert.equal(result.intent, 'availability');
    assert.equal(result.action, 'ask_clarifying_question');
    assert.equal(result.systemLookup.status, 'multiple');
    assert.match(result.answer, /несколько похожих товаров/);
  });

  it('explains when product is not found in the system', () => {
    const result = handleCustomerMessage({
      message: 'lamzu thorn есть?',
      products,
    });

    assert.equal(result.intent, 'availability');
    assert.equal(result.action, 'ask_clarifying_question');
    assert.equal(result.systemLookup.status, 'not_found');
    assert.match(result.answer, /Не нашел товар/);
  });

  it('keeps product search intent when missing-site item is found in the system', () => {
    const result = handleCustomerMessage({
      message: 'я не могу найти lamzu atlantis mini на сайте',
      products,
    });

    assert.equal(result.intent, 'product_search');
    assert.equal(result.action, 'answer');
    assert.equal(result.systemLookup.status, 'found');
    assert.match(result.answer, /LAMZU Atlantis Mini Pro/);
    assert.match(result.answer, /не активен в каталоге/);
  });
});
