import {
  CDEK_STATUS_TEXT,
  DELIVERY_METHOD_TEXT,
  ORDER_STATUS_EXPLANATION,
  ORDER_STATUS_TEXT,
  SUPPORT_CONTACTS,
} from './knowledge.js';

export function answer(intent, text, suggestedReplies = [], confidence = 0.86) {
  return decision('answer', intent, confidence, text, false, 'none', suggestedReplies);
}

export function ask(intent, text, suggestedReplies = [], confidence = 0.78, contextRequest = null) {
  return {
    ...decision('ask_clarifying_question', intent, confidence, text, false, 'none', suggestedReplies),
    contextRequest,
  };
}

export function handoff(intent, text, reason, subject, summary, confidence = 0.98) {
  return {
    ...decision('handoff_to_operator', intent, confidence, text, true, reason, []),
    ticketSubject: subject,
    ticketSummary: summary,
  };
}

export function appendToHandoff(intent, text, reason, subject, summary, confidence = 0.98) {
  return {
    ...handoff(intent, text, reason, subject, summary, confidence),
    appendToExistingHandoff: true,
  };
}

function decision(action, intent, confidence, text, needsHandoff, handoffReason, suggestedReplies) {
  return {
    action,
    intent,
    confidence,
    answer: text,
    needsHandoff,
    handoffReason,
    suggestedReplies,
  };
}

export function composeOrderStatusAnswer(order) {
  const rawStatus = normalizeStatus(order.crmStatusSlug || order.crmStatusGroup || order.status);
  const statusText = ORDER_STATUS_TEXT[rawStatus] || rawStatus.replace(/[_-]/g, ' ') || 'статус пока не определен';
  const orderLabel = order.crmOrderNumber || order.orderNumber || order.shortId || order.orderId || 'без номера';
  const lines = [`Нашел заказ #${orderLabel}. Сейчас: ${statusText}.`];

  const explanation = ORDER_STATUS_EXPLANATION[rawStatus];
  if (explanation) lines.push(explanation);

  if (order.cdekTrackingNumber) {
    lines.push(`Трек CDEK: ${order.cdekTrackingNumber}.`);
  } else if (String(order.deliveryMethod || '').toUpperCase().includes('CDEK')) {
    lines.push('Трек CDEK появится после передачи заказа в доставку.');
  }

  if (order.cdekOrderStatus) {
    lines.push(`Статус CDEK: ${CDEK_STATUS_TEXT[order.cdekOrderStatus] || order.cdekOrderStatus}.`);
  }

  const deliveryMethod = DELIVERY_METHOD_TEXT[String(order.deliveryMethod || '').toUpperCase()];
  if (deliveryMethod) {
    lines.push(`Способ получения: ${deliveryMethod}.`);
  }

  if (order.deliveryTime) {
    lines.push(`Расчетный срок при оформлении: ${order.deliveryTime}.`);
  }

  if (order.updatedAt) {
    lines.push(`Последнее обновление: ${formatDate(order.updatedAt)}.`);
  }

  lines.push('Если нужно изменить адрес, телефон или получателя, передам оператору.');
  return lines.join('\n');
}

export function composeOrderDetailAnswer(order, detail) {
  const orderLabel = order.crmOrderNumber || order.orderNumber || order.shortId || order.orderId || 'без номера';

  if (detail === 'payment_status') {
    return composeOrderPaymentStatusAnswer(order, orderLabel);
  }

  if (detail === 'tracking') {
    if (order.cdekTrackingNumber) {
      return `По заказу #${orderLabel} трек CDEK: ${order.cdekTrackingNumber}. Статус CDEK: ${CDEK_STATUS_TEXT[order.cdekOrderStatus] || order.cdekOrderStatus || 'пока не обновлен'}.`;
    }

    if (String(order.deliveryMethod || '').toUpperCase().includes('CDEK')) {
      return `По заказу #${orderLabel} трек CDEK пока не вижу. Он появится после передачи заказа в доставку.`;
    }

    return `По заказу #${orderLabel} отдельный трек не нужен для выбранного способа получения.`;
  }

  if (detail === 'delivery_timing') {
    return composeOrderTimingAnswer(order, orderLabel);
  }

  if (detail === 'delivery_destination') {
    return composeOrderDestinationAnswer(order, orderLabel);
  }

  if (detail === 'recipient') {
    const recipient = order.recipientFullName || order.recipientLastName;
    if (recipient) {
      return `По заказу #${orderLabel} получатель: ${recipient}. Если нужно изменить получателя, передам оператору.`;
    }

    return `По заказу #${orderLabel} не вижу имя получателя в доступных данных. Передам оператору, если нужно проверить вручную.`;
  }

  if (detail === 'recipient_phone') {
    const phone = maskPhone(order.recipientPhone || order.customerPhone);
    if (phone) {
      return `По заказу #${orderLabel} телефон получателя: ${phone}. Полный номер в чате не показываю. Если нужно изменить телефон, передам оператору.`;
    }

    return `По заказу #${orderLabel} не вижу телефон получателя в доступных данных. Передам оператору, если нужно проверить вручную.`;
  }

  return composeOrderStatusAnswer(order);
}

function composeOrderTimingAnswer(order, orderLabel) {
  const rawStatus = normalizeStatus(order.crmStatusSlug || order.crmStatusGroup || order.status);
  const statusText = ORDER_STATUS_TEXT[rawStatus] || rawStatus.replace(/[_-]/g, ' ') || 'статус пока не определен';
  const methodKey = String(order.deliveryMethod || '').toUpperCase();
  const lines = [`По заказу #${orderLabel} сейчас: ${statusText}.`];

  if (methodKey === 'PICKUP' || methodKey === 'SELF_PICKUP') {
    lines.push(`Самовывоз: ${SUPPORT_CONTACTS.pickupAddress}. Получать можно после подтверждения готовности заказа.`);
  } else if (order.deliveryTime) {
    lines.push(`Расчетный срок при оформлении: ${order.deliveryTime}.`);
  }

  if (order.cdekTrackingNumber) {
    lines.push(`Трек CDEK: ${order.cdekTrackingNumber}.`);
  }

  if (order.cdekOrderStatus) {
    lines.push(`Статус CDEK: ${CDEK_STATUS_TEXT[order.cdekOrderStatus] || order.cdekOrderStatus}.`);
  }

  if (order.updatedAt) {
    lines.push(`Последнее обновление: ${formatDate(order.updatedAt)}.`);
  }

  if (['processing', 'assembling', 'assembly', 'packaging', 'packing'].includes(rawStatus)) {
    lines.push('Если срок уже прошел или статус долго не меняется, передам оператору на ручную проверку.');
  }

  return lines.join(' ');
}

function composeOrderPaymentStatusAnswer(order, orderLabel) {
  const rawStatus = normalizeStatus(order.crmStatusSlug || order.crmStatusGroup || order.status);
  const statusText = ORDER_STATUS_TEXT[rawStatus] || rawStatus.replace(/[_-]/g, ' ') || 'статус пока не определен';

  if (['pending', 'awaiting_payment', 'waiting_payment', 'new'].includes(rawStatus)) {
    return `По заказу #${orderLabel} сейчас статус: ${statusText}. Оплату по этому заказу пока не вижу. Если деньги уже списались, передам оператору для проверки платежа.`;
  }

  if (['cancelled', 'canceled'].includes(rawStatus)) {
    return `По заказу #${orderLabel} сейчас статус: ${statusText}. Если оплата списалась или статус кажется ошибочным, передам оператору для проверки.`;
  }

  if (['paid', 'processing', 'assembling', 'assembly', 'packaging', 'packing', 'shipping', 'delivery', 'shipped', 'ready_for_recipient', 'delivered', 'completed', 'complete'].includes(rawStatus)) {
    return `По заказу #${orderLabel} оплата зафиксирована: сейчас статус "${statusText}".`;
  }

  return `По заказу #${orderLabel} сейчас статус: ${statusText}. Если нужно точно проверить платеж, передам оператору.`;
}

function composeOrderDestinationAnswer(order, orderLabel) {
  const methodKey = String(order.deliveryMethod || '').toUpperCase();
  const method = DELIVERY_METHOD_TEXT[methodKey] || 'выбранный способ доставки';

  if (methodKey === 'PICKUP' || methodKey === 'SELF_PICKUP') {
    return `По заказу #${orderLabel} выбран самовывоз: ${SUPPORT_CONTACTS.pickupAddress}. Получать можно после подтверждения готовности заказа.`;
  }

  if (methodKey === 'CDEK_PVZ') {
    const pvz = [order.pvzCode, order.pvzAddress].filter(Boolean).join(', ');
    if (pvz) {
      return `По заказу #${orderLabel} выбран ${method}: ${pvz}. Если нужно изменить ПВЗ, передам оператору.`;
    }

    return `По заказу #${orderLabel} выбран ${method}, но точный адрес ПВЗ в доступных данных не вижу. Передам оператору, если нужно проверить вручную.`;
  }

  if (methodKey === 'CDEK_COURIER' || methodKey === 'MOSCOW_COURIER') {
    if (order.deliveryAddress) {
      return `По заказу #${orderLabel} выбран ${method}: ${order.deliveryAddress}. Если нужно изменить адрес, передам оператору.`;
    }

    return `По заказу #${orderLabel} выбран ${method}, но полный адрес в чате не показываю. Если нужно проверить или изменить адрес, передам оператору.`;
  }

  if (order.deliveryAddress) {
    return `По заказу #${orderLabel} доставка: ${method}, ${order.deliveryAddress}. Если нужно изменить адрес, передам оператору.`;
  }

  return `По заказу #${orderLabel} способ получения: ${method}. Если нужно проверить точный адрес, передам оператору.`;
}

export function composeProductAvailabilityAnswer(product) {
  const lines = [`Проверил по базе: ${product.name}.`];
  const quantity = product.quantity ?? 0;
  const isPreorder = /подзаказ|предзаказ/i.test(product.sklad || '') || (product.preorderPrice ?? 0) > 0;

  if (product.isActive === false) {
    lines.push('Сейчас товар не активен в каталоге, лучше уточнить у оператора.');
  } else if (quantity > 0 && !isPreorder) {
    lines.push(quantity <= 5 ? `В наличии ${quantity} шт.` : 'Товар есть в наличии.');
  } else if (isPreorder) {
    lines.push('Товар доступен под заказ/предзаказ. Точный срок подтверждается при оформлении.');
  } else {
    lines.push('Сейчас не вижу свободного остатка. Могу передать вопрос оператору, чтобы уточнить ближайшее поступление.');
  }

  if (product.sklad) lines.push(`Склад/статус: ${product.sklad}.`);
  if (isPublicPriceReliable(product.price)) lines.push(`Цена: ${formatMoney(product.price)}.`);

  lines.push('Финальные остатки и цена проверяются в карточке товара или корзине перед оплатой.');
  return lines.join(' ');
}

export function composeProductPriceAnswer(product) {
  const parts = [];
  if (isPublicPriceReliable(product.price)) parts.push(`основная цена ${formatMoney(product.price)}`);
  if (isPublicPriceReliable(product.oldPrice) && product.oldPrice > (product.price || 0)) {
    parts.push(`старая цена ${formatMoney(product.oldPrice)}`);
  }
  if (isPublicPriceReliable(product.preorderPrice)) parts.push(`предзаказ ${formatMoney(product.preorderPrice)}`);

  if (!parts.length) {
    return `По товару ${product.name} не вижу надежной публичной цены. Проверьте карточку товара или передам вопрос оператору.`;
  }

  return `По товару ${product.name}: ${parts.join(', ')}. Итог с доставкой считается в корзине.`;
}

export function composeProductDiscountAnswer(product) {
  const name = product?.name || 'этому товару';
  const parts = [];

  if (isPublicPriceReliable(product?.price)) {
    parts.push(`текущая цена ${formatMoney(product.price)}`);
  }

  if (isPublicPriceReliable(product?.oldPrice) && product.oldPrice > (product.price || 0)) {
    parts.push(`старая цена ${formatMoney(product.oldPrice)}`);
  }

  if (isPublicPriceReliable(product?.preorderPrice)) {
    parts.push(`предзаказ ${formatMoney(product.preorderPrice)}`);
  }

  const priceText = parts.length
    ? `По товару ${name}: ${parts.join(', ')}.`
    : `По товару ${name} не вижу надежной публичной цены в базе.`;

  return `${priceText} Отдельный промокод или ручную скидку в базе не вижу. Итоговая цена проверяется в карточке и корзине; если промокод не срабатывает, передам оператору.`;
}

export function composeProductOrderHelpAnswer(product) {
  const name = product.name || 'этот товар';
  const lines = [];
  const productUrl = product.slug ? `https://reship.pro/product/${product.slug}` : null;
  const quantity = product.quantity ?? 0;
  const isPreorder = isPreorderProduct(product);

  lines.push(productUrl
    ? `Можно оформить ${name} через карточку: ${productUrl}.`
    : `Можно оформить ${name} через карточку товара.`);

  if (quantity > 0 && !isPreorder) {
    lines.push(quantity <= 5 ? `Сейчас по базе вижу ${quantity} шт.` : 'Сейчас по базе товар в наличии.');
  } else if (isPreorder) {
    lines.push('Сейчас это под заказ/предзаказ, срок подтвердится при оформлении или у оператора.');
  }

  lines.push('Добавьте товар в корзину, выберите доставку или самовывоз и оплатите на сайте.');
  lines.push('Финальная цена и остаток проверяются в корзине перед оплатой.');

  return lines.join(' ');
}

export function composeProductVariantSummaryAnswer(product) {
  const name = product?.name || 'текущий товар';
  const lines = [`По текущей модели в базе вижу: ${name}.`];
  const quantity = product?.quantity ?? 0;
  const isPreorder = isPreorderProduct(product || {});

  if (quantity > 0 && !isPreorder) {
    lines.push(quantity <= 5 ? `Сейчас доступно ${quantity} шт.` : 'Сейчас товар есть в наличии.');
  } else if (isPreorder) {
    lines.push('Это под заказ/предзаказ, точный срок подтвердится при оформлении или у оператора.');
  } else {
    lines.push('Свободного остатка сейчас не вижу.');
  }

  lines.push('Других цветов или версий по этой модели в базе не нашел. Если нужен конкретный вариант, напишите его или передам вопрос оператору.');
  return lines.join(' ');
}

export function composeProductRestockTimingAnswer(product, { handoff = false } = {}) {
  const name = product?.name || 'этому товару';
  const quantity = product?.quantity ?? 0;
  const isPreorder = isPreorderProduct(product || {});

  if (product?.isActive !== false && quantity > 0 && !isPreorder) {
    return `По ${name} сейчас в базе есть ${quantity} шт. Отдельный срок поступления не нужен. Если ждете другой цвет или версию, напишите вариант или передам вопрос оператору.`;
  }

  const lines = [`По ${name}`];
  if (isPreorder) {
    lines.push('вижу статус под заказ/предзаказ.');
  } else if (product?.isActive === false) {
    lines.push('товар сейчас не активен в каталоге.');
  } else {
    lines.push('свободного остатка сейчас не вижу.');
  }

  lines.push(handoff
    ? 'Точного срока поступления в базе нет. Передаю оператору, чтобы проверили ближайший завоз.'
    : 'Точного срока поступления в базе нет. Если нужен срок до оплаты, передам оператору.');

  return lines.join(' ');
}

export function supportFallbackAnswer() {
  return `Сейчас не смог обработать сообщение. Можно создать тикет вручную или написать в Telegram ${SUPPORT_CONTACTS.telegram}.`;
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isPublicPriceReliable(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 10;
}

function isPreorderProduct(product) {
  return /подзаказ|предзаказ/i.test(product.sklad || '') || (product.preorderPrice ?? 0) > 0;
}

function maskPhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return null;

  const suffix = digits.slice(-4).replace(/(\d{2})(\d{2})/, '$1 $2');
  if (digits.startsWith('7') || digits.startsWith('8')) return `+7 *** *** ${suffix}`;
  return `*** *** ${suffix}`;
}

function formatMoney(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}
