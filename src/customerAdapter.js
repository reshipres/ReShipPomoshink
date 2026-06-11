import { handleMessage } from './engine.js';
import { findLatestOrderContext, findOrderContext } from './orderLookup.js';

export function handleCustomerMessage({
  message,
  session = {},
  customer = {},
  orders = [],
  products = [],
} = {}) {
  const first = handleMessage({ message, session });
  const orderContext = resolveOrderContext(first, message, customer, orders);

  if (orderContext) {
    const second = handleMessage({
      message,
      session: first.nextSession,
      orderContext,
    });

    return {
      ...second,
      systemLookup: {
        type: 'order',
        status: orderContext.lookupStatus || 'found',
      },
    };
  }

  const productContext = resolveProductContext(first, products);
  if (productContext) {
    const second = handleMessage({
      message,
      session: first.nextSession,
      productContext,
    });

    return {
      ...second,
      systemLookup: {
        type: 'product',
        status: 'found',
      },
    };
  }

  return first;
}

function resolveOrderContext(result, message, customer, orders) {
  const request = result.contextRequest;
  if (request?.type !== 'order') return null;

  const hint = request.hint || null;
  if (!hint) {
    if (request.strategy === 'latest_or_hint' || request.strategy === 'latest') {
      return findLatestOrderContext(customer, orders);
    }

    return null;
  }

  return findOrderContext(hint || message, orders);
}

function resolveProductContext(result, products) {
  const request = result.contextRequest;
  if (request?.type !== 'product' || !request.hint) return null;

  const normalizedHint = String(request.hint).toLowerCase();
  return products.find((product) => {
    const name = String(product.name || '').toLowerCase();
    const slug = String(product.slug || '').toLowerCase();
    return name.includes(normalizedHint) || normalizedHint.includes(name) || slug === normalizedHint;
  }) || null;
}
