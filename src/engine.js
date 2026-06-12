import { classifyMessage, INTENTS } from './intents.js';
import {
  appendToHandoff,
  answer,
  ask,
  composeOrderDetailAnswer,
  composeOrderStatusAnswer,
  composeProductAvailabilityAnswer,
  composeProductAdviceAnswer,
  composeProductDiscountAnswer,
  composeProductOrderHelpAnswer,
  composeProductPriceAnswer,
  composeProductReviewAnswer,
  composeProductRestockTimingAnswer,
  composeProductVariantSummaryAnswer,
  handoff,
} from './replies.js';

export function handleMessage({ message, session = {}, orderContext = null, productContext = null } = {}) {
  const text = String(message || '').trim();
  if (!text) {
    const nextSession = {
      ...session,
      pendingRequest: { type: 'general', strategy: 'ask_for_question' },
    };

    return {
      action: 'ask_clarifying_question',
      intent: 'other',
      confidence: 1,
      answer: 'Напишите вопрос одним сообщением, я помогу.',
      needsHandoff: false,
      handoffReason: 'none',
      suggestedReplies: ['Где мой заказ?', 'Есть товар в наличии?', 'Позови оператора'],
      nextSession,
    };
  }

  const classified = classifyMessage(text, session);
  const activeHandoffDecision = maybeAppendToActiveHandoff(classified, text, session);
  if (activeHandoffDecision) {
    return {
      ...activeHandoffDecision,
      nextSession: buildNextSession(session, activeHandoffDecision),
    };
  }

  const decision = routeDecision(classified, text, { session, orderContext, productContext });
  return {
    ...decision,
    nextSession: buildNextSession(session, decision),
  };
}

function buildNextSession(session, decision) {
  const nextSession = {
    ...session,
    lastIntent: decision.intent,
    lastAction: decision.action,
    lastAnswer: decision.answer,
  };

  if (decision.contextRequest) {
    nextSession.pendingRequest = {
      ...decision.contextRequest,
      intent: decision.intent,
    };
  } else {
    delete nextSession.pendingRequest;
  }

  if (decision.needsHandoff) {
    nextSession.activeHandoff = {
      intent: decision.intent,
      reason: decision.handoffReason,
      subject: decision.ticketSubject || 'Вопрос оператору',
    };
  } else if ([
    'acknowledgement',
    'greeting',
    'assistant_identity',
  ].includes(decision.intent)) {
    delete nextSession.activeHandoff;
  }

  return nextSession;
}

function maybeAppendToActiveHandoff(classified, message, session) {
  const activeHandoff = session.activeHandoff;
  if (!activeHandoff?.reason) return null;

  if ([
    INTENTS.ACKNOWLEDGEMENT,
    INTENTS.GREETING,
    INTENTS.ASSISTANT_IDENTITY,
  ].includes(classified.intent)) {
    return null;
  }

  if (!looksLikeHandoffDetail(message, classified, activeHandoff)) return null;

  return appendToHandoff(
    activeHandoff.intent || 'operator_context',
    'Добавил это к обращению оператору. Контекст сохранен, повторять заново не нужно.',
    activeHandoff.reason,
    activeHandoff.subject || 'Дополнение к обращению',
    `Клиент дополнил обращение: "${message}".`,
  );
}

function looksLikeHandoffDetail(message, classified, activeHandoff) {
  const text = String(message || '').trim();
  if (!text) return false;

  if (activeHandoff.reason === 'requested_human') return true;

  if (/(еще|ещё|также|дополн|вот|номер|телефон|трек|накладн|заказ|адрес|пвз|сдэк|cdek|ссылка|размер|цвет|модель|фото|скрин|чек|квитанц)/i.test(text)) {
    return true;
  }

  if (/https?:\/\/|www\.|\+?\d[\d\s().-]{8,}\d|rs-\d{8}-[a-z0-9]+|\b\d{4,}\b/i.test(text)) {
    return true;
  }

  if (activeHandoff.reason === 'custom_order_request' && text.length <= 160) {
    return true;
  }

  return [
    INTENTS.ORDER_STATUS,
    INTENTS.ORDER_CHANGE,
    INTENTS.DELIVERY_DATA,
    INTENTS.BILLING_ISSUE,
    INTENTS.SITE_ISSUE,
    INTENTS.DEFECT_OR_DAMAGE,
    INTENTS.REFUND_OR_RETURN,
    INTENTS.CUSTOM_ORDER_REQUEST,
    INTENTS.INTERNATIONAL_DELIVERY,
  ].includes(classified.intent);
}

function routeDecision(classified, message, context) {
  const { orderContext, productContext } = context;

  switch (classified.intent) {
    case INTENTS.GREETING:
      return answer('greeting', 'Привет! Я помощник ReShip. Если вы впервые у нас, помогу выбрать товар, проверить наличие и цену, разобраться с доставкой, оплатой, самовывозом и оформлением. Если заказ уже оформлен, найду его по номеру, треку CDEK, телефону или ФИО получателя.', [
        'Что есть в наличии?',
        'Как доставляете?',
        'Как оформить заказ?',
      ], classified.confidence);

    case INTENTS.ASSISTANT_IDENTITY:
      return answer('assistant_identity', 'Я помощник ReShip. Помогаю новичкам с выбором товара, наличием, ценой, доставкой, оплатой и самовывозом. Для уже оформленных заказов могу проверить статус по номеру, треку CDEK, телефону или ФИО.', [
        'Что есть в наличии?',
        'Как доставляете?',
        'Где мой заказ?',
      ], classified.confidence);

    case INTENTS.ACKNOWLEDGEMENT:
      return answer('acknowledgement', 'Принял. Если понадобится, помогу с товаром, доставкой, оплатой или заказом.', [
        'Что есть в наличии?',
        'Как доставляете?',
        'Где мой заказ?',
      ], classified.confidence);

    case INTENTS.ORDER_SWITCH:
      return ask('order_status', 'Если нужен другой заказ, пришлите номер заказа, трек CDEK, телефон или фамилию получателя.', [
        'Проверь последний заказ',
        'Позови оператора',
      ], classified.confidence, { type: 'order', strategy: 'ask_for_hint' });

    case INTENTS.ORDER_LOOKUP_FOLLOWUP:
    case INTENTS.ORDER_STATUS:
      if (orderContext) {
        const lookupDecision = composeOrderLookupDecision(orderContext, classified, message);
        if (lookupDecision) return lookupDecision;

        if (classified.detail && !orderContext.selectedFromAmbiguousCandidates) {
          return answer('order_status', composeOrderDetailAnswer(orderContext, classified.detail), [
            'Где мой заказ?',
            'Изменить данные',
            'Позови оператора',
          ], classified.confidence);
        }

        return answer('order_status', composeOrderStatusAnswer(orderContext), [
          'Обнови статус CDEK',
          'Когда ждать доставку?',
          'Позови оператора',
        ], classified.confidence);
      }

      if (classified.missingIdentifier) {
        return ask('order_status', 'Номер заказа не обязателен. Могу проверить по телефону, фамилии/ФИО получателя или треку CDEK. Если этих данных нет под рукой, передам оператору.', [
          'Позови оператора',
          'Проверить по телефону',
        ], classified.confidence, { type: 'order', strategy: 'ask_for_hint' });
      }

      return ask('order_status', classified.hint
        ? 'Проверю заказ по этим данным. Если не найду точное совпадение, попрошу уточнить номер заказа, трек CDEK, телефон или фамилию получателя.'
        : 'Проверю заказ. Пришлите номер заказа, трек CDEK, телефон или фамилию получателя.', [
        'Проверь последний заказ',
        'Позови оператора',
      ], classified.confidence, {
        type: 'order',
        strategy: classified.hint ? 'by_hint' : 'latest_or_hint',
        hint: classified.hint || null,
      });

    case INTENTS.HUMAN_REQUESTED:
      return handoff('human_requested', 'Понял, передаю вопрос оператору. Контекст сохраню, чтобы не пришлось повторять все сначала.', 'requested_human', 'Клиент просит оператора', `Клиент написал: "${message}".`);

    case INTENTS.ORDER_CHANGE:
      return handoff('order_change', 'Это лучше сделает оператор: передаю запрос на изменение заказа.', 'order_change', 'Изменение заказа', `Клиент хочет изменить заказ: "${message}".`);

    case INTENTS.DELIVERY_DATA:
      return handoff('delivery_data', 'Похоже, вы прислали данные доставки. Передаю оператору, чтобы привязали их к заказу и проверили ПВЗ, адрес и контакты.', 'delivery_data', 'Данные доставки', `Клиент прислал данные доставки: "${message}".`);

    case INTENTS.BILLING_ISSUE:
      return handoff('payment', 'По оплате нужен оператор. Передаю вопрос, чтобы проверили платеж и статус заказа.', 'billing_issue', 'Проблема с оплатой', `Клиент сообщает о проблеме оплаты: "${message}".`);

    case INTENTS.SITE_ISSUE:
      return handoff('site_issue', 'Похоже, проблема с сайтом или оформлением заказа. Передаю оператору, чтобы проверили вручную и помогли оформить.', 'site_issue', 'Проблема сайта или оформления', `Клиент сообщает о проблеме сайта/оформления: "${message}".`);

    case INTENTS.CUSTOM_ORDER_REQUEST:
      return handoff('custom_order_request', 'Для товара под заказ, по внешней ссылке или с другой площадки нужен ручной расчет. Передаю оператору. Если есть ссылка, размер, цвет или количество, допишите одним сообщением.', 'custom_order_request', 'Ручной расчет товара', `Клиент просит рассчитать, привезти или заказать товар вручную: "${message}".`);

    case INTENTS.DEFECT_OR_DAMAGE:
      return handoff('warranty_or_return', 'Похоже на дефект или повреждение. Передаю оператору, здесь важно разобрать случай вручную.', 'defect_or_damage', 'Брак или повреждение', `Клиент сообщает о дефекте/повреждении: "${message}".`);

    case INTENTS.REFUND_OR_RETURN:
      return handoff('warranty_or_return', 'Возврат, обмен или спорный вопрос передаю оператору.', 'refund_or_return', 'Возврат или обмен', `Клиент просит возврат/обмен: "${message}".`);

    case INTENTS.ANGRY_CUSTOMER:
      return handoff('other', 'Понимаю, передаю вопрос оператору, чтобы разобрали ситуацию вручную.', 'angry_customer', 'Недовольный клиент', `Клиент недоволен: "${message}".`);

    case INTENTS.DELIVERY_TERMS:
      return answer('delivery_terms', 'По России отправляем через CDEK: до пункта выдачи или курьером, если город доступен в CDEK. Точный срок и стоимость считаются в корзине по городу и адресу. Отправка после оплаты обычно занимает 1-3 рабочих дня. Самовывоз в Москве доступен после подтверждения готовности заказа.', [
        'Где мой заказ?',
        'Адрес самовывоза',
        'Позови оператора',
      ], classified.confidence);

    case INTENTS.INTERNATIONAL_DELIVERY:
      return handoff('international_delivery', 'Международную доставку и доставку по СНГ лучше проверить вручную: передаю оператору, чтобы подтвердили страну, способ доставки и ограничения.', 'international_delivery', 'Международная доставка', `Клиент спрашивает про международную доставку: "${message}".`);

    case INTENTS.AVAILABILITY:
      if (productContext) {
        const lookupDecision = composeProductLookupDecision(productContext, 'availability', classified.confidence);
        if (lookupDecision) return lookupDecision;

        if (classified.productDetail === 'restock_timing') {
          return composeProductRestockTimingDecision(productContext, classified.confidence);
        }

        return answer('availability', composeProductAvailabilityAnswer(productContext), ['Сколько стоит?', 'Как оформить?', 'Позови оператора'], classified.confidence);
      }
      return ask('availability', classified.hint
        ? 'Проверю наличие по этому товару. Если он есть в каталоге, подтяну остаток; если нет, передам оператору.'
        : 'Проверю наличие. Пришлите ссылку на товар, артикул или точное название модели.', [
        'Проверить заказ',
        'Позови оператора',
      ], classified.confidence, { type: 'product', strategy: classified.hint ? 'by_hint' : 'ask_for_hint', hint: classified.hint || null });

    case INTENTS.PRODUCT_SEARCH:
      if (productContext) {
        const lookupDecision = composeProductLookupDecision(productContext, 'product_search', classified.confidence);
        if (lookupDecision) return lookupDecision;

        return answer('product_search', composeProductAvailabilityAnswer(productContext), ['Сколько стоит?', 'Позови оператора'], classified.confidence);
      }

      return ask('product_search', classified.hint
        ? 'Проверю этот товар по базе. Если он не отображается на сайте, уточню наличие и актуальную карточку.'
        : 'Проверю товар по базе. Напишите точное название модели, артикул или ссылку, если он не находится на сайте.', [
        'Есть товар в наличии?',
        'Позови оператора',
      ], classified.confidence, { type: 'product', strategy: classified.hint ? 'by_hint' : 'ask_for_hint', hint: classified.hint || null });

    case INTENTS.PRICE_DISCOUNT:
      if (productContext) {
        const lookupDecision = composeProductLookupDecision(productContext, 'price_discount', classified.confidence);
        if (lookupDecision) return lookupDecision;

        if (classified.priceDetail === 'discount') {
          return answer('price_discount', composeProductDiscountAnswer(productContext), ['Есть в наличии?', 'Как оформить?', 'Позови оператора'], classified.confidence);
        }

        return answer('price_discount', composeProductPriceAnswer(productContext), ['Есть в наличии?', 'Как оформить?', 'Позови оператора'], classified.confidence);
      }
      return ask('price_discount', classified.hint
        ? 'Проверю цену по этому товару в базе. Итог с доставкой все равно считается в корзине.'
        : 'Актуальная цена отображается в карточке товара и корзине. Пришлите ссылку или точное название, проверю по базе.', [
        'Проверить наличие',
        'Позови оператора',
      ], classified.confidence, { type: 'product', strategy: classified.hint ? 'by_hint' : 'ask_for_hint', hint: classified.hint || null });

    case INTENTS.PRODUCT_ADVICE:
      if (productContext) {
        return answer('product_advice', composeProductAdviceAnswer(productContext), [
          'Сколько стоит?',
          'Как оформить?',
          'Позови оператора',
        ], classified.confidence);
      }

      return ask('product_advice', 'Помогу с выбором. Напишите, что ищете: мышку, коврик, клавиатуру, глайды, свитчи или аксессуары. Если нужна конкретная модель — пришлите название или ссылку, проверю наличие и цену.', [
        'Проверить наличие',
        'Сколько доставка?',
        'Позови оператора',
      ], classified.confidence, { type: 'product_advice', strategy: 'ask_for_preferences' });

    case INTENTS.ORDER_HELP:
      if (productContext) {
        const lookupDecision = composeProductLookupDecision(productContext, 'order_help', classified.confidence);
        if (lookupDecision) return lookupDecision;

        if (productNeedsManualOrderHelp(productContext)) {
          return composeProductOrderHandoff(productContext, message, classified.confidence);
        }

        return answer('order_help', composeProductOrderHelpAnswer(productContext), ['Как оплатить?', 'Сколько доставка?', 'Позови оператора'], classified.confidence);
      }

      if (classified.hint) {
        return ask('order_help', 'Проверю этот товар по базе и подскажу, как оформить его без лишних шагов.', [
          'Как оплатить?',
          'Позови оператора',
        ], classified.confidence, { type: 'product', strategy: 'by_hint', hint: classified.hint });
      }

      return answer('order_help', 'Чтобы оформить заказ: откройте карточку товара, добавьте позицию в корзину, укажите контакты, выберите доставку или самовывоз и оплатите заказ на сайте.', ['Как оплатить?', 'Сколько доставка?', 'Позови оператора'], classified.confidence);

    case INTENTS.GENERAL_HELP:
      return ask('general_help', 'Да, помогу. Напишите вопрос одним сообщением: это про заказ, товар, оплату, доставку или возврат?', [
        'Где мой заказ?',
        'Есть товар в наличии?',
        'Позови оператора',
      ], classified.confidence, { type: 'general', strategy: 'ask_for_question' });

    case INTENTS.PAYMENT:
      return answer('payment', 'Оплата доступна картой МИР или через СБП на сайте. Наложенный платеж, оплата при получении, рассрочка, Долями и Сплит сейчас не входят в стандартные способы оплаты. Если деньги списались, а заказ не обновился, передам оператору.', ['Где мой заказ?', 'Позови оператора'], classified.confidence);

    case INTENTS.REVIEW:
      if (productContext) {
        return answer('review', composeProductReviewAnswer(productContext), [
          'Как оформить?',
          'Сколько стоит?',
          'Позови оператора',
        ], classified.confidence);
      }

      return answer('review', 'Отзывы обычно можно смотреть и оставлять в карточке товара или на площадке, где оформлялся заказ. Если отзыв не отображается или нужен отзыв по конкретному заказу, передам оператору.', [
        'Позови оператора',
        'Где мой заказ?',
      ], classified.confidence);

    case INTENTS.PICKUP:
      return answer('pickup', 'Самовывоз в Москве: Гончарный проезд, 8/40, м. Таганская. Выдача Пн-Вс с 14:00 до 16:00 после подтверждения готовности заказа.', ['Проверь мой заказ', 'Позови оператора'], classified.confidence);

    case INTENTS.MODDING:
      return answer('modding', 'Моддинг обычно занимает 5-10 рабочих дней после получения устройства. На работы и замененные компоненты действует гарантия 30 дней.', ['Как передать устройство?', 'Позови оператора'], classified.confidence);

    case INTENTS.WARRANTY_OR_RETURN:
      return answer('warranty_or_return', 'Гарантия и возврат зависят от товара и ситуации. Возврат товара надлежащего качества возможен в течение 7 дней при сохранении товарного вида и упаковки. Брак, повреждение, обмен или спорный случай передам оператору на проверку.', ['Позови оператора', 'Где мой заказ?'], classified.confidence);

    case INTENTS.ACCOUNT:
      return answer('account', 'Личный кабинет нужен, чтобы видеть заказы, тикеты поддержки и бонусы. Если не получается войти или восстановить доступ, передам оператору.', ['Позови оператора', 'Где мой заказ?'], classified.confidence);

    case INTENTS.LOYALTY:
      return answer('loyalty', 'Баллы ReShip Points начисляются за покупки и активности. Обычно 1 балл = 1 рубль, списать можно до 50% стоимости будущего заказа.', ['Где посмотреть баллы?', 'Позови оператора'], classified.confidence);

    default:
      return ask('other', 'Я могу помочь с выбором товара, наличием, ценой, оплатой, доставкой, самовывозом, гарантией или уже оформленным заказом. Напишите, что нужно узнать.', [
        'Есть товар в наличии?',
        'Сколько доставка?',
        'Где мой заказ?',
      ], classified.confidence);
  }
}

function composeOrderLookupDecision(orderContext, classified, message) {
  const lookupStatus = orderContext.lookupStatus || orderContext.resultStatus || null;

  if (lookupStatus === 'not_found') {
    return ask('order_status', 'Не нашел заказ по этим данным. Пришлите номер заказа, трек CDEK, телефон или фамилию получателя. Если данных нет под рукой, передам оператору.', [
      'Позови оператора',
      'Проверить другой заказ',
    ], classified.confidence, { type: 'order', strategy: 'ask_for_hint' });
  }

  if (lookupStatus === 'multiple' || lookupStatus === 'ambiguous') {
    return ask('order_status', 'Нашел несколько похожих заказов. Чтобы не перепутать, пришлите номер заказа, трек CDEK, полное ФИО или уточните: последний, старый, курьер, ПВЗ.', [
      'Последний заказ',
      'Позови оператора',
      'Проверить другой заказ',
    ], classified.confidence, { type: 'order', strategy: 'ask_for_exact_hint' });
  }

  if (orderContext.requiresOperator || lookupStatus === 'operator_required') {
    return handoff('order_status', 'Вижу заказ, но по нему нужна ручная проверка оператора. Передаю контекст, чтобы не пришлось повторять данные.', 'order_requires_operator', 'Заказ требует ручной проверки', orderContext.operatorReason || 'Заказ найден, но требует ручной проверки.');
  }

  if (messageAsksForDeliveryReview(message) || String(orderContext.cdekOrderStatus || '').toUpperCase() === 'INVALID') {
    const orderLabel = orderContext.crmOrderNumber || orderContext.orderNumber || orderContext.shortId || orderContext.orderId || 'без номера';
    const track = orderContext.cdekTrackingNumber ? ` Трек CDEK: ${orderContext.cdekTrackingNumber}.` : '';

    return handoff(
      'order_status',
      `Вижу заказ #${orderLabel}.${track} Если трек не обновляется или доставка зависла, это нужно проверить вручную. Передаю оператору контекст заказа.`,
      'order_delivery_review',
      'Проверка доставки заказа',
      `Клиент просит проверить движение доставки по заказу #${orderLabel}.${track}`,
      classified.confidence,
    );
  }

  return null;
}

function composeProductLookupDecision(productContext, intent, confidence) {
  const lookupStatus = productContext.lookupStatus || productContext.resultStatus || null;

  if (lookupStatus === 'variant_summary') {
    return answer(intent, composeProductVariantSummaryAnswer(productContext.baseProduct), [
      'Сколько стоит?',
      'Проверить другой товар',
      'Позови оператора',
    ], confidence);
  }

  if (lookupStatus === 'variant_not_found') {
    const baseProduct = productContext.baseProduct || {};
    const baseName = baseProduct.name || 'текущей модели';

    return ask(intent, `По текущей модели ${baseName} не нашел такой вариант в базе. Если нужен другой цвет или версия, напишите точную модель/цвет, либо передам вопрос оператору.`, [
      'Позови оператора',
      'Проверить другой товар',
    ], confidence, { type: 'product', strategy: 'ask_for_exact_hint' });
  }

  if (lookupStatus === 'not_found') {
    return ask(intent, 'Не нашел товар по этому названию в базе. Пришлите ссылку, артикул или точную модель; если карточка пропала с сайта, передам оператору.', [
      'Позови оператора',
      'Проверить другой товар',
    ], confidence, { type: 'product', strategy: 'ask_for_hint' });
  }

  if (lookupStatus === 'multiple' || lookupStatus === 'ambiguous') {
    return ask(intent, 'Нашел несколько похожих товаров. Чтобы не перепутать наличие и цену, пришлите точную модель, цвет или ссылку на карточку.', [
      'Позови оператора',
      'Проверить другой товар',
    ], confidence, { type: 'product', strategy: 'ask_for_exact_hint' });
  }

  return null;
}

function composeProductRestockTimingDecision(product, confidence) {
  const quantity = product.quantity ?? 0;
  const isPreorder = /подзаказ|предзаказ/i.test(product.sklad || '') || (product.preorderPrice ?? 0) > 0;
  const needsManualTiming = product.isActive === false || quantity <= 0 || isPreorder;

  if (needsManualTiming) {
    return handoff(
      'availability',
      composeProductRestockTimingAnswer(product, { handoff: true }),
      'restock_timing',
      'Срок поступления товара',
      `Клиент спрашивает срок поступления товара: "${product.name || 'товар без названия'}".`,
      confidence,
    );
  }

  return answer('availability', composeProductRestockTimingAnswer(product), [
    'Сколько стоит?',
    'Проверить другой товар',
    'Позови оператора',
  ], confidence);
}

function productNeedsManualOrderHelp(product) {
  const quantity = product.quantity ?? 0;
  const isPreorder = /подзаказ|предзаказ/i.test(product.sklad || '') || (product.preorderPrice ?? 0) > 0;

  return product.isActive === false || (quantity <= 0 && !isPreorder);
}

function composeProductOrderHandoff(product, message, confidence) {
  const name = product.name || 'товар';
  const reason = product.isActive === false
    ? 'товар сейчас не активен в каталоге'
    : 'сейчас не вижу свободного остатка';

  return handoff(
    'order_help',
    `По товару ${name}: ${reason}. Передаю оператору, чтобы проверили, можно ли оформить заказ или предложили ближайший вариант.`,
    'product_order_review',
    'Оформление товара требует проверки',
    `Клиент хочет оформить ${name}, но ${reason}. Сообщение клиента: "${message}".`,
    confidence,
  );
}

function messageAsksForDeliveryReview(message) {
  return /(трек|накладн|сдэк|cdek|доставк|посылк|заказ).{0,80}(не\s+обнов|не\s+двига|нет\s+движ|без\s+движ|завис|застрял|долго|проблем|проверь|проверить)|(не\s+обнов|не\s+двига|нет\s+движ|без\s+движ|завис|застрял|долго).{0,80}(трек|накладн|сдэк|cdek|доставк|посылк|заказ)/i.test(message);
}
