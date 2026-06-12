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

describe('new customer entry flow', () => {
  it('greets newcomers without assuming they already have an order', () => {
    for (const message of ['привет', '/start']) {
      const result = handleCustomerMessage({
        message,
        customer: {},
        orders,
        products,
      });

      assert.equal(result.intent, 'greeting');
      assert.equal(result.action, 'answer');
      assert.equal(result.systemLookup, undefined);
      assert.match(result.answer, /выбрать товар/);
      assert.match(result.answer, /доставк/);
      assert.match(result.answer, /Если заказ уже оформлен/);
      assert.doesNotMatch(result.answer, /Напишите номер заказа/);
      assert.doesNotMatch(result.answer, /Пришлите номер заказа/);
      assert.deepEqual(result.suggestedReplies, [
        'Есть товар в наличии?',
        'Как доставляете?',
        'Где мой заказ?',
      ]);
    }
  });

  it('answers short newcomer menu topics instead of treating them as order lookups', () => {
    const cases = [
      {
        message: 'доставка',
        intent: 'delivery_terms',
        includes: /CDEK/,
      },
      {
        message: 'оплата',
        intent: 'payment',
        includes: /СБП/,
      },
      {
        message: 'самовывоз',
        intent: 'pickup',
        includes: /Гончарный проезд/,
      },
      {
        message: 'что у вас есть?',
        intent: 'product_advice',
        includes: /мышку, коврик, клавиатуру/,
      },
      {
        message: 'хочу посмотреть товары',
        intent: 'product_advice',
        includes: /проверю наличие и цену/,
      },
    ];

    for (const testCase of cases) {
      const result = handleCustomerMessage({
        message: testCase.message,
        customer: {},
        orders,
        products,
      });

      assert.equal(result.intent, testCase.intent, testCase.message);
      assert.notEqual(result.intent, 'order_status', testCase.message);
      assert.equal(result.systemLookup, undefined, testCase.message);
      assert.match(result.answer, testCase.includes, testCase.message);
      assert.doesNotMatch(result.answer, /Нашел заказ/, testCase.message);
      assert.doesNotMatch(result.answer, /номер заказа, трек CDEK, телефон или фамилию/, testCase.message);
    }
  });
});

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

  it('finds an order by relaxed short CRM number variants', () => {
    assert.equal(findOrderContext('6L', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('6 L', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('6-Л', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('№6 Л', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('заказ 6 л', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('когда доставка по 6Л', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('какой пвз 6Л', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('оплачен 6Л', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('номер 7 м', orders).crmOrderNumber, '7_M');
    assert.equal(findOrderContext('8 N', orders).crmOrderNumber, '8_N');
    assert.equal(findOrderContext('8Н', orders).crmOrderNumber, '8_N');
  });

  it('finds an order by phone number', () => {
    const order = findOrderContext('+7 999 123 45 67', orders);

    assert.equal(order.crmOrderNumber, '6_L');
  });

  it('returns multiple for shared surname', () => {
    const order = findOrderContext('Иванов', orders);

    assert.equal(order.lookupStatus, 'multiple');
  });

  it('finds orders by labeled surname or recipient name', () => {
    assert.equal(findOrderContext('фамилия Иванов', orders).lookupStatus, 'multiple');
    assert.equal(findOrderContext('по фамилии Иванов Иван', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('получатель Илья Иванов', orders).crmOrderNumber, '7_M');
  });

  it('finds orders by full name even when customer adds a patronymic', () => {
    assert.equal(findOrderContext('Иванов Иван Иванович', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('ФИО Иванов Иван Иванович', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('Петрова Анна Сергеевна', orders).crmOrderNumber, '8_N');
    assert.equal(findOrderContext('Анна Сергеевна Петрова', orders).crmOrderNumber, '8_N');
  });

  it('does not match an order by patronymic or wrong first name only', () => {
    assert.equal(findOrderContext('Иванович', orders).lookupStatus, 'not_found');
    assert.equal(findOrderContext('Иванов Сергей Петрович', orders).lookupStatus, 'not_found');
    assert.equal(findOrderContext('Иван Иванов Анна', orders).lookupStatus, 'not_found');
    assert.equal(findOrderContext('Иван Иван Петрович', orders).lookupStatus, 'not_found');
  });

  it('finds an order by full recipient name without matching the first name inside a surname', () => {
    assert.equal(findOrderContext('Иванов Иван', orders).crmOrderNumber, '6_L');
    assert.equal(findOrderContext('Иванов Илья', orders).crmOrderNumber, '7_M');
    assert.equal(findOrderContext('Петров Анна', orders).crmOrderNumber, '8_N');
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

  it('finds a product by Russian color follow-up words', () => {
    const product = findProductContext('а черный есть?', products);

    assert.equal(product.slug, 'wlmouse-beast-max-black');
  });

  it('returns multiple when the model hint is ambiguous', () => {
    const product = findProductContext('beast', products);

    assert.equal(product.lookupStatus, 'multiple');
  });

  it('ignores order-help words when product hint is ambiguous', () => {
    const product = findProductContext('как заказать beast?', products);

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

  it('answers order details when a short CRM number is embedded in the question', () => {
    const cases = [
      {
        message: 'когда доставка по 6Л',
        expected: [/По заказу #6_L/, /2-4 рабочих дня/],
      },
      {
        message: 'куда едет 6Л',
        expected: [/#6_L/, /CDEK до пункта выдачи/, /MSK123/],
      },
      {
        message: 'какой пвз 6Л',
        expected: [/#6_L/, /Тестовая улица, 1/],
      },
      {
        message: 'получатель 6Л',
        expected: [/#6_L/, /Иван Иванов/],
      },
      {
        message: 'телефон 6Л',
        expected: [/#6_L/, /\+7 \*\*\* \*\*\* 45 67/],
        forbidden: [/\+7 999 123 45 67/],
      },
      {
        message: 'оплачен 6Л',
        expected: [/#6_L/, /оплата зафиксирована/],
      },
    ];

    for (const testCase of cases) {
      const result = handleCustomerMessage({
        message: testCase.message,
        orders,
      });

      assert.equal(result.intent, 'order_status', testCase.message);
      assert.equal(result.action, 'answer', testCase.message);
      assert.equal(result.systemLookup.status, 'found', testCase.message);
      assert.doesNotMatch(result.answer, /Пришлите номер заказа/, testCase.message);
      assert.doesNotMatch(result.answer, /Не нашел заказ/, testCase.message);

      for (const pattern of testCase.expected) {
        assert.match(result.answer, pattern, testCase.message);
      }

      for (const pattern of testCase.forbidden || []) {
        assert.doesNotMatch(result.answer, pattern, testCase.message);
      }
    }
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
    assert.match(second.answer, /По заказу #6_L/);
    assert.match(second.answer, /2-4 рабочих дня/);
    assert.doesNotMatch(second.answer, /Пришлите номер заказа/);
    assert.doesNotMatch(second.answer, /Не нашел заказ/);
  });

  it('answers destination follow-up from the latest known customer order', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      customer: { id: 'customer-ivanov' },
      orders,
    });

    const second = handleCustomerMessage({
      message: 'куда едет?',
      session: first.nextSession,
      customer: { id: 'customer-ivanov' },
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /#7_M/);
    assert.match(second.answer, /CDEK курьером/);
    assert.match(second.answer, /Курьерская улица, 7/);
    assert.doesNotMatch(second.answer, /Пришлите номер заказа/);
  });

  it('answers pickup point follow-up after tracking lookup', () => {
    const first = handleCustomerMessage({
      message: '1234567890',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'какой пвз?',
      session: first.nextSession,
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /#6_L/);
    assert.match(second.answer, /CDEK до пункта выдачи/);
    assert.match(second.answer, /MSK123/);
    assert.match(second.answer, /Тестовая улица, 1/);
    assert.doesNotMatch(second.answer, /Пришлите номер заказа/);
  });

  it('answers tracking number follow-up without repeating full order status', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      customer: { id: 'customer-ivanov' },
      orders,
    });

    const second = handleCustomerMessage({
      message: 'а номер накладной?',
      session: first.nextSession,
      customer: { id: 'customer-ivanov' },
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /трек CDEK: 9876543210/);
    assert.doesNotMatch(second.answer, /Пришлите номер заказа/);
    assert.doesNotMatch(second.answer, /Если нужно изменить адрес/);
  });

  it('answers payment status follow-up from the latest known order', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      customer: { id: 'customer-ivanov' },
      orders,
    });

    const second = handleCustomerMessage({
      message: 'оплата прошла?',
      session: first.nextSession,
      customer: { id: 'customer-ivanov' },
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /#7_M/);
    assert.match(second.answer, /оплата зафиксирована/);
    assert.doesNotMatch(second.answer, /Не нашел заказ/);
    assert.doesNotMatch(second.answer, /Пришлите номер заказа/);
  });

  it('answers payment method follow-up without treating it as an order lookup', () => {
    const first = handleCustomerMessage({
      message: 'RS-20250601-AB123',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'как оплатить?',
      session: first.nextSession,
      orders,
    });

    assert.equal(second.intent, 'payment');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup, undefined);
    assert.match(second.answer, /Оплата доступна/);
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

  it('does not search for an order by "I do not have the number" replies', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'у меня нет номера',
      session: first.nextSession,
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'ask_clarifying_question');
    assert.equal(second.systemLookup, undefined);
    assert.equal(second.contextRequest.strategy, 'ask_for_hint');
    assert.match(second.answer, /Номер заказа не обязателен/);
    assert.match(second.answer, /телефону, фамилии/);
    assert.doesNotMatch(second.answer, /Не нашел заказ/);
  });

  it('answers recipient phone follow-up with a masked number', () => {
    const first = handleCustomerMessage({
      message: 'Анна Петрова',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'какой телефон указан?',
      session: first.nextSession,
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /#8_N/);
    assert.match(second.answer, /\+7 \*\*\* \*\*\* 22 33/);
    assert.doesNotMatch(second.answer, /\+7 916 111 22 33/);
    assert.doesNotMatch(second.answer, /Не нашел заказ/);
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
    assert.match(second.answer, /По заказу #7_M/);
    assert.match(second.answer, /1-2 рабочих дня/);
    assert.match(second.answer, /9876543210/);
    assert.doesNotMatch(second.answer, /Не нашел заказ/);
  });

  it('answers order status when customer sends a short CRM number', () => {
    for (const message of ['6_L', '№6_L', '#6_L', 'заказ 6_L', 'номер заказа №6_L', '6L', '6 Л', '6-Л', '№6 Л', 'заказ 6 л']) {
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
    assert.match(second.answer, /последний/);
  });

  it('uses the latest order candidate when customer clarifies ambiguous surname with "last"', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'Иванов',
      session: first.nextSession,
      orders,
    });

    const third = handleCustomerMessage({
      message: 'последний',
      session: second.nextSession,
      orders,
    });

    assert.equal(third.intent, 'order_status');
    assert.equal(third.action, 'answer');
    assert.equal(third.systemLookup.status, 'found');
    assert.match(third.answer, /Нашел заказ #7_M/);
    assert.doesNotMatch(third.answer, /Не нашел заказ/);
  });

  it('understands a labeled surname after asking for an order identifier', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'фамилия Иванов',
      session: first.nextSession,
      orders,
    });

    const third = handleCustomerMessage({
      message: 'последний',
      session: second.nextSession,
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'ask_clarifying_question');
    assert.equal(second.systemLookup.status, 'multiple');
    assert.match(second.answer, /несколько похожих заказов/);
    assert.doesNotMatch(second.answer, /Не нашел заказ/);

    assert.equal(third.intent, 'order_status');
    assert.equal(third.action, 'answer');
    assert.equal(third.systemLookup.status, 'found');
    assert.match(third.answer, /Нашел заказ #7_M/);
  });

  it('uses the oldest order candidate when customer clarifies ambiguous surname with "first"', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'Иванов',
      session: first.nextSession,
      orders,
    });

    const third = handleCustomerMessage({
      message: 'первый',
      session: second.nextSession,
      orders,
    });

    assert.equal(third.intent, 'order_status');
    assert.equal(third.action, 'answer');
    assert.equal(third.systemLookup.status, 'found');
    assert.match(third.answer, /Нашел заказ #6_L/);
    assert.doesNotMatch(third.answer, /Не нашел заказ/);
  });

  it('uses delivery method when customer clarifies ambiguous surname by courier or pickup point', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'Иванов',
      session: first.nextSession,
      orders,
    });

    const courier = handleCustomerMessage({
      message: 'тот что с курьером',
      session: second.nextSession,
      orders,
    });

    const pvz = handleCustomerMessage({
      message: 'пвз',
      session: second.nextSession,
      orders,
    });

    assert.equal(courier.intent, 'order_status');
    assert.equal(courier.action, 'answer');
    assert.equal(courier.systemLookup.status, 'found');
    assert.match(courier.answer, /Нашел заказ #7_M/);

    assert.equal(pvz.intent, 'order_status');
    assert.equal(pvz.action, 'answer');
    assert.equal(pvz.systemLookup.status, 'found');
    assert.match(pvz.answer, /Нашел заказ #6_L/);
  });

  it('clears previous order when a new lookup matches multiple candidates', () => {
    const first = handleCustomerMessage({
      message: '9876543210',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'Иванов',
      session: first.nextSession,
      orders,
    });

    const third = handleCustomerMessage({
      message: 'когда приедет',
      session: second.nextSession,
      orders,
    });

    assert.equal(first.systemLookup.status, 'found');
    assert.equal(first.nextSession.lastOrderLookup.crmOrderNumber, '7_M');

    assert.equal(second.systemLookup.status, 'multiple');
    assert.equal(second.nextSession.lastOrderLookup, undefined);
    assert.equal(second.nextSession.lastOrderCandidates.length, 2);

    assert.equal(third.action, 'ask_clarifying_question');
    assert.doesNotMatch(third.answer, /#7_M/);
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

  it('answers order status by full name with patronymic after asking for an identifier', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'ФИО Иванов Иван Иванович',
      session: first.nextSession,
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /Нашел заказ #6_L/);
    assert.doesNotMatch(second.answer, /Не нашел заказ/);
    assert.doesNotMatch(second.answer, /Пришлите номер заказа/);
  });

  it('answers order status when customer starts with labeled full name and patronymic', () => {
    const result = handleCustomerMessage({
      message: 'ФИО Иванов Иван Иванович',
      orders,
    });

    assert.equal(result.intent, 'order_status');
    assert.equal(result.action, 'answer');
    assert.equal(result.systemLookup.status, 'found');
    assert.match(result.answer, /Нашел заказ #6_L/);
    assert.doesNotMatch(result.answer, /Не нашел заказ/);
    assert.doesNotMatch(result.answer, /Пришлите номер заказа/);
  });

  it('answers order status by full Ivanov name instead of returning multiple matches', () => {
    const first = handleCustomerMessage({
      message: 'где мой заказ',
      orders,
    });

    const second = handleCustomerMessage({
      message: 'Иванов Иван',
      session: first.nextSession,
      orders,
    });

    assert.equal(second.intent, 'order_status');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /Нашел заказ #6_L/);
    assert.doesNotMatch(second.answer, /несколько похожих заказов/);
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

  it('answers general delivery questions without reusing the previous order', () => {
    const first = handleCustomerMessage({
      message: '6_L',
      orders,
    });

    for (const message of [
      'а какие у вас сроки доставки?',
      'какие есть способы доставки?',
      'типы доставок',
      'как отправка делается?',
      'отправляете по России?',
      'можно в регион?',
      'куда вы отправляете?',
    ]) {
      const result = handleCustomerMessage({
        message,
        session: first.nextSession,
        orders,
      });

      assert.equal(result.intent, 'delivery_terms');
      assert.equal(result.action, 'answer');
      assert.equal(result.systemLookup, undefined);
      assert.match(result.answer, /CDEK/);
      assert.match(result.answer, /пункта выдачи/);
      assert.match(result.answer, /курьером/);
      assert.doesNotMatch(result.answer, /#6_L/);
      assert.doesNotMatch(result.answer, /Нашел заказ/);
      assert.doesNotMatch(result.answer, /Пришлите номер заказа/);
    }
  });

  it('answers general payment and pickup questions without reusing the previous order', () => {
    const first = handleCustomerMessage({
      message: '6_L',
      orders,
    });

    for (const message of ['рассрочка есть?', 'долями можно?', 'сплит есть?']) {
      const result = handleCustomerMessage({
        message,
        session: first.nextSession,
        orders,
      });

      assert.equal(result.intent, 'payment');
      assert.equal(result.action, 'answer');
      assert.equal(result.systemLookup, undefined);
      assert.match(result.answer, /СБП/);
      assert.match(result.answer, /рассрочка/);
      assert.doesNotMatch(result.answer, /#6_L/);
      assert.doesNotMatch(result.answer, /Не нашел заказ/);
      assert.doesNotMatch(result.answer, /Пришлите номер заказа/);
    }

    const pickup = handleCustomerMessage({
      message: 'самовывоз есть?',
      session: first.nextSession,
      orders,
    });

    assert.equal(pickup.intent, 'pickup');
    assert.equal(pickup.action, 'answer');
    assert.equal(pickup.systemLookup, undefined);
    assert.match(pickup.answer, /Гончарный проезд/);
    assert.doesNotMatch(pickup.answer, /#6_L/);
    assert.doesNotMatch(pickup.answer, /Нашел заказ/);
  });

  it('answers short timing and shipping follow-ups from the previously found order', () => {
    const first = handleCustomerMessage({
      message: '1234567890',
      orders,
    });

    for (const message of ['по срокам что?', 'уже отправили?', 'сколько ждать?']) {
      const result = handleCustomerMessage({
        message,
        session: first.nextSession,
        orders,
      });

      assert.equal(result.intent, 'order_status');
      assert.equal(result.action, 'answer');
      assert.equal(result.systemLookup.status, 'found');
      assert.match(result.answer, /#6_L/);
      assert.match(result.answer, /2-4 рабочих дня/);
      assert.doesNotMatch(result.answer, /Не нашел заказ/);
      assert.doesNotMatch(result.answer, /Пришлите номер заказа/);
    }
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
    assert.equal(result.nextSession.lastProductLookup.slug, 'wlmouse-beast-max-black');
  });

  it('answers price follow-up without asking for product name again', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'а сколько стоит?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'price_discount');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /WLmouse Beast Max Black/);
    assert.match(second.answer, /15\s?990/);
    assert.doesNotMatch(second.answer, /Пришлите ссылку/);
  });

  it('answers discount follow-up for the previously found product', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'а скидка есть?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'price_discount');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /WLmouse Beast Max Black/);
    assert.match(second.answer, /15\s?990/);
    assert.match(second.answer, /Отдельный промокод или ручную скидку/);
    assert.doesNotMatch(second.answer, /В наличии 3 шт/);
  });

  it('answers promo code follow-up without treating "есть" as availability', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'промокод есть?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'price_discount');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /промокод/);
    assert.doesNotMatch(second.answer, /В наличии 3 шт/);
  });

  it('answers cheaper-price follow-up for inactive products instead of falling back', () => {
    const first = handleCustomerMessage({
      message: 'lamzu atlantis mini pro есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'а дешевле можно?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'price_discount');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /LAMZU Atlantis Mini Pro/);
    assert.match(second.answer, /12\s?990/);
    assert.doesNotMatch(second.answer, /Я могу проверить/);
  });

  it('answers Russian color follow-up for the previously found product', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'а черный?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'availability');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /WLmouse Beast Max Black/);
    assert.match(second.answer, /В наличии 3 шт/);
    assert.doesNotMatch(second.answer, /Не нашел товар/);
  });

  it('answers available colors for the previously found product without asking for a link', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'какие цвета есть?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'availability');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'variant_summary');
    assert.equal(second.nextSession.pendingRequest, undefined);
    assert.match(second.answer, /WLmouse Beast Max Black/);
    assert.match(second.answer, /Других цветов/);
    assert.doesNotMatch(second.answer, /Пришлите ссылку/);
    assert.doesNotMatch(second.answer, /такой вариант/);
  });

  it('answers color list follow-up after resolving an ambiguous product hint', () => {
    const first = handleCustomerMessage({
      message: 'beast есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'beast max black',
      session: first.nextSession,
      products,
    });

    const third = handleCustomerMessage({
      message: 'какие расцветки?',
      session: second.nextSession,
      products,
    });

    assert.equal(third.intent, 'availability');
    assert.equal(third.action, 'answer');
    assert.equal(third.systemLookup.status, 'variant_summary');
    assert.match(third.answer, /WLmouse Beast Max Black/);
    assert.match(third.answer, /Других цветов/);
    assert.doesNotMatch(third.answer, /Пришлите ссылку/);
  });

  it('answers restock timing follow-up when the product is already available', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'когда завоз?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'availability');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /WLmouse Beast Max Black/);
    assert.match(second.answer, /есть 3 шт/);
    assert.doesNotMatch(second.answer, /Я могу проверить/);
  });

  it('hands off restock timing follow-up for preorder products without guessing a date', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast x mini есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'когда будет?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'availability');
    assert.equal(second.action, 'handoff_to_operator');
    assert.equal(second.handoffReason, 'restock_timing');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /WLmouse Beast X Mini/);
    assert.match(second.answer, /под заказ\/предзаказ/);
    assert.match(second.answer, /Точного срока поступления/);
  });

  it('hands off restock timing follow-up for inactive products instead of falling back', () => {
    const first = handleCustomerMessage({
      message: 'lamzu atlantis mini pro есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'когда поступит?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'availability');
    assert.equal(second.action, 'handoff_to_operator');
    assert.equal(second.handoffReason, 'restock_timing');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /LAMZU Atlantis Mini Pro/);
    assert.match(second.answer, /не активен/);
    assert.match(second.answer, /Точного срока поступления/);
    assert.doesNotMatch(second.answer, /Я могу проверить/);
  });

  it('does not ask for a link when another color is missing for current product', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'а белый есть?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'availability');
    assert.equal(second.action, 'ask_clarifying_question');
    assert.equal(second.systemLookup.status, 'variant_not_found');
    assert.match(second.answer, /WLmouse Beast Max Black/);
    assert.match(second.answer, /не нашел такой вариант/);
    assert.doesNotMatch(second.answer, /Пришлите ссылку/);
  });

  it('switches to a short variant model instead of reusing the previous product', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'а mini есть?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'availability');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /WLmouse Beast X Mini/);
    assert.doesNotMatch(second.answer, /WLmouse Beast Max Black/);
  });

  it('answers order help follow-up for the previously found product', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'тогда беру',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'order_help');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /WLmouse Beast Max Black/);
    assert.match(second.answer, /https:\/\/reship\.pro\/product\/wlmouse-beast-max-black/);
    assert.match(second.answer, /3 шт/);
    assert.doesNotMatch(second.answer, /Пришлите ссылку/);
  });

  it('answers product link follow-up for the previously found product', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    for (const message of ['можно ссылку', 'скинь ссылку']) {
      const result = handleCustomerMessage({
        message,
        session: first.nextSession,
        products,
      });

      assert.equal(result.intent, 'order_help', message);
      assert.equal(result.action, 'answer', message);
      assert.equal(result.systemLookup.status, 'found', message);
      assert.match(result.answer, /WLmouse Beast Max Black/, message);
      assert.match(result.answer, /https:\/\/reship\.pro\/product\/wlmouse-beast-max-black/, message);
      assert.doesNotMatch(result.answer, /Я могу проверить/, message);
      assert.doesNotMatch(result.answer, /Пришлите ссылку/, message);
    }
  });

  it('answers review follow-up for the previously found product', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'а отзывы есть',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'review');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /WLmouse Beast Max Black/);
    assert.match(second.answer, /https:\/\/reship\.pro\/product\/wlmouse-beast-max-black/);
    assert.doesNotMatch(second.answer, /Я могу проверить/);
  });

  it('answers advice follow-up for the previously found product without asking for the model again', () => {
    const first = handleCustomerMessage({
      message: 'wlmouse beast max есть?',
      products,
    });

    const second = handleCustomerMessage({
      message: 'а подойдет для claw grip',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'product_advice');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /WLmouse Beast Max Black/);
    assert.match(second.answer, /хват/);
    assert.match(second.answer, /размер руки/);
    assert.doesNotMatch(second.answer, /Напишите модель устройства/);
    assert.doesNotMatch(second.answer, /Я могу проверить/);
  });

  it('answers alternative follow-ups for the previously found product without repeating availability', () => {
    const first = handleCustomerMessage({
      message: 'beast mini',
      products,
    });

    for (const message of ['есть аналоги?', 'что похожее есть?']) {
      const result = handleCustomerMessage({
        message,
        session: first.nextSession,
        products,
      });

      assert.equal(result.intent, 'product_advice');
      assert.equal(result.action, 'answer');
      assert.equal(result.systemLookup.status, 'found');
      assert.match(result.answer, /WLmouse Beast X Mini/);
      assert.match(result.answer, /аналогам/);
      assert.doesNotMatch(result.answer, /Товар доступен под заказ/);
      assert.doesNotMatch(result.answer, /Проверю наличие/);
      assert.doesNotMatch(result.answer, /Я могу проверить/);
    }
  });

  it('answers warranty questions without treating them as availability', () => {
    const first = handleCustomerMessage({
      message: 'beast mini',
      products,
    });

    const warranty = handleCustomerMessage({
      message: 'а гарантия есть?',
      session: first.nextSession,
      products,
    });

    const refund = handleCustomerMessage({
      message: 'хочу вернуть товар',
      session: first.nextSession,
      products,
    });

    assert.equal(warranty.intent, 'warranty_or_return');
    assert.equal(warranty.action, 'answer');
    assert.equal(warranty.systemLookup, undefined);
    assert.match(warranty.answer, /Гарантия/);
    assert.doesNotMatch(warranty.answer, /Товар доступен под заказ/);
    assert.doesNotMatch(warranty.answer, /Проверю наличие/);

    assert.equal(refund.intent, 'warranty_or_return');
    assert.equal(refund.action, 'handoff_to_operator');
    assert.equal(refund.handoffReason, 'refund_or_return');
  });

  it('answers order help with product context when model is in the same message', () => {
    const result = handleCustomerMessage({
      message: 'как заказать beast max?',
      products,
    });

    assert.equal(result.intent, 'order_help');
    assert.equal(result.action, 'answer');
    assert.equal(result.systemLookup.status, 'found');
    assert.match(result.answer, /WLmouse Beast Max Black/);
    assert.match(result.answer, /https:\/\/reship\.pro\/product\/wlmouse-beast-max-black/);
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
    assert.equal(result.nextSession.lastProductLookup, undefined);
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

  it('answers price follow-up after product search result', () => {
    const first = handleCustomerMessage({
      message: 'я не могу найти lamzu atlantis mini на сайте',
      products,
    });

    const second = handleCustomerMessage({
      message: 'а цена?',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'price_discount');
    assert.equal(second.action, 'answer');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /LAMZU Atlantis Mini Pro/);
    assert.match(second.answer, /12\s?990/);
    assert.doesNotMatch(second.answer, /Пришлите ссылку/);
  });

  it('hands off order help follow-up when the found product is inactive', () => {
    const first = handleCustomerMessage({
      message: 'я не могу найти lamzu atlantis mini на сайте',
      products,
    });

    const second = handleCustomerMessage({
      message: 'хочу заказать',
      session: first.nextSession,
      products,
    });

    assert.equal(second.intent, 'order_help');
    assert.equal(second.action, 'handoff_to_operator');
    assert.equal(second.handoffReason, 'product_order_review');
    assert.equal(second.systemLookup.status, 'found');
    assert.match(second.answer, /LAMZU Atlantis Mini Pro/);
    assert.match(second.answer, /не активен в каталоге/);
  });
});
