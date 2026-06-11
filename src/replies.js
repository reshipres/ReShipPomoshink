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

export function supportFallbackAnswer() {
  return `Сейчас не смог обработать сообщение. Можно создать тикет вручную или написать в Telegram ${SUPPORT_CONTACTS.telegram}.`;
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isPublicPriceReliable(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 10;
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
