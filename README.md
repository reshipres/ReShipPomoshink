# ReShipPomoshink

Отдельное ядро клиентского помощника ReShip.

Цель: быстро улучшать качество ответов бота без фронта, Telegram, Nest и LLM. Здесь лежит только сценарная логика: классификация фразы клиента, безопасный ответ, handoff оператору и тесты на реальные клиентские формулировки.

## Команды

```bash
npm test
npm run eval
npm run analyze:telegram -- /Users/davidbukarov/Downloads/DataExport_2026-06-11.zip
npm run chat
```

## Как устроено

- `src/engine.js` - главный вход: принимает сообщение, контекст заказа/товара и возвращает ответ.
- `src/intents.js` - детерминированная классификация фраз.
- `src/replies.js` - тексты ответов и форматирование статуса заказа.
- `fixtures/client-phrases.json` - фразы клиентов с ожидаемыми интентами.
- `fixtures/conversation-scenarios.json` - короткие клиентские диалоги без лишних повторных вопросов.
- `tests/engine.test.js` - регрессия, чтобы бот не деградировал.
- `scripts/analyze-telegram-export.mjs` - локальный агрегированный анализ Telegram export без сохранения сырого текста.

## Интеграция

Сайт или Telegram-адаптер должны:

1. Передать текст клиента в `handleMessage`.
2. Если есть `contextRequest`, подтянуть заказ/товар из своей базы.
3. Повторно вызвать `handleMessage` с `orderContext` или `productContext`.
4. Если `needsHandoff === true`, создать тикет или позвать оператора.

Для заказа адаптер может передать специальные результаты поиска:

- `{ lookupStatus: "not_found" }` - бот объяснит, что заказ не найден, и попросит другой идентификатор.
- `{ lookupStatus: "multiple" }` - бот попросит точный номер заказа или трек, чтобы не перепутать.
- `{ requiresOperator: true, operatorReason: "..." }` - бот сразу передаст заказ оператору.
