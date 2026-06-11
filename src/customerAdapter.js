import { handleMessage } from './engine.js';
import { findLatestOrderContext, findOrderContext } from './orderLookup.js';
import { findProductContext } from './productLookup.js';

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
        status: productContext.lookupStatus || 'found',
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

  return findProductContext(request.hint, products);
}
