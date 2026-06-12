import { INTENTS } from './intents.js';
import { factIds } from './supportFacts.js';
import { normalizeText } from './normalize.js';

export const SUPPORT_LLM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'intent',
    'action',
    'answer',
    'needsHandoff',
    'handoffReason',
    'usedFacts',
    'confidence',
    'reason',
  ],
  properties: {
    intent: { type: 'string' },
    action: {
      type: 'string',
      enum: ['answer', 'ask_clarifying_question', 'handoff_to_operator'],
    },
    answer: { type: 'string' },
    needsHandoff: { type: 'boolean' },
    handoffReason: { type: ['string', 'null'] },
    usedFacts: {
      type: 'array',
      items: { type: 'string' },
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    reason: { type: 'string' },
  },
};

export async function runLlmFallback({
  message,
  deterministicResult,
  facts = [],
  client,
  model = 'mock-support-brain-v1',
} = {}) {
  const llmClient = client || createMockLlmClient();

  try {
    const rawDecision = await llmClient({
      message,
      deterministicResult,
      facts,
      factIds: factIds(facts),
      schema: SUPPORT_LLM_SCHEMA,
      model,
    });
    const decision = normalizeLlmDecision(rawDecision, facts, deterministicResult);

    return {
      status: 'ok',
      model,
      decision,
    };
  } catch (error) {
    return {
      status: 'error',
      model,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createMockLlmClient() {
  return async ({ message, deterministicResult, facts }) => {
    const text = normalizeText(message);
    const ids = new Set(factIds(facts));

    if (deterministicResult?.needsHandoff || deterministicResult?.action === 'handoff_to_operator') {
      return {
        intent: deterministicResult.intent || INTENTS.OTHER,
        action: 'handoff_to_operator',
        answer: deterministicResult.answer || 'Передаю вопрос оператору, чтобы проверили вручную.',
        needsHandoff: true,
        handoffReason: deterministicResult.handoffReason || 'operator_required',
        usedFacts: selectUsedFacts(ids, ['handoff_policy', 'support_scope']),
        confidence: Math.max(0.78, deterministicResult.confidence || 0.78),
        reason: 'Сценарный слой уже определил, что нужен оператор.',
      };
    }

    if (ids.has('payment_policy') && /(рассроч|долями|сплит|налож|получени|оплат|сбп|карт)/i.test(text)) {
      return {
        intent: INTENTS.PAYMENT,
        action: 'answer',
        answer: 'Оплата сейчас доступна на сайте картой МИР или через СБП. Наложенный платеж, оплата при получении, рассрочка, Долями и Сплит не входят в стандартные способы оплаты. Если деньги списались, а заказ не обновился, передам оператору.',
        needsHandoff: false,
        handoffReason: null,
        usedFacts: selectUsedFacts(ids, ['payment_policy', 'no_invention_policy']),
        confidence: 0.86,
        reason: 'Вопрос совпал с правилами оплаты.',
      };
    }

    if (ids.has('delivery_policy') && /(достав|отправ|росси|регион|сдэк|cdek|курьер|пвз|срок)/i.test(text)) {
      return {
        intent: INTENTS.DELIVERY_TERMS,
        action: 'answer',
        answer: 'По России отправляем через CDEK: до пункта выдачи или курьером, если город доступен в CDEK. Точный срок и стоимость считаются в корзине по городу и адресу. Отправка после оплаты обычно занимает 1-3 рабочих дня.',
        needsHandoff: false,
        handoffReason: null,
        usedFacts: selectUsedFacts(ids, ['delivery_policy', 'no_invention_policy']),
        confidence: 0.84,
        reason: 'Вопрос совпал с правилами доставки.',
      };
    }

    if (ids.has('pickup_policy') && /(самовывоз|забрать|адрес|москва|таганск)/i.test(text)) {
      return {
        intent: INTENTS.PICKUP,
        action: 'answer',
        answer: 'Самовывоз в Москве: Гончарный проезд, 8/40, метро Таганская. Получать заказ можно после подтверждения готовности.',
        needsHandoff: false,
        handoffReason: null,
        usedFacts: selectUsedFacts(ids, ['pickup_policy', 'no_invention_policy']),
        confidence: 0.84,
        reason: 'Вопрос совпал с правилами самовывоза.',
      };
    }

    if (ids.has('warranty_policy') && /(гарант|возврат|обмен|брак|дефект|вернуть|слом)/i.test(text)) {
      return {
        intent: INTENTS.WARRANTY_OR_RETURN,
        action: /брак|дефект|слом|обмен|вернуть|возврат/i.test(text)
          ? 'handoff_to_operator'
          : 'answer',
        answer: 'Гарантия зависит от конкретного товара и производителя. Возврат товара надлежащего качества возможен в течение 7 дней при сохранении товарного вида и упаковки. Брак, повреждение, обмен, гарантию производителя или спорный случай передам оператору.',
        needsHandoff: /брак|дефект|слом|обмен|вернуть|возврат/i.test(text),
        handoffReason: /брак|дефект|слом|обмен|вернуть|возврат/i.test(text) ? 'warranty_or_return_review' : null,
        usedFacts: selectUsedFacts(ids, ['warranty_policy', 'handoff_policy']),
        confidence: 0.82,
        reason: 'Вопрос совпал с правилами гарантии/возврата.',
      };
    }

    if (ids.has('order_lookup_policy') && /(заказ|статус|трек|накладн|номер|телефон|фамил|получател)/i.test(text)) {
      return {
        intent: INTENTS.ORDER_STATUS,
        action: 'ask_clarifying_question',
        answer: 'Проверю заказ. Пришлите номер заказа, трек CDEK, телефон или фамилию/ФИО получателя. Если найдено несколько заказов, попрошу уточнить точный номер или трек.',
        needsHandoff: false,
        handoffReason: null,
        usedFacts: selectUsedFacts(ids, ['order_lookup_policy', 'no_invention_policy']),
        confidence: 0.8,
        reason: 'Нужен идентификатор заказа, угадывать нельзя.',
      };
    }

    return {
      intent: INTENTS.OTHER,
      action: 'ask_clarifying_question',
      answer: 'Уточните, пожалуйста, вопрос: это про заказ, товар, оплату, доставку, самовывоз, гарантию или возврат? Если случай нестандартный, передам оператору.',
      needsHandoff: false,
      handoffReason: null,
      usedFacts: selectUsedFacts(ids, ['support_scope', 'no_invention_policy']),
      confidence: 0.72,
      reason: 'Недостаточно данных для безопасного конкретного ответа.',
    };
  };
}

export function normalizeLlmDecision(rawDecision, facts = [], deterministicResult = {}) {
  const raw = rawDecision && typeof rawDecision === 'object' ? rawDecision : {};
  const allowedIntents = new Set(Object.values(INTENTS));
  const allowedActions = new Set(['answer', 'ask_clarifying_question', 'handoff_to_operator']);

  const intent = allowedIntents.has(raw.intent) ? raw.intent : deterministicResult.intent || INTENTS.OTHER;
  const action = allowedActions.has(raw.action) ? raw.action : 'ask_clarifying_question';
  const answer = String(raw.answer || '').trim();
  const needsHandoff = Boolean(raw.needsHandoff || action === 'handoff_to_operator');
  const handoffReason = needsHandoff
    ? String(raw.handoffReason || deterministicResult.handoffReason || 'llm_handoff').trim()
    : null;
  const availableFacts = new Set(factIds(facts));
  const usedFacts = Array.isArray(raw.usedFacts)
    ? raw.usedFacts.map((id) => String(id)).filter((id) => availableFacts.has(id))
    : [];
  const confidence = clampConfidence(raw.confidence);
  const reason = String(raw.reason || '').trim() || 'LLM fallback decision.';

  return {
    intent,
    action,
    answer,
    needsHandoff,
    handoffReason,
    usedFacts,
    confidence,
    reason,
  };
}

export function isSafeLlmDecision(decision, facts = [], { minConfidence = 0.74 } = {}) {
  if (!decision || typeof decision !== 'object') return false;
  if (!decision.answer || decision.answer.length > 1200) return false;
  if (!Number.isFinite(decision.confidence) || decision.confidence < minConfidence) return false;
  if (!Array.isArray(decision.usedFacts) || decision.usedFacts.length === 0) return false;

  const availableFacts = new Set(factIds(facts));
  if (!decision.usedFacts.every((id) => availableFacts.has(id))) return false;
  if (/\b(точно гарантирую|100%|безусловно|обещаю|скидка будет|вернем деньги точно)\b/i.test(decision.answer)) return false;

  return true;
}

function selectUsedFacts(availableIds, preferredIds) {
  const selected = preferredIds.filter((id) => availableIds.has(id));
  if (selected.length) return selected;
  return [...availableIds].slice(0, 2);
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}
