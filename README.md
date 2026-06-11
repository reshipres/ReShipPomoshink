# ReShipPomoshink

Отдельное ядро клиентского помощника ReShip.

Цель: быстро улучшать качество ответов бота без фронта, Telegram, Nest и LLM. Здесь лежит только сценарная логика: классификация фразы клиента, безопасный ответ, handoff оператору и тесты на реальные клиентские формулировки.

## Команды

```bash
npm test
npm run eval
npm run analyze:telegram -- /Users/davidbukarov/Downloads/DataExport_2026-06-11.zip
npm run chat
npm run chat -- --anonymous
```

## Как устроено

- `src/engine.js` - низкоуровневое ядро: принимает сообщение, контекст заказа/товара и возвращает ответ.
- `src/customerAdapter.js` - клиентский вход: сам подтягивает заказ/товар из переданных системных данных и повторно вызывает ядро.
- `src/orderLookup.js` - поиск заказа по номеру, CRM-номеру, треку CDEK, телефону, фамилии или известному клиенту.
- `src/productLookup.js` - поиск товара по ссылке, slug, названию модели и алиасам.
- `src/intents.js` - детерминированная классификация фраз.
- `src/replies.js` - тексты ответов и форматирование статуса заказа.
- `fixtures/client-phrases.json` - фразы клиентов с ожидаемыми интентами.
- `fixtures/conversation-scenarios.json` - короткие клиентские диалоги без лишних повторных вопросов.
- `fixtures/system-orders.json` - локальные обезличенные заказы для проверки системного lookup.
- `fixtures/system-products.json` - локальные товары для проверки ответов по наличию, цене и поиску товара.
- `tests/engine.test.js` - регрессия, чтобы бот не деградировал.
- `tests/customerAdapter.test.js` - клиентские сценарии с поиском заказа в системе.
- `scripts/analyze-telegram-export.mjs` - локальный агрегированный анализ Telegram export без сохранения сырого текста.

## Интеграция

Для клиентского бота используйте `handleCustomerMessage`. Он делает полный цикл: классифицирует сообщение, ищет нужный контекст в переданных данных и возвращает готовый ответ.

```js
import { handleCustomerMessage } from './src/index.js';

const result = handleCustomerMessage({
  message: 'где мой заказ',
  session,
  customer: { id: 'customer-ivanov', phone: '+7 999 123 45 67' },
  orders,
  products,
});
```

Сайт или Telegram-адаптер должны:

1. Передать текст клиента, `session`, известного `customer`, массив заказов и товаров в `handleCustomerMessage`.
2. Сохранить `result.nextSession` для следующего сообщения клиента.
3. Показать `result.answer` клиенту.
4. Если `needsHandoff === true`, создать тикет или позвать оператора.

`handleMessage` остается доступен для низкоуровневых тестов и кастомной интеграции, где внешний код сам подтягивает `orderContext` или `productContext`.

Если внешний код работает напрямую с `handleMessage`, для заказа можно передавать специальные результаты поиска:

- `{ lookupStatus: "not_found" }` - бот объяснит, что заказ не найден, и попросит другой идентификатор.
- `{ lookupStatus: "multiple" }` - бот попросит точный номер заказа или трек, чтобы не перепутать.
- `{ requiresOperator: true, operatorReason: "..." }` - бот сразу передаст заказ оператору.
