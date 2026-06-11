export const SUPPORT_CONTACTS = {
  telegram: '@reshipmng',
  pickupAddress: 'Гончарный проезд, 8/40, м. Таганская',
};

export const ORDER_STATUS_TEXT = {
  pending: 'ожидает оплаты',
  paid: 'оплачен',
  processing: 'в обработке',
  assembling: 'собирается',
  assembly: 'собирается',
  packaging: 'упаковывается',
  packing: 'упаковывается',
  shipping: 'передан в доставку',
  delivery: 'в доставке',
  shipped: 'в доставке',
  delivered: 'ожидает получения или уже доставлен',
  ready_for_recipient: 'ожидает получения',
  completed: 'завершен',
  complete: 'завершен',
  cancelled: 'отменен',
  canceled: 'отменен',
};

export const ORDER_STATUS_EXPLANATION = {
  pending: 'Если оплата уже прошла, но статус не изменился, передам вопрос оператору.',
  paid: 'Следующий шаг: сборка и подготовка к выдаче или отправке.',
  processing: 'Заказ готовится к выдаче или отправке.',
  assembling: 'Заказ сейчас собирается.',
  shipping: 'Заказ уже в доставке, дальше ориентируйтесь по треку.',
  delivery: 'Заказ уже в доставке, дальше ориентируйтесь по треку.',
  delivered: 'Заказ можно получать, если пункт выдачи или курьер подтвердили готовность.',
  ready_for_recipient: 'Заказ ожидает получения.',
  completed: 'Заказ отмечен завершенным.',
  cancelled: 'Заказ отмечен отмененным. Если это ошибка, передам оператору.',
};

export const CDEK_STATUS_TEXT = {
  CREATED: 'создана накладная',
  ACCEPTED: 'принят СДЭК',
  DELIVERED: 'доставлен',
  READY_FOR_RECIPIENT: 'ожидает получения',
  TAKEN_BY_COURIER: 'передан курьеру',
  INVALID: 'требует проверки',
};

export const DELIVERY_METHOD_TEXT = {
  CDEK_PVZ: 'CDEK до пункта выдачи',
  CDEK_COURIER: 'CDEK курьером',
  MOSCOW_COURIER: 'курьер по Москве',
  PICKUP: 'самовывоз в Москве',
  SELF_PICKUP: 'самовывоз в Москве',
};
