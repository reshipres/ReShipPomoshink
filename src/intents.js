import {
  extractOrderHint,
  extractProductSlug,
  hasExternalUrl,
  hasPhoneNumber,
  hasUrl,
  looksLikeDeliveryDataPayload,
  looksLikeLookupFragment,
  looksLikeProductReference,
  looksLikeStandaloneOrderLookup,
  normalizeText,
} from './normalize.js';

export const INTENTS = {
  GREETING: 'greeting',
  ASSISTANT_IDENTITY: 'assistant_identity',
  ACKNOWLEDGEMENT: 'acknowledgement',
  HUMAN_REQUESTED: 'human_requested',
  ORDER_STATUS: 'order_status',
  ORDER_LOOKUP_FOLLOWUP: 'order_lookup_followup',
  ORDER_SWITCH: 'order_switch',
  ORDER_CHANGE: 'order_change',
  DELIVERY_DATA: 'delivery_data',
  BILLING_ISSUE: 'billing_issue',
  SITE_ISSUE: 'site_issue',
  CUSTOM_ORDER_REQUEST: 'custom_order_request',
  DEFECT_OR_DAMAGE: 'defect_or_damage',
  REFUND_OR_RETURN: 'refund_or_return',
  ANGRY_CUSTOMER: 'angry_customer',
  DELIVERY_TERMS: 'delivery_terms',
  AVAILABILITY: 'availability',
  PRICE_DISCOUNT: 'price_discount',
  PRODUCT_ADVICE: 'product_advice',
  PRODUCT_SEARCH: 'product_search',
  PAYMENT: 'payment',
  REVIEW: 'review',
  INTERNATIONAL_DELIVERY: 'international_delivery',
  PICKUP: 'pickup',
  MODDING: 'modding',
  WARRANTY_OR_RETURN: 'warranty_or_return',
  LOYALTY: 'loyalty',
  ACCOUNT: 'account',
  ORDER_HELP: 'order_help',
  GENERAL_HELP: 'general_help',
  OTHER: 'other',
};

export function classifyMessage(message, session = {}) {
  const text = normalizeText(message);
  const lastIntent = session.lastIntent || null;
  const pendingRequest = session.pendingRequest || null;

  const actionable = hasActionableRequest(message);

  if (!actionable && messageLooksLikeGeneralHelp(message)) {
    return match(INTENTS.GENERAL_HELP, 0.82);
  }

  if (!actionable && /^(привет|приветствую|здравствуй(?:те)?|добрый день|добрый вечер|доброе утро|доброй ночи|hello|hi|hey)(?=$|\s)/u.test(text)) {
    return match(INTENTS.GREETING, 0.98);
  }

  if (!actionable && /(как тебя зовут|кто ты|что ты умеешь|чем ты можешь помочь|что умеешь|что можешь)/i.test(message)) {
    return match(INTENTS.ASSISTANT_IDENTITY, 0.98);
  }

  if (!actionable && /^(спасибо|благодарю|ок|окей|понял|понятно|ясно)(!?|\.)*$/i.test(message.trim())) {
    return match(INTENTS.ACKNOWLEDGEMENT, 0.96);
  }

  if (/(оператор|менеджер|жив(ой|ого)|человек|поддержк|позови|свяжите|жду.*ответ|жду.*информац|ожидаю.*ответ|нет.*ответа|вашего ответа|не отвечают|не ответили|ответьте|когда ответите|обратн.*связ)/i.test(message)) {
    return match(INTENTS.HUMAN_REQUESTED, 0.99);
  }

  if (pendingRequest?.type === 'general') {
    const topicIntent = classifyGeneralTopicReply(text);
    if (topicIntent) return match(topicIntent, 0.9);
  }

  if (messageLooksLikeDeliveryTrackingQuestion(message)) {
    return match(INTENTS.ORDER_STATUS, 0.94, { hint: extractOrderHint(message) });
  }

  if (looksLikeDeliveryDataPayload(message)) {
    return match(INTENTS.DELIVERY_DATA, 0.96);
  }

  if (/(изменить|поменять|сменить|исправить|заменить|перенести).*(адрес|телефон|номер|получател|заказ|пвз|пункт выдачи|доставк|цвет|товар|модель|позици)|отменить заказ|отмена заказа|объединить заказ|добавить.*к заказ|давайте заменим/i.test(message)) {
    return match(INTENTS.ORDER_CHANGE, 0.98);
  }

  if (messageLooksLikeSiteIssue(message)) {
    return match(INTENTS.SITE_ISSUE, 0.96);
  }

  if (/(не проходит оплат|не могу оплат|не получается оплат|ошибка оплат|оплатил.*статус|статус.*не измен|деньги списал|списали.*деньги|двойн(ая|ое).*оплат|плат[её]ж.*не вижу|чек.*не приш|деньги.*(не.*вернул|не.*пришл|не.*компенс|возвращ)|когда.*деньги|деньги.*назад)/i.test(message)) {
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

  if (pendingRequest?.type === 'order' && looksLikeLookupFragment(message)) {
    return match(INTENTS.ORDER_LOOKUP_FOLLOWUP, 0.92, { hint: extractOrderHint(message) || message.trim() });
  }

  if (pendingRequest?.type === 'product' && looksLikeProductReference(message)) {
    const intent = pendingRequest.intent === INTENTS.PRICE_DISCOUNT
      ? INTENTS.PRICE_DISCOUNT
      : pendingRequest.intent === INTENTS.PRODUCT_SEARCH
        ? INTENTS.PRODUCT_SEARCH
        : INTENTS.AVAILABILITY;
    return match(intent, 0.9, { hint: extractProductSlug(message) || message.trim() });
  }

  if (['order_status', 'delivery_terms'].includes(lastIntent) && /^(?:а\s+)?(другой|другая|другое|другие|еще|ещё|не этот|не эта|не то|другой заказ|другую посылку)(?:$|\s|\?|\!|\.)/i.test(message.trim())) {
    return match(INTENTS.ORDER_SWITCH, 0.95);
  }

  if (lastIntent === 'order_status' && looksLikeLookupFragment(message)) {
    return match(INTENTS.ORDER_LOOKUP_FOLLOWUP, 0.9, { hint: extractOrderHint(message) || message.trim() });
  }

  if (!actionable && messageLooksLikeAcknowledgement(message)) {
    return match(INTENTS.ACKNOWLEDGEMENT, 0.96);
  }

  if (messageLooksLikeCustomOrderRequest(message)) return match(INTENTS.CUSTOM_ORDER_REQUEST, 0.9);
  if (messageLooksLikeInternationalDelivery(message)) return match(INTENTS.INTERNATIONAL_DELIVERY, 0.9);
  if (looksLikeStandaloneOrderLookup(message)) return match(INTENTS.ORDER_STATUS, 0.88, { hint: extractOrderHint(message) || message.trim() });
  if (messageLooksLikeReview(message)) return match(INTENTS.REVIEW, 0.88);
  if (messageLooksLikeProductSearch(message)) return match(INTENTS.PRODUCT_SEARCH, 0.86, { hint: extractProductHint(message) });
  if (/(оплат|сбп|карта|картой|номер карты|перевод|налож|чек|квитанц)/i.test(message)) return match(INTENTS.PAYMENT, 0.86);
  if (messageLooksLikeHowToOrder(message)) return match(INTENTS.ORDER_HELP, 0.9);
  if (messageLooksLikeDeliveryTerms(message)) return match(INTENTS.DELIVERY_TERMS, 0.88);
  if (messageLooksLikeAvailability(message)) return match(INTENTS.AVAILABILITY, 0.88, { hint: extractProductHint(message) });
  if (messageLooksLikePrice(message)) return match(INTENTS.PRICE_DISCOUNT, 0.86, { hint: extractProductHint(message) });
  if (messageLooksLikeProductAdvice(message)) return match(INTENTS.PRODUCT_ADVICE, 0.76);
  if (looksLikeShortProductReference(message)) return match(INTENTS.AVAILABILITY, 0.72, { hint: extractProductHint(message) });
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

function classifyGeneralTopicReply(text) {
  if (!text || text.length > 80 || text.split(/\s+/).length > 5) return null;

  if (/^(заказ|заказы|мой заказ|статус|трек|трек номер|накладная|посылка|доставка заказа)$/i.test(text)) {
    return INTENTS.ORDER_STATUS;
  }

  if (/^(товар|товары|наличие|остатки|в наличии|модель|модели|карточка товара)$/i.test(text)) {
    return INTENTS.AVAILABILITY;
  }

  if (/^(цена|стоимость|сколько стоит|скидка|промокод|акция)$/i.test(text)) {
    return INTENTS.PRICE_DISCOUNT;
  }

  if (/^(доставка|сроки|срок доставки|сколько доставка|курьер|сдэк|cdek)$/i.test(text)) {
    return INTENTS.DELIVERY_TERMS;
  }

  if (/^(оплата|оплатить|платеж|платежи|сбп|карта|чек)$/i.test(text)) {
    return INTENTS.PAYMENT;
  }

  if (/^(возврат|обмен|гарантия|брак|ремонт)$/i.test(text)) {
    return INTENTS.WARRANTY_OR_RETURN;
  }

  if (/^(самовывоз|забрать|адрес)$/i.test(text)) {
    return INTENTS.PICKUP;
  }

  if (/^(отзыв|отзывы)$/i.test(text)) {
    return INTENTS.REVIEW;
  }

  return null;
}

export function hasActionableRequest(message) {
  return messageLooksLikeOrder(message)
    || looksLikeStandaloneOrderLookup(message)
    || looksLikeDeliveryDataPayload(message)
    || messageLooksLikeAvailability(message)
    || messageLooksLikePrice(message)
    || messageLooksLikeProductAdvice(message)
    || messageLooksLikeHowToOrder(message)
    || messageLooksLikeDeliveryTerms(message)
    || messageLooksLikeSiteIssue(message)
    || messageLooksLikeCustomOrderRequest(message)
    || messageLooksLikeInternationalDelivery(message)
    || messageLooksLikeReview(message)
    || messageLooksLikeProductSearch(message)
    || /(оплат|самовывоз|забрать|адрес|моддинг|гарант|вернуть|возврат|обмен|оператор|менеджер|помощ)/i.test(message);
}

export function messageLooksLikeOrder(message) {
  if (messageLooksLikeAvailability(message) || messageLooksLikePrice(message) || messageLooksLikeProductAdvice(message)) return false;
  return Boolean(extractOrderHint(message))
    || hasPhoneNumber(message)
    || /(заказ|статус|трек|трек-?номер|накладн|сдэк|cdek|достав|где.*посыл|едет|отправ|когда.*приед|когда.*получ|когда.*отправ)/i.test(message);
}

function messageLooksLikeAvailability(message) {
  return /(в наличии|в нале|на складе|есть ли|есть\?|есть\s+(черн|бел|красн|син|розов|сер|фиолет|желт|зел|оранж)|какие\s+(цвета|расцветки)|какой\s+цвет|осталось|остаток|когда будет|появится|поступлен|поставка|завоз|дроп|предзаказ|под заказ|ресток|restock|доступен|можно заказать|будете завозить|привезете|привезёте)/i.test(message);
}

function messageLooksLikeHowToOrder(message) {
  return /(как.*(оформ|заказат|купить)|как купить|как оформить заказ|хочу заказать|хочу купить|можно оформить|можно купить|как происходит заказ|давайте оформим|давайте закажем|тогда возьму|тогда беру|беру)/i.test(message);
}

function messageLooksLikeDeliveryTerms(message) {
  if (extractOrderHint(message)) return false;
  return /(сколько.*(достав|ид[её]т|ехать|ждать|времени|дней)|через сколько|в течени[еи] какого|как долго|долго.*ждать|срок.*(достав|отправ|предзаказ|ожидан)|сроки|будет идти|доставка.*сколько|стоим.*достав|цена.*достав|тариф.*сдэк|доставк[аи].*(москв|росси|регион|город|курьер|пвз))/i.test(message)
    && !/(мой|моего|моем|(^|\s)заказ($|\s)|трек|статус)/i.test(message);
}

function messageLooksLikePrice(message) {
  return /(цена|стоим|стоить|стоят|сколько.{0,80}(стоит|стоят|стоить|цена|цены)|сколько будет|будет стоить|скидк|промокод|актуальная цена|предварительная цена)/i.test(message);
}

function messageLooksLikeProductAdvice(message) {
  return /(посовету|подскаж.*какой|что лучше|подойдет|совместим|размер|soft|xsoft|mid|свитч|switch|глайды|ковр|мышк|клавиатур)/i.test(message)
    && !messageLooksLikeAvailability(message)
    && !messageLooksLikePrice(message);
}

function messageLooksLikeProductSearch(message) {
  return /(не могу найти|не наш[её]л|не вижу|не показывает|не показывается|пропал.*(с сайта|из поиска)|в поиске|на сайте).{0,80}(товар|модель|мыш|ковр|клавиатур|глайд|свитч|его|ее|её)|(?:товар|модель|мыш|ковр|клавиатур|глайд|свитч).{0,80}(не могу найти|не наш[её]л|не вижу|не показывает|не показывается|пропал)/i.test(message)
    || (/(не могу найти|не наш[её]л|не вижу|не показывает|не показывается|пропал|в поиске|на сайте)/i.test(message) && looksLikeProductReference(message));
}

function messageLooksLikeReview(message) {
  return /(где|как|куда|можно).{0,40}(оставить|оставлять|написать|посмотреть).{0,40}(отзыв|отзывы|обзор)|отзыв(ы)?.{0,50}(оставить|оставлять|написать|посмотреть|не вижу|не отображ|не дает|не даёт|где|куда)|(?:оставить|оставлять|написать|посмотреть).{0,40}(отзыв|отзывы|обзор)/i.test(message);
}

function messageLooksLikeInternationalDelivery(message) {
  return /(беларус|рб\b|казахстан|снг|международн|за границ|доставк.*(минск|алматы|астан|бишкек|ереван|тбилиси)|нужен.*белорусск.*номер)/i.test(message);
}

function messageLooksLikeAcknowledgement(message) {
  const text = normalizeText(message);
  if (!text || /(не понял|не поняла|не понимаю|не понятно|непонятно)/i.test(message)) return false;

  return /^(да|нет|ага|угу|ок+|оке+й+|окей|хорошо|ладно|понял[а]?|понятно|ясно|принял[а]?|верно|спасибо|спс|благодарю|супер|отлично|договорились|ничего страшного|без проблем|извините|прошу прощения|подумаю|напишу|хорошего дня|хорошего вечера|большое спасибо|спасибо большое|спасибо за [a-zа-я0-9\\s-]{3,80}|спасибо большое за [a-zа-я0-9\\s-]{3,80}|большое спасибо за [a-zа-я0-9\\s-]{3,80}|благодарю за [a-zа-я0-9\\s-]{3,80})(\s+(вам|тебе|большое|спасибо|понял[а]?|окей|хорошо|супер|отлично|дня|вечера))*$/i.test(text);
}

function messageLooksLikeGeneralHelp(message) {
  return /((можете|сможете|можно).{0,30}(подсказать|сказать|уточнить)|хотел(ось)?\s+(узнать|спросить|уточнить)|есть вопрос|вопрос по)/i.test(message);
}

function messageLooksLikeSiteIssue(message) {
  return /(сайт|корзин|оформлен|оформить|оформля|личн(ый|ом).*кабинет|промокод|кнопк).*(не работает|ошибк|не могу|не получается|не дает|не даёт|не открывается|не отображ|не видно|трабл|проблем)|не могу.*(оформить|заказать|положить.*корзин)|ошибка.*(сайт|корзин|оформ|оплат)/i.test(message);
}

function messageLooksLikeDeliveryTrackingQuestion(message) {
  const hint = extractOrderHint(message);
  if (!hint) return false;

  const text = normalizeText(message);
  const words = text.split(/\s+/).filter(Boolean);
  const shortCdekLookup = words.length <= 3 && /\b(сдэк|cdek|трек|накладная|накладн)\b/i.test(text);

  return shortCdekLookup
    || /(что\s+с|где|статус|трек|накладн|движен|обновля|обновит|завис|едет|приед|посылк|заказ|когда|долго)/i.test(message);
}

function messageLooksLikeCustomOrderRequest(message) {
  if (hasExternalUrl(message) && /(заказ|заказать|купить|выкуп|можно|сколько|цена|размер|цвет)/i.test(message)) return true;
  if (hasUrl(message) && !/reship\.pro/i.test(message) && !/(достав|трек|заказ|статус)/i.test(message)) return true;

  return /(выкуп|байер|байеры|poizon|пойзон|taobao|1688|得物|dewu|китай|китая|заказать\s+с|привезти\s+с|товар\s+по\s+ссылк)/i.test(message);
}

function looksLikeShortProductReference(message) {
  const text = normalizeText(message);
  if (!looksLikeProductReference(message)) return false;
  if (hasUrl(message)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 7;
}

function extractProductHint(message) {
  return extractProductSlug(message) || (looksLikeProductReference(message) ? String(message).trim() : null);
}
