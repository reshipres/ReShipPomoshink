import { extractOrderHint, looksLikeLookupFragment, normalizeText } from './normalize.js';

export const INTENTS = {
  GREETING: 'greeting',
  ASSISTANT_IDENTITY: 'assistant_identity',
  ACKNOWLEDGEMENT: 'acknowledgement',
  HUMAN_REQUESTED: 'human_requested',
  ORDER_STATUS: 'order_status',
  ORDER_LOOKUP_FOLLOWUP: 'order_lookup_followup',
  ORDER_SWITCH: 'order_switch',
  ORDER_CHANGE: 'order_change',
  BILLING_ISSUE: 'billing_issue',
  DEFECT_OR_DAMAGE: 'defect_or_damage',
  REFUND_OR_RETURN: 'refund_or_return',
  ANGRY_CUSTOMER: 'angry_customer',
  DELIVERY_TERMS: 'delivery_terms',
  AVAILABILITY: 'availability',
  PRICE_DISCOUNT: 'price_discount',
  PRODUCT_ADVICE: 'product_advice',
  PAYMENT: 'payment',
  PICKUP: 'pickup',
  MODDING: 'modding',
  WARRANTY_OR_RETURN: 'warranty_or_return',
  LOYALTY: 'loyalty',
  ACCOUNT: 'account',
  ORDER_HELP: 'order_help',
  OTHER: 'other',
};

export function classifyMessage(message, session = {}) {
  const text = normalizeText(message);
  const lastIntent = session.lastIntent || null;

  const actionable = hasActionableRequest(message);

  if (!actionable && /^(привет|здравствуй(?:те)?|добрый день|добрый вечер|доброе утро|hello|hi|hey)(?=$|\s)/u.test(text)) {
    return match(INTENTS.GREETING, 0.98);
  }

  if (!actionable && /(как тебя зовут|кто ты|что ты умеешь|чем ты можешь помочь|что умеешь|что можешь)/i.test(message)) {
    return match(INTENTS.ASSISTANT_IDENTITY, 0.98);
  }

  if (!actionable && /^(спасибо|благодарю|ок|окей|понял|понятно|ясно)(!?|\.)*$/i.test(message.trim())) {
    return match(INTENTS.ACKNOWLEDGEMENT, 0.96);
  }

  if (/(оператор|менеджер|жив(ой|ого)|человек|поддержк|позови|свяжите)/i.test(message)) {
    return match(INTENTS.HUMAN_REQUESTED, 0.99);
  }

  if (/(изменить|поменять|сменить|исправить|заменить|перенести).*(адрес|телефон|номер|получател|заказ|пвз|пункт выдачи|доставк)|отменить заказ|отмена заказа|объединить заказ|добавить.*к заказ/i.test(message)) {
    return match(INTENTS.ORDER_CHANGE, 0.98);
  }

  if (/(не проходит оплат|не могу оплат|не получается оплат|ошибка оплат|оплатил.*статус|статус.*не измен|деньги списал|списали.*деньги|двойн(ая|ое).*оплат|плат[её]ж.*не вижу|чек.*не приш)/i.test(message)) {
    return match(INTENTS.BILLING_ISSUE, 0.98);
  }

  if (/(брак|сломал|сломано|не работает|нерабоч|поврежд|разбит|дефект)/i.test(message)) {
    return match(INTENTS.DEFECT_OR_DAMAGE, 0.98);
  }

  if (/(потерял|не приш(ел|ёл)|верните деньги|хочу вернуть|оформить возврат|обменять|спор|претензи|юрист|суд)/i.test(message)) {
    return match(INTENTS.REFUND_OR_RETURN, 0.96);
  }

  if (/(ужас|обман|сколько можно|надоело|жалоб|отврат)/i.test(message)) {
    return match(INTENTS.ANGRY_CUSTOMER, 0.94);
  }

  if (['order_status', 'delivery_terms'].includes(lastIntent) && /^(другой|другая|другое|другие|еще|ещё|не этот|не эта|не то|другой заказ|другую посылку)(?=$|\s)/i.test(message.trim())) {
    return match(INTENTS.ORDER_SWITCH, 0.95);
  }

  if (lastIntent === 'order_status' && looksLikeLookupFragment(message)) {
    return match(INTENTS.ORDER_LOOKUP_FOLLOWUP, 0.9, { hint: extractOrderHint(message) || message.trim() });
  }

  if (/(оплат|сбп|карта|картой|налож|чек|квитанц)/i.test(message)) return match(INTENTS.PAYMENT, 0.86);
  if (messageLooksLikeHowToOrder(message)) return match(INTENTS.ORDER_HELP, 0.9);
  if (messageLooksLikeDeliveryTerms(message)) return match(INTENTS.DELIVERY_TERMS, 0.88);
  if (messageLooksLikeAvailability(message)) return match(INTENTS.AVAILABILITY, 0.88);
  if (messageLooksLikePrice(message)) return match(INTENTS.PRICE_DISCOUNT, 0.86);
  if (messageLooksLikeProductAdvice(message)) return match(INTENTS.PRODUCT_ADVICE, 0.76);
  if (messageLooksLikeOrder(message)) return match(INTENTS.ORDER_STATUS, 0.9, { hint: extractOrderHint(message) });

  if (/(самовывоз|забрать|адрес|таганск|москва)/i.test(message)) return match(INTENTS.PICKUP, 0.86);
  if (/(моддинг|смазк|микрик|энкодер|свитч)/i.test(message)) return match(INTENTS.MODDING, 0.84);
  if (/(гарант|вернуть|возврат|обмен)/i.test(message)) return match(INTENTS.WARRANTY_OR_RETURN, 0.84);
  if (/(личн(ый|ом).*кабинет|аккаунт|войти|вход|регистрац|парол|профил)/i.test(message)) return match(INTENTS.ACCOUNT, 0.8);
  if (/(бонус|балл|points|реферал|лояльн)/i.test(message)) return match(INTENTS.LOYALTY, 0.8);

  return match(INTENTS.OTHER, 0.45);
}

function match(intent, confidence, extras = {}) {
  return { intent, confidence, ...extras };
}

export function hasActionableRequest(message) {
  return messageLooksLikeOrder(message)
    || messageLooksLikeAvailability(message)
    || messageLooksLikePrice(message)
    || messageLooksLikeProductAdvice(message)
    || messageLooksLikeHowToOrder(message)
    || messageLooksLikeDeliveryTerms(message)
    || /(оплат|самовывоз|забрать|адрес|моддинг|гарант|вернуть|возврат|обмен|оператор|менеджер|помощ)/i.test(message);
}

export function messageLooksLikeOrder(message) {
  if (messageLooksLikeAvailability(message) || messageLooksLikePrice(message) || messageLooksLikeProductAdvice(message)) return false;
  return /(заказ|статус|трек|трек-?номер|сдэк|cdek|достав|где.*посыл|едет|отправ|когда.*приед|когда.*получ)/i.test(message);
}

function messageLooksLikeAvailability(message) {
  return /(в наличии|есть ли|есть\?|когда будет|появится|поступлен|предзаказ|под заказ|ресток|restock|доступен|можно заказать)/i.test(message);
}

function messageLooksLikeHowToOrder(message) {
  return /(как.*(оформ|заказат|купить)|как купить|как оформить заказ|хочу заказать|можно оформить|как происходит заказ)/i.test(message);
}

function messageLooksLikeDeliveryTerms(message) {
  if (extractOrderHint(message)) return false;
  return /(сколько.*(достав|ид[её]т|ехать)|срок.*достав|доставка.*сколько|стоим.*достав|цена.*достав|тариф.*сдэк|доставк[аи].*(москв|росси|регион|город|курьер|пвз))/i.test(message)
    && !/(мой|моего|моем|заказ|трек|статус)/i.test(message);
}

function messageLooksLikePrice(message) {
  return /(цена|стоим|сколько стоит|сколько будет|скидк|промокод|актуальная цена|предварительная цена)/i.test(message);
}

function messageLooksLikeProductAdvice(message) {
  return /(посовету|подскаж.*какой|что лучше|подойдет|совместим|размер|soft|xsoft|mid|свитч|switch|глайды|ковр|мышк|клавиатур)/i.test(message)
    && !messageLooksLikeAvailability(message)
    && !messageLooksLikePrice(message);
}
