import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { verifyTelegramInitData } from '../server.mjs';

test('valid Telegram WebApp login accepted and tampering rejected', () => {
  const token = '123:example-token';
  const now = Date.now();
  const fields = new URLSearchParams({ user: JSON.stringify({ id: 75341, first_name: 'Alex' }), auth_date: String(Math.floor(now / 1000)) });
  const text = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  fields.set('hash', createHmac('sha256', secret).update(text).digest('hex'));
  assert.deepEqual(verifyTelegramInitData(fields.toString(), token, now), { id: '75341', name: 'Alex' });
  fields.set('user', JSON.stringify({ id: 75, first_name: 'Alex' }));
  assert.equal(verifyTelegramInitData(fields.toString(), token, now), null);
});

test('expired Telegram login rejected', () => {
  assert.equal(verifyTelegramInitData('auth_date=100&hash=' + '0'.repeat(64), '123:sample', Date.now()), null);
});
