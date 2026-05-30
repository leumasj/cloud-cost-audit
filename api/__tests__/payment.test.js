const { createMocks } = require('node-mocks-http');

// Mock Supabase
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: () => ({ error: null }),
      select: () => ({ eq: () => ({ single: () => ({ data: null, error: null }) }) })
    })
  })
}));

// Mock Stripe
jest.mock('stripe', () => () => ({
  checkout: {
    sessions: {
      create: async () => ({
        url: 'https://checkout.stripe.com/test',
        id: 'cs_test_123'
      })
    }
  },
  webhooks: {
    constructEvent: () => ({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123', metadata: { type: 'blueprint' } } }
    })
  }
}));

describe('create-checkout', () => {
  test('returns checkout URL for blueprint product', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.NEXT_PUBLIC_URL = 'https://www.kloudaudit.eu';

    const handler = require('../create-checkout');
    const { req, res } = createMocks({
      method: 'POST',
      headers: { origin: 'https://www.kloudaudit.eu' },
      body: {
        productType: 'blueprint',
        email: 'test@test.com',
        currency: 'usd',
        amount: 7900,
        provider: 'AWS',
        flaggedCount: 5
      }
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.url).toContain('checkout.stripe.com');
  });

  test('rejects missing required fields', async () => {
    const handler = require('../create-checkout');
    const { req, res } = createMocks({
      method: 'POST',
      headers: { origin: 'https://www.kloudaudit.eu' },
      body: { productType: 'blueprint' } // missing email, currency etc
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  test('rejects invalid product type', async () => {
    const handler = require('../create-checkout');
    const { req, res } = createMocks({
      method: 'POST',
      headers: { origin: 'https://www.kloudaudit.eu' },
      body: {
        productType: 'invalid_type',
        email: 'test@test.com',
        currency: 'usd',
        amount: 7900
      }
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  test('rejects requests from non-allowed origins', async () => {
    const handler = require('../create-checkout');
    const { req, res } = createMocks({
      method: 'POST',
      headers: { origin: 'https://evil.com' },
      body: { productType: 'blueprint', email: 'test@test.com' }
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(403);
  });
});

describe('webhook', () => {
  test('returns 200 on valid Stripe event', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';

    const handler = require('../webhook');
    const { req, res } = createMocks({
      method: 'POST',
      headers: {
        'stripe-signature': 'test_sig',
        origin: 'https://www.kloudaudit.eu'
      },
      body: Buffer.from(JSON.stringify({ type: 'checkout.session.completed' }))
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });
});
