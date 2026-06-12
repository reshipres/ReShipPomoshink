# ReShipPomoshink

Отдельное ядро клиентского помощника ReShip.

Цель: быстро улучшать качество ответов бота без фронта и тяжелой интеграции с основным сайтом. Здесь лежит сценарная логика, гибридная LLM-обертка, learning/analytics и минимальный Telegram-адаптер для запуска актуального brain в боте.

## Команды

```bash
npm test
npm run eval
npm run analyze:telegram -- /Users/davidbukarov/Downloads/DataExport_2026-06-11.zip
npm run learn:report
npm run learn:report -- --json
npm run chat
npm run chat -- --anonymous
npm run chat -- --hybrid
npm run chat -- --hybrid --learn
npm run chat -- --hybrid --analytics
npm run telegram
```

## Как устроено

- `src/engine.js` - низкоуровневое ядро: принимает сообщение, контекст заказа/товара и возвращает ответ.
- `src/customerAdapter.js` - клиентский вход: сам подтягивает заказ/товар из переданных системных данных и повторно вызывает ядро.
- `src/hybridSupportBrain.js` - гибридная обертка: сценарный слой остается главным, mock LLM включается только на неуверенных/сложных сообщениях.
- `src/llmFallback.js` - контракт fallback-модели: строгий JSON, mock-клиент и проверка безопасности решения.
- `src/supportFacts.js` - RAG-lite факты ReShip, которыми ограничивается fallback.
- `src/learningLogger.js` - редактированные JSONL-события для analytics-журнала и learning inbox.
- `src/learningReport.js` - отчет по learning inbox: группирует `other`, low-confidence, handoff и расхождения LLM/сценария в backlog правил.
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
- `tests/hybridSupportBrain.test.js` - проверка mock LLM, shadow/prod режима и learning inbox.
- `scripts/analyze-telegram-export.mjs` - локальный агрегированный анализ Telegram export без сохранения сырого текста.
- `scripts/telegram-bot.mjs` - live Telegram entrypoint поверх `handleHybridCustomerMessage`.

## Telegram запуск

```bash
cp .env.example .env
# заполнить TELEGRAM_BOT_TOKEN, при необходимости OPERATOR_CHAT_ID
npm run telegram
```

По умолчанию Telegram-бот запускается в безопасном режиме:

- использует текущий сценарный brain и mock LLM в shadow-режиме;
- пишет редактированные analytics/learning события в `learning/events` и `learning/inbox`;
- не подмешивает тестовые `fixtures` как реальные заказы/товары;
- если `OPERATOR_CHAT_ID` задан, при handoff отправляет оператору редактированное уведомление.

Чтобы включить реальный OpenAI fallback, добавьте в `.env`:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
LLM_SHADOW=true
```

`LLM_SHADOW=true` означает, что OpenAI вызывается и логируется, но клиент получает сценарный ответ. Для боевого применения fallback-ответов нужно отдельно поставить `LLM_SHADOW=false`; даже тогда ответ применится только если прошел проверку фактов, confidence и safety.

Чтобы подключить реальные данные без изменения кода, можно указать JSON-массивы:

```bash
RESHIP_ORDERS_JSON=/absolute/path/orders.json
RESHIP_PRODUCTS_JSON=/absolute/path/products.json
```

Для продакшена вместо JSON нужно заменить этот слой на загрузку заказов/товаров из БД/API ReShip, оставив вызов `handleHybridCustomerMessage` тем же.

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

Для гибридного режима используйте `handleHybridCustomerMessage`. Без API-ключа fallback имитируется mock LLM. Для реального OpenAI используйте `createOpenAiLlmClient`; он вызывает Responses API со Structured Outputs и возвращает тот же JSON-контракт, который затем проверяется safety-слоем.

```js
import { handleHybridCustomerMessage } from './src/index.js';

const result = await handleHybridCustomerMessage({
  message: 'а вот это вообще как работает',
  session,
  customer,
  orders,
  products,
  source: 'telegram',
  analytics: { enabled: true },
  learning: { enabled: true },
});
```

```js
import { createOpenAiLlmClient, handleHybridCustomerMessage } from './src/index.js';

const result = await handleHybridCustomerMessage({
  message,
  session,
  customer,
  orders,
  products,
  llm: {
    client: createOpenAiLlmClient(),
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    shadow: true,
  },
});
```

По умолчанию гибрид работает в shadow-режиме: LLM-решение сохраняется в `result.llmFallback`, но клиент получает сценарный ответ. Чтобы разрешить fallback-ответ, передайте `llm: { shadow: false }`; даже тогда ответ применяется только если он прошел проверку фактов, confidence и safety.

Сайт или Telegram-адаптер должны:

1. Передать текст клиента, `session`, известного `customer`, массив заказов и товаров в `handleCustomerMessage`.
2. Сохранить `result.nextSession` для следующего сообщения клиента.
3. Показать `result.answer` клиенту.
4. Если `needsHandoff === true`, создать тикет или позвать оператора.

Для гибридной интеграции шаги те же, но вызывайте `handleHybridCustomerMessage` и сохраняйте `result.analyticsEvent`. Если включен `analytics.enabled`, каждый диалог пишется в `learning/events/*.jsonl`. Если включен `learning.enabled`, кандидаты для обучения пишутся в `learning/inbox/*.jsonl`. Оба каталога игнорируются git.

Цикл самообучения сценарного слоя:

1. Запустить бота в гибридном режиме с `analytics.enabled` и `learning.enabled`.
2. Накопить полный журнал в `learning/events/*.jsonl` и кандидатов правил в `learning/inbox/*.jsonl`; в них хранится редактированный текст и метаданные intent/confidence/handoff/outcome, без телефонов, email, ссылок и номеров заказов.
3. Выполнить `npm run learn:report` или `npm run learn:report -- --json`. Для полного analytics-журнала можно указать каталог: `npm run learn:report -- learning/events`.
4. Взять повторяющиеся группы из `Rule backlog` и `LLM transitions`, вручную решить: новое правило, новая фикстура, новый support fact или корректный handoff оператору.
5. Добавлять в код только обобщенное правило и синтетическую фразу, не реальные клиентские сообщения.

`handleMessage` остается доступен для низкоуровневых тестов и кастомной интеграции, где внешний код сам подтягивает `orderContext` или `productContext`.

Если внешний код работает напрямую с `handleMessage`, для заказа можно передавать специальные результаты поиска:

- `{ lookupStatus: "not_found" }` - бот объяснит, что заказ не найден, и попросит другой идентификатор.
- `{ lookupStatus: "multiple" }` - бот попросит точный номер заказа или трек, чтобы не перепутать.
- `{ requiresOperator: true, operatorReason: "..." }` - бот сразу передаст заказ оператору.
