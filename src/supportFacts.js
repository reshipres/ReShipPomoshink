import { normalizeText } from './normalize.js';

export const SUPPORT_FACTS = [
  {
    id: 'support_scope',
    title: 'Что умеет помощник',
    intents: ['other', 'general_help', 'assistant_identity'],
    keywords: ['помощь', 'можешь', 'умеешь', 'вопрос', 'подскажите'],
    text: 'Помощник ReShip безопасно отвечает на частые вопросы про заказы, оплату, доставку, самовывоз, наличие товара, гарантию и возврат. Если данных не хватает или случай спорный, нужно уточнить вопрос или передать оператору.',
  },
  {
    id: 'no_invention_policy',
    title: 'Запрет на выдумывание',
    intents: ['other'],
    keywords: ['точно', 'почему', 'как', 'что'],
    text: 'Нельзя придумывать статус заказа, наличие товара, цену, сроки, условия акции или решение спорного случая без данных из системы или правил ReShip.',
  },
  {
    id: 'delivery_policy',
    title: 'Доставка по России',
    intents: ['delivery_terms', 'order_status'],
    keywords: ['доставка', 'отправка', 'россия', 'регион', 'сдэк', 'cdek', 'курьер', 'пвз', 'срок'],
    text: 'По России ReShip отправляет через CDEK до пункта выдачи или курьером, если город доступен в CDEK. Точный срок и стоимость считаются в корзине по городу и адресу. Отправка после оплаты обычно занимает 1-3 рабочих дня.',
  },
  {
    id: 'pickup_policy',
    title: 'Самовывоз',
    intents: ['pickup'],
    keywords: ['самовывоз', 'забрать', 'адрес', 'москва', 'таганская'],
    text: 'Самовывоз в Москве: Гончарный проезд, 8/40, метро Таганская. Выдача доступна после подтверждения готовности заказа.',
  },
  {
    id: 'payment_policy',
    title: 'Оплата',
    intents: ['payment', 'billing_issue'],
    keywords: ['оплата', 'сбп', 'карта', 'рассрочка', 'долями', 'сплит', 'наложенный', 'получении'],
    text: 'Стандартная оплата на сайте: карта МИР или СБП. Наложенный платеж, оплата при получении, рассрочка, Долями и Сплит сейчас не входят в стандартные способы оплаты. Если деньги списались, а статус не обновился, нужен оператор.',
  },
  {
    id: 'warranty_policy',
    title: 'Гарантия и возврат',
    intents: ['warranty_or_return', 'refund_or_return', 'defect_or_damage'],
    keywords: ['гарантия', 'возврат', 'обмен', 'брак', 'сломано', 'дефект', 'вернуть', 'микрик', 'кнопка', 'скрип', 'колесо'],
    text: 'Возврат товара надлежащего качества возможен в течение 7 дней при сохранении товарного вида и упаковки. Брак, повреждение, обмен и спорные случаи нужно передавать оператору на ручную проверку.',
  },
  {
    id: 'product_lookup_policy',
    title: 'Товары и наличие',
    intents: ['availability', 'price_discount', 'product_search', 'product_advice', 'order_help'],
    keywords: ['наличие', 'есть', 'товар', 'модель', 'цена', 'стоимость', 'аналог', 'похожее', 'скорость', 'грип', 'глайды', 'горб', 'срабатывание', 'эргономика', 'оформить'],
    text: 'Наличие, цена, остатки, ссылка на оформление и базовые товарные консультации должны проверяться по базе товаров ReShip. Если товара нет в базе или найдено несколько вариантов, нужно попросить ссылку, артикул, точную модель или передать оператору.',
  },
  {
    id: 'preorder_policy',
    title: 'Подзаказ и предзаказ',
    intents: ['availability', 'order_help'],
    keywords: ['подзаказ', 'предзаказ', 'когда будет', 'поступление', 'ресток', 'завоз'],
    text: 'Товар со статусом подзаказа или предзаказа требует подтверждения срока. Если точного срока нет в базе, нужно передать вопрос оператору.',
  },
  {
    id: 'order_lookup_policy',
    title: 'Проверка заказа',
    intents: ['order_status', 'order_info', 'order_lookup_followup', 'order_switch'],
    keywords: ['заказ', 'статус', 'статусы', 'задержка', 'трек', 'накладная', 'номер', 'телефон', 'email', 'почта', 'фамилия', 'получатель'],
    text: 'Заказ можно искать по номеру заказа, CRM-номеру, треку CDEK, телефону, email или фамилии/ФИО получателя. Если длинный CRM-номер вида 4213R клиент пишет только цифрами, можно использовать числовую часть только при уникальном совпадении. Если найдено несколько заказов, нельзя угадывать: нужно запросить точный номер, трек, полное ФИО или уточнение.',
  },
  {
    id: 'order_status_meanings_policy',
    title: 'Общие статусы заказа',
    intents: ['order_info'],
    keywords: ['статус', 'статусы', 'этап', 'отражается', 'личный кабинет', '1-10', 'задержка'],
    text: 'Если клиент спрашивает, какие бывают статусы заказа или что значит срок на сайте, это справка, а не поиск конкретного заказа. Можно кратко объяснить статусы и попросить номер заказа/трек/телефон/ФИО только если клиент хочет проверить свой заказ. Задержки нельзя обещать или отрицать без данных заказа или товара.',
  },
  {
    id: 'handoff_policy',
    title: 'Когда нужен оператор',
    intents: ['human_requested', 'order_change', 'delivery_data', 'billing_issue', 'site_issue', 'custom_order_request', 'defect_or_damage', 'refund_or_return', 'angry_customer', 'international_delivery'],
    keywords: ['оператор', 'менеджер', 'человек', 'изменить', 'отменить', 'ошибка', 'письмо', 'уведомление', 'брак', 'возврат', 'снг', 'международная'],
    text: 'Оператор нужен для изменения заказа, спорной оплаты, ошибок сайта, проблем с письмами/уведомлениями, доставки по СНГ/за рубеж, внешних ссылок и ручного расчета, брака, возврата, обмена, претензий и случаев, где клиент сам просит человека.',
  },
];

export function retrieveSupportFacts(message, deterministicResult = {}, { limit = 6 } = {}) {
  const text = normalizeText(message);
  const intent = deterministicResult?.intent || 'other';
  const scored = SUPPORT_FACTS.map((fact) => ({
    fact,
    score: scoreFact(fact, text, intent),
  }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ fact }) => fact);

  const required = [
    findFact('support_scope'),
    findFact('no_invention_policy'),
  ].filter(Boolean);

  if (deterministicResult?.needsHandoff || deterministicResult?.action === 'handoff_to_operator') {
    required.push(findFact('handoff_policy'));
  }

  return uniqueFacts([...required, ...scored]).slice(0, limit);
}

export function factIds(facts = []) {
  return facts.map((fact) => fact.id).filter(Boolean);
}

function scoreFact(fact, text, intent) {
  let score = 0;
  if (fact.intents.includes(intent)) score += 3;
  for (const keyword of fact.keywords) {
    if (text.includes(normalizeText(keyword))) score += 1;
  }
  return score;
}

function findFact(id) {
  return SUPPORT_FACTS.find((fact) => fact.id === id) || null;
}

function uniqueFacts(facts) {
  const seen = new Set();
  const result = [];

  for (const fact of facts) {
    if (!fact || seen.has(fact.id)) continue;
    seen.add(fact.id);
    result.push(fact);
  }

  return result;
}
