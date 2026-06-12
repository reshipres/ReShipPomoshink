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
  ORDER_INFO: 'order_info',
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

  if (messageLooksLikeStartCommand(message)) {
    return match(INTENTS.GREETING, 0.99);
  }

  const actionable = hasActionableRequest(message);

  if (!actionable && messageLooksLikeGeneralHelp(message)) {
    return match(INTENTS.GENERAL_HELP, 0.82);
  }

  if (!actionable && messageLooksLikeConfusion(message)) {
    return match(INTENTS.GENERAL_HELP, 0.78);
  }

  if (!actionable && messageLooksLikeNewcomerEntry(message)) {
    return match(INTENTS.GREETING, 0.94);
  }

  if (!actionable && /^(привет|приветствую|здравствуй(?:те)?|здраствуй(?:те)?|здраствуйте|добрый(?:\s+(день|вечер|утро))?|доброе утро|доброй ночи|hello|hi|hey|ку)(?=$|\s)/u.test(text)) {
    return match(INTENTS.GREETING, 0.98);
  }

  if (!actionable && /(как тебя зовут|кто ты|что ты умеешь|чем ты можешь помочь|что умеешь|что можешь)/i.test(message)) {
    return match(INTENTS.ASSISTANT_IDENTITY, 0.98);
  }

  if (!actionable && /^(спасибо|благодарю|ок|окей|понял|понятно|ясно)(!?|\.)*$/i.test(message.trim())) {
    return match(INTENTS.ACKNOWLEDGEMENT, 0.96);
  }

  if (messageLooksLikeAttentionPing(message)) {
    return match(INTENTS.HUMAN_REQUESTED, 0.94);
  }

  if (/(оператор|менеджер|жив(ой|ого)|человек|поддержк|позови|свяжите|жду.*ответ|жду.*информац|ожидаю.*ответ|нет.*ответа|вашего ответа|не отвечают|не ответили|ответьте|когда ответите|обратн.*связ|^(?:не\s+отвеча(?:ет|ют))$|не\s+могу\s+дописаться|(?:сообщите|напишите|уведомите).{0,40}(?:в\s+)?(?:телеграм|telegram|тг)|(?:обещали|должн[аоы]?|жду|уже.{0,20}жду).{0,80}(?:ничего\s+)?не\s+пришл|не\s+пришли\s+еще.{0,80}(?:жду|месяц|недел|дн|заканчивается|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)|слишком\s+долг(ое|о).{0,40}(ожидан|ждать)|долго.{0,40}(жду|ожидаю|не\s+пришл|нет\s+ответа))/i.test(message)) {
    return match(INTENTS.HUMAN_REQUESTED, 0.99);
  }

  if (pendingRequest?.type === 'general') {
    const topicIntent = classifyGeneralTopicReply(text);
    if (topicIntent) return match(topicIntent, 0.9);
  }

  const menuTopicIntent = classifyShortMenuTopic(text);
  if (menuTopicIntent) {
    return match(menuTopicIntent, 0.9);
  }

  const orderDetail = extractOrderDetailRequest(message);

  if (messageLooksLikeDeliveryTrackingQuestion(message)) {
    return match(INTENTS.ORDER_STATUS, 0.94, {
      hint: extractOrderHint(message),
      ...(orderDetail ? { detail: orderDetail } : {}),
    });
  }

  if (looksLikeDeliveryDataPayload(message)) {
    return match(INTENTS.DELIVERY_DATA, 0.96);
  }

  if (messageLooksLikeSiteIssue(message)) {
    return match(INTENTS.SITE_ISSUE, 0.96);
  }

  if (messageLooksLikeOrderPickupTimingQuestion(message)) {
    return match(INTENTS.ORDER_STATUS, 0.9, { detail: 'delivery_timing' });
  }

  if (messageLooksLikePickupQuestion(message)) {
    return match(INTENTS.PICKUP, 0.9);
  }

  if (messageLooksLikeDeliveryPolicyQuestion(message)) {
    return match(INTENTS.DELIVERY_TERMS, 0.9);
  }

  if (messageLooksLikeOrderNotificationQuestion(message)) {
    return match(INTENTS.ORDER_INFO, 0.88, { detail: 'notification' });
  }

  if (messageLooksLikeOrderInfoQuestion(message)) {
    return match(INTENTS.ORDER_INFO, 0.88);
  }

  if (messageLooksLikePotentialDelayQuestion(message)) {
    return match(INTENTS.ORDER_INFO, 0.82, { detail: 'potential_delay' });
  }

  if (orderDetail && (orderDetail !== 'delivery_timing' || messageCanUseOrderDetailContext(message, session))) {
    const hint = extractOrderHint(message);
    return match(INTENTS.ORDER_STATUS, 0.9, {
      detail: orderDetail,
      ...(hint ? { hint } : {}),
    });
  }

  if (orderDetail === 'delivery_timing' && messageLooksLikeShortTimingFollowup(message)) {
    if (hasExternalUrl(message)) {
      return match(INTENTS.CUSTOM_ORDER_REQUEST, 0.9);
    }

    if (messageLooksLikeProductFulfillmentQuestion(message)) {
      return match(INTENTS.AVAILABILITY, 0.82, { productDetail: 'restock_timing' });
    }

    if (session?.lastProductLookup) {
      return match(INTENTS.AVAILABILITY, 0.82, { productDetail: 'restock_timing' });
    }

    return match(INTENTS.GENERAL_HELP, 0.78, { detail: 'timing_context' });
  }

  if (messageLooksLikeOrderChange(message)) {
    return match(INTENTS.ORDER_CHANGE, 0.98);
  }

  if (messageLooksLikePaymentMethodQuestion(message)) {
    return match(INTENTS.PAYMENT, 0.86);
  }

  if (messageLooksLikeManufacturerWarrantyReview(message)) {
    return match(INTENTS.REFUND_OR_RETURN, 0.94, { detail: 'manufacturer_warranty' });
  }

  if (messageLooksLikeReturnReviewCase(message)) {
    return match(INTENTS.REFUND_OR_RETURN, 0.94, { detail: 'return_condition_review' });
  }

  if (messageLooksLikeWarrantyQuestion(message)) {
    return match(INTENTS.WARRANTY_OR_RETURN, 0.88);
  }

  if (messageLooksLikeMoneyReturnIssue(message) || /(не проходит оплат|не могу оплат|не получается оплат|ошибка оплат|оплатил.*статус|статус.*не измен|деньги списал|списали.*деньги|деньги\s+снял[ио]?|снял[ио]\s+деньги|деньги\s+ушли|двойн(ая|ое).*оплат|плат[её]ж.*не вижу|чек.*не приш|деньги.*(не.*вернул|не.*пришл|не.*компенс|возвращ)|когда.*деньги|деньги.*назад)/i.test(message)) {
    return match(INTENTS.BILLING_ISSUE, 0.98);
  }

  if (messageLooksLikeDeviceDefect(message)) {
    return match(INTENTS.DEFECT_OR_DAMAGE, 0.98);
  }

  if (/(потерял|не приш(ел|ёл)|верните деньги|хочу вернуть|оформить возврат|обменять|спор|претензи|юрист|суд)/i.test(message)) {
    return match(INTENTS.REFUND_OR_RETURN, 0.96);
  }

  if (messageLooksLikeAngryCustomer(message)) {
    return match(INTENTS.ANGRY_CUSTOMER, 0.94);
  }

  if (pendingRequest?.type === 'order' && looksLikeLookupFragment(message)) {
    if (messageLooksLikeMissingOrderIdentifier(message)) {
      return match(INTENTS.ORDER_STATUS, 0.9, { missingIdentifier: true });
    }

    return match(INTENTS.ORDER_LOOKUP_FOLLOWUP, 0.92, { hint: extractOrderHint(message) || message.trim() });
  }

  if (pendingRequest?.type === 'product' && looksLikeProductReference(message)) {
    const intent = pendingRequest.intent === INTENTS.PRICE_DISCOUNT
      ? INTENTS.PRICE_DISCOUNT
      : pendingRequest.intent === INTENTS.PRODUCT_SEARCH
        ? INTENTS.PRODUCT_SEARCH
        : pendingRequest.intent === INTENTS.ORDER_HELP
          ? INTENTS.ORDER_HELP
          : pendingRequest.intent === INTENTS.PRODUCT_ADVICE
            ? INTENTS.PRODUCT_ADVICE
            : INTENTS.AVAILABILITY;
    return match(intent, 0.9, { hint: extractProductSlug(message) || message.trim() });
  }

  if (['order_status', 'delivery_terms'].includes(lastIntent) && /^(?:а\s+)?(другой|другая|другое|другие|еще|ещё|не этот|не эта|не то|другой заказ|другую посылку)(?:$|\s|\?|\!|\.)/i.test(message.trim())) {
    return match(INTENTS.ORDER_SWITCH, 0.95);
  }

  if (lastIntent === INTENTS.ORDER_STATUS && messageLooksLikeDeliveryTerms(message)) {
    return match(INTENTS.DELIVERY_TERMS, 0.88);
  }

  if (lastIntent === 'order_status' && looksLikeLookupFragment(message)) {
    if (messageLooksLikeMissingOrderIdentifier(message)) {
      return match(INTENTS.ORDER_STATUS, 0.9, { missingIdentifier: true });
    }

    return match(INTENTS.ORDER_LOOKUP_FOLLOWUP, 0.9, { hint: extractOrderHint(message) || message.trim() });
  }

  if (session?.lastProductLookup && messageLooksLikeProductLinkFollowup(message)) {
    return match(INTENTS.ORDER_HELP, 0.9);
  }

  if (session?.lastProductLookup && messageLooksLikeProductVariantSelection(message)) {
    return match(INTENTS.AVAILABILITY, 0.88, { hint: message.trim() });
  }

  if (messageLooksLikeAcknowledgement(message)) {
    return match(INTENTS.ACKNOWLEDGEMENT, 0.96);
  }

  if (messageLooksLikeCustomOrderRequest(message)) return match(INTENTS.CUSTOM_ORDER_REQUEST, 0.9);
  if (messageLooksLikeInternationalDelivery(message)) return match(INTENTS.INTERNATIONAL_DELIVERY, 0.9);
  if (looksLikeStandaloneOrderLookup(message)) return match(INTENTS.ORDER_STATUS, 0.88, { hint: extractOrderHint(message) || message.trim() });
  if (messageLooksLikeReview(message)) return match(INTENTS.REVIEW, 0.88);
  if (messageLooksLikeProductSearch(message)) return match(INTENTS.PRODUCT_SEARCH, 0.86, { hint: extractProductHint(message) });
  if (/(оплат|сбп|карта|картой|номер карты|перевод|налож|чек|квитанц)/i.test(message)) return match(INTENTS.PAYMENT, 0.86);
  if (messageLooksLikeHowToOrder(message)) {
    const hint = extractProductHint(message);
    return match(INTENTS.ORDER_HELP, 0.9, hint ? { hint } : {});
  }
  if (messageLooksLikeDeliveryTerms(message)) return match(INTENTS.DELIVERY_TERMS, 0.88);
  if (messageLooksLikePrice(message)) {
    return match(INTENTS.PRICE_DISCOUNT, 0.86, {
      hint: extractProductHint(message),
      priceDetail: extractPriceDetail(message),
    });
  }
  if (messageLooksLikeCatalogBrowsingQuestion(message)) return match(INTENTS.PRODUCT_ADVICE, 0.82);
  if (messageLooksLikeAvailability(message)) {
    return match(INTENTS.AVAILABILITY, 0.88, {
      hint: extractProductHint(message),
      productDetail: extractProductAvailabilityDetail(message),
    });
  }
  if (messageLooksLikeProductAdvice(message)) {
    const hint = extractProductHint(message);
    return match(INTENTS.PRODUCT_ADVICE, 0.76, hint ? { hint } : {});
  }
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

function messageLooksLikeOrderChange(message) {
  return /(изменить|поменять|сменить|исправить|заменить|перенести).*(адрес|телефон|номер|получател|заказ|пвз|пункт выдачи|доставк|цвет|товар|модель|позици)|отменить заказ|отмена заказа|объединить заказ|добавить.*к заказ|давайте заменим|(?:давайте|можно|хочу|нужно|надо|тогда).{0,40}отмен(им|ить|яем|у)|отмен(им|ить|а|яем).{0,30}(заказ|позици|товар)/i.test(message)
    || /(?:можно|могу|хочу|надо|нужно|уже|получится|получиться|получится\s+ли|получиться\s+ли).{0,70}отмен(ить|им|у|а|яем).{0,70}(?:брон|заказ|деньг|позици|товар)|отмен(ить|им|у|а|яем).{0,80}(?:брон|заказ|деньг|позици|товар)/i.test(message)
    || /(?:оплатить|оплачивать|добавить|дозаказать|докупи).{0,80}(?:ещ[её]|дополнительно|плюс).{0,80}(?:товар|позици|наушник|грип|ковр|мыш|клавиатур|рукав)/i.test(message)
    || /(?:посчитать|рассчитать|считать).{0,50}(?:разниц|доплат|перерасч[её]т)/i.test(message)
    || /(?:разниц|доплат).{0,80}(?:отменили|замен|оставляем|дороже|дешевле|позици|товар|заказ)|(?:оставляем|отменили|заменить).{0,80}(?:дороже|дешевле|разниц|доплат)/i.test(message);
}

function messageLooksLikeMoneyReturnIssue(message) {
  return /(?:в\s+какой\s+день|когда|сколько|через\s+сколько).{0,70}(?:(?:деньг|средств).{0,40}(?:вернут|вернутся|верн[её]те|получу|прид[уё]т|придут)|(?:получу|получить|прид[уё]т|придут).{0,40}(?:деньг|средств))|(?:деньг|средств).{0,80}(?:все\s+еще|всё\s+еще|до\s+сих\s+пор|не\s+пришл|не\s+вернул|не\s+вернулись|вернут|вернутся|верн[её]те|назад|сколько\s+вернут|должн[ыо]?\s+прид)|(?:сказали|писали|обещали).{0,80}(?:деньг|средств).{0,80}(?:вернут|вернутся|прид[уё]т|придут)|(?:возмещени|компенсац).{0,120}(?:долг|ожидан|отсутств|товар|заказ|задерж)|(?:деньг|средств).{0,80}(?:не\s+могу\s+вывести|вывести\s+не\s+могу)/i.test(message);
}

function messageLooksLikeStartCommand(message) {
  return /^\/?(start|help|menu)$/i.test(String(message || '').trim());
}

function classifyShortMenuTopic(text) {
  if (!text || text.length > 80 || text.split(/\s+/).length > 5) return null;

  if (/^(доставка|доставки|сроки|срок доставки|сколько доставка|курьер|сдэк|cdek|способы доставки|типы доставки|тип доставки|отправка)$/i.test(text)) {
    return INTENTS.DELIVERY_TERMS;
  }

  if (/^(оплата|оплатить|платеж|платежи|сбп|карта|чек|рассрочка|долями|сплит)$/i.test(text)) {
    return INTENTS.PAYMENT;
  }

  if (/^(самовывоз|забрать|адрес)$/i.test(text)) {
    return INTENTS.PICKUP;
  }

  if (/^(товар|товары|ассортимент|каталог|что есть|что у вас есть|посмотреть товары|хочу посмотреть товары|что продаете)$/i.test(text)) {
    return INTENTS.PRODUCT_ADVICE;
  }

  if (/^(наличие|остатки|в наличии|модель|модели|карточка товара)$/i.test(text)) {
    return INTENTS.AVAILABILITY;
  }

  if (/^(цена|стоимость|сколько стоит|скидка|промокод|акция)$/i.test(text)) {
    return INTENTS.PRICE_DISCOUNT;
  }

  if (/^(заказ|заказы|мой заказ|статус|трек|трек номер|накладная|посылка|доставка заказа)$/i.test(text)) {
    return INTENTS.ORDER_STATUS;
  }

  return null;
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

  if (/^(доставка|сроки|срок доставки|сколько доставка|курьер|сдэк|cdek|способы доставки|типы доставки|тип доставки|отправка)$/i.test(text)) {
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

function messageCanUseOrderDetailContext(message, session) {
  if (!extractOrderHint(message) && messageLooksLikeProductFulfillmentQuestion(message)) {
    return false;
  }

  return session?.lastIntent === INTENTS.ORDER_STATUS
    || session?.pendingRequest?.type === 'order'
    || Boolean(extractOrderHint(message))
    || messageMentionsOrderContext(message);
}

function messageMentionsOrderContext(message) {
  if (messageLooksLikeProductFulfillmentQuestion(message)) return false;

  const words = normalizeText(message).split(/\s+/).filter(Boolean);
  const exactWords = new Set([
    'заказ',
    'заказа',
    'заказу',
    'заказом',
    'трек',
    'трек-номер',
    'сдэк',
    'cdek',
    'посылка',
    'посылку',
    'посылки',
    'мой',
    'моего',
    'моем',
    'моему',
  ]);

  return words.some((word) => exactWords.has(word) || /^накладн/.test(word));
}

export function hasActionableRequest(message) {
  return messageLooksLikeOrder(message)
    || messageLooksLikeOrderNotificationQuestion(message)
    || messageLooksLikeOrderInfoQuestion(message)
    || messageLooksLikePotentialDelayQuestion(message)
    || looksLikeStandaloneOrderLookup(message)
    || looksLikeDeliveryDataPayload(message)
    || messageLooksLikePickupQuestion(message)
    || messageLooksLikeAvailability(message)
    || messageLooksLikePrice(message)
    || messageLooksLikeWarrantyQuestion(message)
    || messageLooksLikeProductAlternativeQuestion(message)
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
  if (messageLooksLikeDeliveryPolicyQuestion(message)) return false;
  if (messageLooksLikeOrderNotificationQuestion(message) || messageLooksLikeOrderInfoQuestion(message) || messageLooksLikePotentialDelayQuestion(message)) return false;
  if (!extractOrderHint(message) && messageLooksLikeProductFulfillmentQuestion(message)) return false;

  return Boolean(extractOrderHint(message))
    || hasPhoneNumber(message)
    || /(заказ|статус|трек|трек-?номер|накладн|сдэк|cdek|достав|где.*посыл|едет|отправ|когда.*приед|когда.*получ|когда.*отправ)/i.test(message);
}

function messageLooksLikeOrderInfoQuestion(message) {
  const text = normalizeText(message);
  if (!text || extractOrderHint(message)) return false;

  return /(?:какие|что\s+знач|что\s+означа|как\s+понять|объясните|расскажите).{0,50}(?:статус|статусы).{0,80}(?:заказ|сайт|личн|кабинет)?|(?:статус|статусы).{0,60}(?:заказа|на\s+сайте|в\s+личном\s+кабинете).{0,60}(?:что\s+знач|что\s+означа|какие|бывают|как\s+понять|объясните)|(?:с\s+какого|на\s+каком).{0,80}(?:этап|момент).{0,80}(?:отраж|появ|видн).{0,60}(?:на\s+сайте|в\s+личном\s+кабинете|статус)/i.test(text);
}

function messageLooksLikePotentialDelayQuestion(message) {
  const text = normalizeText(message);
  if (!text || extractOrderHint(message)) return false;
  if (/(уже|месяц|недел|(?:^|\s)(?:\d+\s*)?дн(?:я|ей|и)?(?=\s|$)|долго|слишком|обещали|должн[аоы]?).{0,80}(?:жду|не\s+приш|задерж|долг)|(?:жду|не\s+приш|задерж).{0,80}(?:уже|месяц|недел|(?:^|\s)(?:\d+\s*)?дн(?:я|ей|и)?(?=\s|$)|долго|слишком)/i.test(text)) return false;

  return /(?:задержк|задержек).{0,60}(?:не\s+план|будут|есть|из-за|из\s+за|праздник|поставк|ожида)|(?:будут|есть|планируются|не\s+планируются).{0,60}(?:задержк|задержек)|(?:почему|что\s+значит|что\s+означает).{0,60}(?:1-10|1\s*-\s*10).{0,50}(?:висит|дней|срок|на\s+сайте)|(?:1-10|1\s*-\s*10).{0,50}(?:висит|дней|срок).{0,50}(?:на\s+сайте|почему)?/i.test(text);
}

function messageLooksLikeOrderNotificationQuestion(message) {
  const text = normalizeText(message);
  if (!text || extractOrderHint(message)) return false;

  return /(?:получу|прид[её]т|будет|приходит|приходят).{0,60}(?:уведомлен|сообщени|смс|sms|письм).{0,90}(?:статус|доставк|отправк|этап|почт|телеграм|тг|сд[эе]к|cdek)|(?:уведомлен|сообщени|смс|sms|письм).{0,60}(?:получу|прид[её]т|будет|приходит|приходят).{0,90}(?:статус|доставк|отправк|этап|почт|телеграм|тг|сд[эе]к|cdek)/i.test(text);
}

function messageLooksLikeAvailability(message) {
  if (
    messageLooksLikeDeliveryTerms(message)
    || messageLooksLikeWarrantyQuestion(message)
    || messageLooksLikeProductAlternativeQuestion(message)
    || messageLooksLikeCatalogBrowsingQuestion(message)
  ) return false;

  return /(в наличии|в нале|на складе|есть ли|есть\?|есть.{0,30}(черн|бел|красн|син|розов|сер|фиолет|желт|зел|оранж|рыж)|(?:zero|зеро|mini|max|v\d+|модель|товар).{0,40}есть.{0,30}(черн|бел|красн|син|розов|сер|фиолет|желт|зел|оранж|рыж)|какие\s+(цвета|расцветки)|какой\s+цвет|осталось|остаток|когда будет|появится|появятся|появятся ли|появится ли|поступит|поступлен|поступлени|ожидается|ожидаются|ожидаете|поставка|завоз|дроп|предзаказ|под заказ|ресток|restock|доступен|можно заказать|будете завозить|привезете|привезёте|(?:не\s+)?будет\s+ли.{0,50}(в\s+)?продаже|будет.{0,50}(в\s+)?продаже|(?:нет\s+ли|есть\s+ли).{0,50}информац.{0,50}(дойти|прийти|поступ)|что\s+еще.{0,40}(должно|будет).{0,40}(дойти|прийти|поступить)|сколько.{0,40}(пришло|имеется|осталось|штук)|(?:он|она|они|его|ее|её|их|товар|модель).{0,40}(есть|нету|нет).{0,30}(в итоге|у вас|на складе)?|(?:есть|нету|нет).{0,30}(в итоге).{0,40}(он|она|они|его|ее|её|их|товар|модель)?)/i.test(message);
}

function extractProductAvailabilityDetail(message) {
  if (/(когда.{0,40}(будет|появится|появятся|поступит|поступлени|поставка|завоз|ресток|restock|дроп)|появится|появятся|поступит|поступлени|ожидается|ожидаются|ожидаете|поставка|завоз|ресток|restock|будете завозить|привезете|привезёте|(?:не\s+)?будет\s+ли.{0,50}(в\s+)?продаже|будет.{0,50}(в\s+)?продаже|(?:нет\s+ли|есть\s+ли).{0,50}информац.{0,50}(дойти|прийти|поступ)|что\s+еще.{0,40}(должно|будет).{0,40}(дойти|прийти|поступить))/i.test(message)) {
    return 'restock_timing';
  }

  return null;
}

function messageLooksLikeHowToOrder(message) {
  return /(как.*(оформ|заказат|купить)|как купить|как оформить заказ|хочу заказать|хочу купить|можно оформить|можно купить|как происходит заказ|давайте оформим|давайте закажем|тогда возьму|тогда беру|беру)/i.test(message);
}

function messageLooksLikeProductLinkFollowup(message) {
  return /(?:^|\s)(?:можно|дай|дайте|скинь|скиньте|пришлите|отправьте)?\s*(?:ссылк[ауи]|карточк[ауи])(?:\s|$|\?|\!|\.)/i.test(message);
}

function messageLooksLikeProductVariantSelection(message) {
  return /(давайте|тогда|если|это|верс(ия|ии|ию)|вариант|цвет|нужн|возьму|беру).{0,80}(v\d+|mini|max|pro|черн|бел|красн|син|розов|фиолет|желт|зел|оранж|рыж|black|white|red|blue|pink|purple|yellow|green|orange)|(v\d+|mini|max|pro|черн|бел|красн|син|розов|фиолет|желт|зел|оранж|рыж|black|white|red|blue|pink|purple|yellow|green|orange).{0,80}(давайте|тогда|верс(ия|ии|ию)|вариант|цвет|нужн|возьму|беру)/i.test(message);
}

function messageLooksLikeDeliveryTerms(message) {
  if (extractOrderHint(message)) return false;
  return /(сколько.*(достав|ид[её]т|ехать|ждать|времени|дней)|через сколько|в течени[еи] какого|как долго|долго.*ждать|срок.*(достав|отправ|предзаказ|ожидан)|сроки|будет идти|доставка.*сколько|стоим.*достав|цена.*достав|тариф.*сдэк|доставк[аи].*(москв|росси|рф|регион|город|курьер|пвз)|(?:способ|способы|тип|типы|вариант|варианты).{0,40}достав|доставк[аи].{0,40}(способ|способы|тип|типы|вариант|варианты)|как.{0,40}(доставк|отправк|отправляете|отправить)|(?:чем|как|куда|где).{0,40}(отправляете|доставляете)|(?:отправляете|доставляете|работаете).{0,40}(росси|рф|регион|город)|(?:сдэк|cdek).{0,40}(росси|рф|регион|город|пвз|курьер)|(?:можно|заказать|заказат|доставк[аи]|отправк[аи]).{0,40}(другой\s+город|регион|росси|рф|город)|курьер.{0,30}пвз|пвз.{0,30}курьер)/i.test(message)
    && !/(мой|моего|моем|(^|\s)заказ($|\s)|трек|статус)/i.test(message);
}

function messageLooksLikeDeliveryPolicyQuestion(message) {
  const text = normalizeText(message);
  if (!text || extractOrderHint(message) || messageMentionsOrderContext(message)) return false;
  if (!messageLooksLikeDeliveryTerms(message)) return false;

  return /\bу\s+вас\b/i.test(text)
    || /^(привет|здравствуй|здравствуйте|добрый день|добрый вечер|доброе утро)\b/i.test(text)
    || /(?:способ|способы|тип|типы|вариант|варианты).{0,40}достав/i.test(text)
    || /доставк[аи].{0,40}(?:способ|способы|тип|типы|вариант|варианты)/i.test(text)
    || /как.{0,40}(?:доставк|отправк|отправляете|отправить)/i.test(text)
    || /(?:чем|как|куда|где).{0,40}(?:отправляете|доставляете)/i.test(text)
    || /(?:отправляете|доставляете|работаете).{0,40}(?:росси|рф|регион|город)/i.test(text)
    || /(?:сдэк|cdek).{0,40}(?:росси|рф|регион|город|пвз|курьер)/i.test(text)
    || /(?:можно|заказать|заказат|доставк[аи]|отправк[аи]).{0,40}(?:другой\s+город|регион|росси|рф|город)/i.test(text)
    || /курьер.{0,30}пвз|пвз.{0,30}курьер/i.test(text);
}

function messageLooksLikeProductFulfillmentQuestion(message) {
  return hasExternalUrl(message)
    || /(?:под\s+заказ|предзаказ|пред\s+заказ|в\s+наличии|поступ|поставка|завоз|ресток|restock|дроп|артикул)/i.test(message);
}

function messageLooksLikePickupQuestion(message) {
  if (extractOrderHint(message) || messageMentionsOrderContext(message)) return false;

  const text = normalizeText(message);
  return /(самовывоз|самовывоза|самовывозом|забрать\s+самовывозом|пункт\s+самовывоза).{0,60}(есть|можно|адрес|где|куда|наход|работ|когда|во\s+сколько)?|(?:где|куда|адрес|можно).{0,40}самовывоз|гончарн.{0,40}(работ|открыт|можно|сегодня|завтра)|(?:работаете|работает|открыты|открыто).{0,40}(сегодня|завтра|еще|ещё)|(?:могу|можно).{0,30}(сегодня|завтра).{0,30}(подъехать|приехать|забрать)/i.test(text);
}

function messageLooksLikeOrderPickupTimingQuestion(message) {
  const text = normalizeText(message);
  if (!text || extractOrderHint(message)) return false;

  const hasOrderCue = /(?:мой|моего|моем|мой\s+)?заказ|посылк/i.test(text);
  const hasPickupCue = /самовывоз|забрать|выдач|получить|готов|доступен|доступна|доступно/i.test(text);
  const hasTimingCue = /сегодня|завтра|когда|получается|уже|можно|будет|готов/i.test(text);

  return hasOrderCue && hasPickupCue && hasTimingCue;
}

function messageLooksLikePrice(message) {
  return /(цен[ауы]|ценник|ценники|прайс|стоим|стоить|стоят|сколько.{0,80}(стоит|стоят|стоить|цен[ауы]|ценник)|сколько будет|будет стоить|скидк|промокод|акци[яи]|дешевле|дешев|снизить|скинуть|торг|актуальная цена|предварительная цена|предварительную цену|примерн.{0,30}цен)/i.test(message);
}

function extractPriceDetail(message) {
  if (/(скидк|промокод|акци[яи]|дешевле|дешев|снизить|скинуть|торг)/i.test(message)) {
    return 'discount';
  }

  return 'price';
}

function messageLooksLikeProductAdvice(message) {
  const productAdvicePattern = /(посовету|подскаж.*какой|что лучше|подходит?\s+ли|подойдет|подойд[её]т|совместим|размер|soft|xsoft|mid|speed|control|контрол|скорост|быстр(ее|ый|ая|ое)|медленн|скольж|стеклопад|грип|грипы|grip|свитч|switch|глайд|ковр|мышк|мышь|мыши|клавиатур|ощущени|дизайн|эргоном|горб|зажим|пал(ец|ьц)|мизин|покрыти|болотн|срабатыван|высот.{0,40}срабатыван|регулир.{0,40}срабатыван|верс(и[яиюе]|ии)|недовож|перевож|ст[её]рт(ый|ого|ое).{0,30}ков|как.{0,40}в\s+руке|в\s+руке.{0,40}(лежит|ощущ|приятн)|отличи[ея]|отличаются|чем отличаются|надежн|надёжн|актуальн|есть смысл.{0,40}брать|для.{0,30}хват|пальцев(ый|ого)\s+хват|оригинал|копия|жалоб[аы]?.{0,40}пользовател|пользовател.{0,40}жалоб)/i;

  return (messageLooksLikeProductAlternativeQuestion(message) || messageLooksLikeCatalogBrowsingQuestion(message) || productAdvicePattern.test(message))
    && !messageLooksLikeAvailability(message)
    && !messageLooksLikePrice(message);
}

function messageLooksLikeAngryCustomer(message) {
  const text = normalizeText(message);
  if (!text) return false;

  const isProductConsultation = messageLooksLikeProductAdvice(message);
  const hasEscalationMarker = /(обман|сколько можно|надоело|отврат|претензи|суд|верните деньги|не отвеча|деньги)/i.test(text);
  if (isProductConsultation && !hasEscalationMarker) return false;

  return /(обман|сколько можно|надоело|отврат|претензи|суд)/i.test(text)
    || /(ужасн|ужас).{0,40}(сервис|поддержк|обслуж|работа|доставк|отношени|магазин|сайт)|(?:сервис|поддержк|обслуж|магазин|сайт).{0,40}(ужасн|ужас|отврат)/i.test(text)
    || /(?:у\s+меня|есть|хочу|буду).{0,30}жалоб[ауы]|жалоб[ау].{0,60}(?:на\s+вас|на\s+магазин|на\s+сервис|на\s+доставк|по\s+заказу|по\s+доставк)/i.test(text)
    || /(?:остав|напиш|подам|буду|хочу|принима|принимаете).{0,50}жалоб|жалоб[ау].{0,80}(?:остав|напиш|подам|буду|хочу|принима|принимаете|сд[эе]к|cdek)|(?:сд[эе]к|cdek).{0,80}жалоб/i.test(text)
    || /я\s+платил.{0,80}(вам|заказ|доставк).{0,80}(жалоб|претензи)|жалоб.{0,80}платил/i.test(text);
}

function messageLooksLikeCatalogBrowsingQuestion(message) {
  return /(что\s+у\s+вас\s+есть|какие\s+(товары|мышки|коврики|клавиатуры|модели)\s+есть|что\s+прода[её]те|какой\s+ассортимент|(?:где|есть|дайте|покажите)\s+(?:сайт|каталог)|сайт\s+(?:есть|где)|каталог\s+(?:есть|где)|покажите\s+(товары|каталог|ассортимент)|хочу\s+посмотреть\s+(товары|каталог|ассортимент)|посмотреть\s+(товары|каталог|ассортимент))/i.test(message);
}

function messageLooksLikeProductAlternativeQuestion(message) {
  return /(аналог|аналоги|альтернатив|похож|похожие|вместо\s+(него|нее|неё|этого|этой)|замен[ау]|что\s+взять\s+вместо|что\s+можно\s+вместо)/i.test(message);
}

function messageLooksLikeWarrantyQuestion(message) {
  if (/(хочу|нужно|надо|оформить|сделать|верните|вернуть|обменять).{0,40}(возврат|обмен|деньги|товар)/i.test(message)) {
    return false;
  }

  return /(гарант|гарантий|гарантия).{0,40}(есть|будет|действует|сколько|какая|какие|можно|условия)?|(?:есть|какая|сколько|условия|правила).{0,30}(гарант|гарантия)|(?:условия|правила|как).{0,30}(возврат|обмен)|(?:возврат|обмен).{0,30}(есть|можно|условия|правила|сколько)/i.test(message);
}

function messageLooksLikeManufacturerWarrantyReview(message) {
  return /(?:производител|официальн|офиц).{0,80}гарант|гарант.{0,80}(?:производител|официальн|офиц)|почему.{0,80}гарант.{0,80}(?:год|лет|меньше|больше)/i.test(message);
}

function messageLooksLikeReturnReviewCase(message) {
  const returnQuestion = /(?:можно|смогу|получится|возможно).{0,80}вернуть|вернуть.{0,80}(?:можно|смогу|получится|возможно)|не\s+понрав.{0,80}вернуть|вернуть.{0,80}не\s+понрав/i.test(message);
  const usageOrPackagingDetail = /(провер|тест|пользов|распак|откр(о|ы)|вскро|пленк|глайд|микрик|клик|сохран|упаковк|коробк|товарн)/i.test(message);

  return returnQuestion && usageOrPackagingDetail;
}

function messageLooksLikeDeviceDefect(message) {
  return /(брак|сломал|сломано|не работает|нерабоч|поврежд|разбит|дефект|микрофриз|прожимает|продавлив|двойн(ой|ые).{0,20}клик|сам[ао]?.{0,30}(нажим|клика|прожим)|(?:пкм|лкм).{0,80}(прожим|клика|нажим|проблем|скрип)|микрик.{0,80}(плох|функционир|скрип|нажим|клик|проблем)|кнопк[аи]?.{0,80}(продавл|плохо.{0,20}нажим|не\s+четк|не\s+ч[её]тк|скрип|проблем)|колес(о|ик).{0,80}(не\s+прокруч|не\s+крут|скрип|проблем)|корпус.{0,120}(пластик|царап|скол|дефект|поврежд|дискомфорт)|мыш[ьа]?.{0,100}(проблем|прожим|продавл|микрофриз|скрип|брак|дефект)|не\s+хочу.{0,80}(играть|пользоваться).{0,80}(брак|дискомфорт|проблем)|плох(ая|ое|ой).{0,40}(четкость|ч[её]ткость).{0,40}нажат)/i.test(message);
}

function messageLooksLikeProductSearch(message) {
  return /(не могу найти|не наш[её]л|не вижу|не показывает|не показывается|пропал.*(с сайта|из поиска)|в поиске|на сайте).{0,80}(товар|модель|мыш|ковр|клавиатур|глайд|свитч|его|ее|её)|(?:товар|модель|мыш|ковр|клавиатур|глайд|свитч).{0,80}(не могу найти|не наш[её]л|не вижу|не показывает|не показывается|пропал)|(?:он|она|оно|его|ее|её|товар|модель|карточка).{0,30}(не показывается|не отображается|не видно).{0,30}(в поиске|на сайте)|(?:в поиске|на сайте).{0,30}(не показывается|не отображается|не видно)/i.test(message)
    || (/(не могу найти|не наш[её]л|не вижу|не показывает|не показывается|пропал|в поиске|на сайте)/i.test(message) && looksLikeProductReference(message));
}

function messageLooksLikeReview(message) {
  return /(где|как|куда|можно).{0,40}(оставить|оставлять|написать|посмотреть).{0,40}(отзыв|отзывы|обзор)|отзыв(ы)?.{0,50}(есть|оставить|оставлять|написать|посмотреть|не вижу|не отображ|не дает|не даёт|где|куда)|(?:оставить|оставлять|написать|посмотреть).{0,40}(отзыв|отзывы|обзор)|есть.{0,30}(отзыв|отзывы|обзор)/i.test(message);
}

function messageLooksLikeInternationalDelivery(message) {
  return /(беларус|рб\b|казахстан|снг|международн|за границ|доставк.*(минск|алматы|астан|бишкек|ереван|тбилиси)|нужен.*белорусск.*номер)/i.test(message);
}

function messageLooksLikeAcknowledgement(message) {
  const text = normalizeText(message);
  if (!text || /(не понял|не поняла|не понимаю|не понятно|непонятно|\?|(?:^|\s)(вопрос(?!ов\s+нет)|подскаж|скажите|сколько|когда|где|как|можно|есть ли)(?:\s|$))/i.test(message)) return false;

  if (/^(вопросов\s+нет|спасибо).{0,80}(закажу|подумаю|напишу|отпишусь|ожидаю|буду\s+ждать|хорошего\s+дня|хорошего\s+вечера)/i.test(text)) return true;
  if (/^(утро\s+доброе|доброе\s+утро|день\s+добрый|добрый\s+день|вечер\s+добрый|добрый\s+вечер).{0,40}(да|ага|угу|верно|понял|поняла|ок|окей|хорошо)/i.test(text)) return true;
  if (/^(все|да|пон|понял|увидел|хорошо|отлично|пока\s+не\s+надо).{0,50}(понял|верно|спасибо|благодарю|жду|ожидаю|буду\s+ждать|помощь|ответ|информаци)/i.test(text)) return true;
  if (/^(вас\s+)?понял[а]?.{0,80}(извин|беспоко|хорошего\s+(дня|вечера)|ожидаю|буду\s+ждать|ждать\s+около|спасибо)/i.test(text)) return true;
  if (/^(уже\s+)?написал[а]?.{0,80}(туда|им|менеджер|оператор).{0,50}(понял|поняла|ожидаю|жду|буду\s+ждать)?/i.test(text)) return true;
  if (/^(а\s+)?я\s+понял[а]?(?:\s|$)/i.test(text)) return true;
  if (/^(спасибо|благодарю).{0,80}(еще|ещё|очень\s+жду|жду|буду\s+ждать|ожидаю|хорошего|с\s+праздником)/i.test(text)) return true;
  if (/^(хорошо|ладно|окей|ок).{0,80}(тогда\s+)?(закажу|в\s+следующий\s+раз|с\s+праздником|спасибо)/i.test(text)) return true;
  if (/^(огонь|круто|отлично|супер).{0,80}(появил|спасибо|благодарю)/i.test(text)) return true;
  if (/^(сейчас|ща|секунду|минуту|минуточку).{0,60}(гляну|посмотрю|проверю|напишу|отпишусь|чиркану|скину|пришлю)?$/i.test(text)) return true;
  if (/^(ок|окей|оке|хорошо|ладно).{0,60}(сейчас|щас|ща|гляну|посмотрю|проверю|напишу|отпишусь|чиркану|понял|поняла)/i.test(text)) return true;
  if (/^(так\s+)?все\s+(же\s+)?(ок|окей|хорошо|понял|понятно)/i.test(text)) return true;
  if (/^(у\s+меня\s+)?нету?[.!)]*$|^неи[.!)]*$|^только\s+такие[.!)]*$/i.test(text)) return true;

  return /^(да|нет|неа|ага|угу|ок+|оке+й+|окей|оке|хорошо|ладно|понял[а]?|понятно|ясно|принял[а]?|верно|спасибо|спс|благодарю|благодарю вас|супер|отлично|договорились|ничего страшного|без проблем|извините|прошу прощения|подумаю|напишу|отпишусь|хорошего дня|хорошего вечера|большое спасибо|спасибо большое|спасибо огромное|спасибо за [a-zа-я0-9\s-]{3,80}|спасибо большое за [a-zа-я0-9\s-]{3,80}|большое спасибо за [a-zа-я0-9\s-]{3,80}|благодарю за [a-zа-я0-9\s-]{3,80}|жаль|очень жаль|грустно|ура|кайф|конечно|вопросов нет|буду ждать|очень жду|жду|ожидаю|до завтра|в следующий раз|закажу в следующий раз|ближе к [a-zа-я0-9\s-]{3,40} закажу|пойду закажу|да он самый|а я слепой|я слепой|сейчас|ща|секунду|готово|написал[а]?|думаю да|окак|эх|ой|давайте|да давайте)(\s+(вам|тебе|тебя|большое|спасибо|понял[а]?|окей|хорошо|супер|отлично|дня|вечера|ожидаю))*[)!\\.]*$/i.test(text);
}

function messageLooksLikeAttentionPing(message) {
  const text = normalizeText(message);
  if (!text) return /^[?!().\s]+$/.test(String(message || ''));

  return /^[?!]+$/.test(String(message || '').trim())
    || /^(а\s+)?(ау|алло|ало|вы тут|есть кто|ну что|ну что там|что там|как там|что по итогу|что в итоге|есть новости|есть апдейт|уточнили|ответили|не забыли)(?:\s*[?!.)]*)?$/i.test(text);
}

function messageLooksLikeGeneralHelp(message) {
  return /((можете|сможете|можно).{0,30}(подсказать|сказать|уточнить)|хотел(ось)?\s+(узнать|спросить|уточнить)|есть вопрос|вопрос по)/i.test(message);
}

function messageLooksLikeConfusion(message) {
  return /(последнее|выше|предыдущее|прошлое).{0,30}(не\s+понял|не\s+поняла|непонятно)|^(не\s+понял[а]?|не\s+понятно|непонятно)(?:\s|$)|^(?:я\s+)?(?:просто\s+)?не\s+могу\s+найти(?:[.!?)]*)?$|не\s+совсем\s+понимаю|не\s+очень\s+понимаю|что\s+в\s+итоге\s+с\s+(?:этим|товаром|ним|ней)/i.test(message);
}

function messageLooksLikeNewcomerEntry(message) {
  const text = normalizeText(message);

  return /(я\s+(тут\s+)?перв(ый|ыи)\s+раз|впервые(?:\s+(у\s+вас|тут|здесь))?|новичок|новеньк|с\s+чего\s+начать|как\s+(это|у\s+вас\s+все|у\s+вас|тут|здесь)\s+работает|как\s+работает\s+(магазин|reship)|что\s+такое\s+reship|вы\s+магазин|это\s+магазин|как\s+у\s+вас\s+покупать|помогите\s+выбрать|что\s+можете\s+предложить)/i.test(text);
}

function messageLooksLikeSiteIssue(message) {
  return /(сайт|корзин|оформлен|оформить|оформля|ордер|личн(ый|ом).*кабинет|акк|аккаунт|промокод|кнопк|платформ|покупк).*(не работает|лежит|недоступ|ошибк|баг|не могу|не получается|не дает|не даёт|не открывается|не отображ|не видно|не добавляется|не показывает|трабл|проблем)|десктопн.{0,50}не\s+показывает|не\s+показывает.{0,50}десктопн|(?:все\s+равно|опять|снова|до\s+сих\s+пор|по-прежнему)?.{0,30}(выдает|выдаёт|пишет|показывает).{0,30}ошибк|ошибка.{0,40}(выдает|выдаёт|пишет|показывает|вылезает|появляется)|не могу.*(оформить|заказать|сделать\s+ордер|положить.*корзин|зайти.*(личн|кабинет|акк|аккаунт)|войти.*(личн|кабинет|акк|аккаунт))|(?:зайти|войти).{0,40}(личн|кабинет|акк|аккаунт).{0,40}не могу|ошибка.*(сайт|корзин|оформ|оплат|личн|кабинет|акк|аккаунт)|проблем[аы].{0,40}(с\s+)?(сайт|корзин|оформ|личн|кабинет|акк|аккаунт)|какой.?то\s+баг\s+(сайта|платформ)|(?:письм|уведомлен|подтвержден).{0,60}(?:не\s+приш|не\s+приход|не\s+получ|одинаков|дубл|несколько|много)|(?:несколько|много|одинаков|дубл).{0,60}(?:писем|письм|уведомлен)/i.test(message);
}

function messageLooksLikeDeliveryTrackingQuestion(message) {
  const hint = extractOrderHint(message);
  if (!hint) return false;

  const text = normalizeText(message);
  const words = text.split(/\s+/).filter(Boolean);
  const shortCdekLookup = words.length <= 3 && /(^|\s)(сдэк|cdek|трек|накладная|накладн)(\s|$)/i.test(text);

  return shortCdekLookup
    || /(что\s+с|где|статус|трек|накладн|движен|обновля|обновит|завис|едет|приед|посылк|заказ|когда|долго)/i.test(message);
}

function extractOrderDetailRequest(message) {
  if (/(изменить|поменять|сменить|исправить|заменить|перенести)/i.test(message)) return null;
  const hint = extractOrderHint(message);

  if (/(оплат[ауы]?\s+(прошл|зачисл|видн|есть)|плат[её]ж\s+(прош[её]л|видн|зачисл)|заказ\s+оплачен|он\s+оплачен|оплачен\s+ли|статус\s+оплат|видите\s+оплат|(^|[^a-zа-я0-9])оплачен[ао]?(?=$|[^a-zа-я0-9]))/i.test(message)) {
    return 'payment_status';
  }

  if (/(трек|трек-?номер|номер\s+(накладн|отправлен)|накладн)/i.test(message)) {
    return 'tracking';
  }

  if (/(когда|примерно|сколько\s+ждать|по\s+срок|срок|долго|приед|прид[её]т|доставят|отправил|отправят|отправлен|готов|можно\s+забрать)/i.test(message)) {
    return 'delivery_timing';
  }

  if (/(куда\s+(едет|ид[её]т|отправ)|какой\s+(адрес|пвз|пункт)|адрес\s+(доставк|получен|указан)|пвз|пункт\s+выдачи|куда\s+достав)/i.test(message)) {
    return 'delivery_destination';
  }

  if (/(кто\s+получател|получател[ья]|на\s+кого\s+(заказ|оформ)|фио\s+(получател|указан))/i.test(message)) {
    return 'recipient';
  }

  if (/(какой\s+телефон|телефон\s+(указан|получател|в\s+заказе)|номер\s+телефона)/i.test(message) || (hint && /(^|[^a-zа-я0-9])телефон(?=$|[^a-zа-я0-9])/i.test(message))) {
    return 'recipient_phone';
  }

  return null;
}

function messageLooksLikePaymentMethodQuestion(message) {
  if (/(не\s+(приш|вид|получ|получилось|получается|проходит|могу)|ошибк|списал|списали|деньги|вернул|возвращ|статус.*не)/i.test(message)) {
    return false;
  }

  return /(как.*оплат|чем.*оплат|можно.*оплат|могу.*оплач|можно.*оплач|оплачивать.{0,30}(?:без\s+проблем|можно|безопасно)|оплатить.*(карт|сбп|сайт)|сбп|карта|картой|номер карты|перевод|налож|наложк|при\s+получени|постоплат|рассрочк|долями|сплит|частями|чек|квитанц)/i.test(message);
}

function messageLooksLikeMissingOrderIdentifier(message) {
  return /(нет|не\s+знаю|не\s+помню|не\s+наш[её]л|потерял).{0,40}(номер|заказ|трек|накладн)|(?:номер|трек|накладн).{0,40}(нет|не\s+знаю|не\s+помню|потерял)|^(у\s+меня\s+)?(не\s+знаю|не\s+помню|нет|нету|нет\s+номера|нету\s+номера)$/i.test(message);
}

function messageLooksLikeShortTimingFollowup(message) {
  const text = normalizeText(message);
  if (!text || text.length > 90) return false;

  return /(?:примерно\s+когда|когда\s+примерно|по\s+срокам|что\s+по\s+срокам|когда\s+ждать|когда\s+будет|когда\s+приедет|когда\s+получится|жду.{0,30}когда|когда\?)|(?:хорошо|ок|окей|понял|поняла|жду).{0,50}(?:когда|срок)/i.test(text);
}

function messageLooksLikeCustomOrderRequest(message) {
  if (hasExternalUrl(message) && /(заказ|заказать|купить|выкуп|можно|сколько|цена|размер|цвет)/i.test(message)) return true;
  if (hasUrl(message) && !/reship\.pro/i.test(message) && !/(достав|трек|заказ|статус)/i.test(message)) return true;

  return /(выкуп|выкупаются|выкупить|байер|байеры|poizon|пойзон|taobao|1688|得物|dewu|maxgaming|max\s+gaming|aliexpress|алиэкспресс|озон|ozon|amazon|ebay|xianyu|китай|китая|заказать\s+с|привезти\s+с|товар\s+по\s+ссылк|товар\s+с\s+[a-zа-я0-9.-]+|планируете.{0,40}добавить.{0,40}сайт)/i.test(message);
}

function looksLikeShortProductReference(message) {
  const text = normalizeText(message);
  if (!looksLikeProductReference(message)) return false;
  if (hasUrl(message)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 14;
}

function extractProductHint(message) {
  return extractProductSlug(message) || (looksLikeProductReference(message) ? String(message).trim() : null);
}
