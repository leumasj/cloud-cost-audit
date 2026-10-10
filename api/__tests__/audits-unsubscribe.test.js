'use strict';

const { EventEmitter } = require('events');

let mockEq;

function makeReq(method, query = {}, body = '') {
  const req = new EventEmitter();
  req.method = method;
  req.query = query;
  req.headers = {};
  if (method === 'POST') {
    setImmediate(() => {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    });
  }
  return req;
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
    setHeader() {},
  };
  return res;
}

function loadHandler() {
  jest.resetModules();
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({
      from: () => ({
        update: () => ({
          eq: mockEq,
        }),
      }),
    }),
  }));
  return require('../audits');
}

beforeEach(() => {
  mockEq = jest.fn().mockResolvedValue({ error: null });
  delete process.env.UNSUBSCRIBE_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('self-serve unsubscribe returns an error instead of false success when Supabase reports a failure', async () => {
  mockEq.mockResolvedValue({ error: { message: 'database unavailable' } });
  const handler = loadHandler();
  const req = makeReq('POST', { action: 'unsubscribe' }, 'email=person%40example.com');
  const res = makeRes();
  const logError = jest.spyOn(console, 'error').mockImplementation(() => {});

  await handler(req, res);

  expect(res.statusCode).toBe(500);
  expect(res.body).toContain('Something went wrong');
  expect(res.body).not.toContain("You're unsubscribed");
  expect(logError).toHaveBeenCalledWith('unsubscribe error:', 'database unavailable');
});

test('one-click unsubscribe returns an error when the database update rejects', async () => {
  mockEq.mockRejectedValue(new Error('connection lost'));
  const handler = loadHandler();
  const req = makeReq('GET', { action: 'unsubscribe', email: 'person@example.com' });
  const res = makeRes();
  const logError = jest.spyOn(console, 'error').mockImplementation(() => {});

  await handler(req, res);

  expect(res.statusCode).toBe(500);
  expect(res.body).toContain('Something went wrong');
  expect(res.body).not.toContain("You're unsubscribed");
  expect(logError).toHaveBeenCalledWith('unsubscribe error:', 'connection lost');
});

test('self-serve unsubscribe confirms only after the database update succeeds', async () => {
  const handler = loadHandler();
  const req = makeReq('POST', { action: 'unsubscribe' }, 'email=person%40example.com');
  const res = makeRes();

  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("You're unsubscribed");
  expect(mockEq).toHaveBeenCalledWith('email', 'person@example.com');
});
