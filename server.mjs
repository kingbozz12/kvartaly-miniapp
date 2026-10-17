import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const STORE_PATH = process.env.KVARTALY_STORE_PATH || (process.env.AMVERA === '1' ? '/data/store.json' : join(ROOT, 'data', 'store.json'));
const PORT = Number(process.env.PORT || 3000);
const DEMO = process.argv.includes('--demo');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ENERGY_MAX = 100;
const ENERGY_REGEN_MS = 5 * 60 * 1000;
const BOSS_HP = 2_000_000;
const WORLD_DURATION = 24 * 60 * 60 * 1000;
const STATS = new Set(['strength', 'stamina', 'reaction', 'charisma']);

if (DEMO && process.env.NODE_ENV === 'production') {
  throw new Error('Demo must never be used in production');
}
if (!DEMO && !TOKEN) console.warn('TELEGRAM_BOT_TOKEN is missing. Authenticated gameplay is disabled.');

export function verifyTelegramInitData(raw, botToken, now = Date.now()) {
  if (!raw || !botToken || raw.length > 8192) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isSafeInteger(authDate)) return null;
  if (now / 1000 - authDate > 86400 || authDate - now / 1000 > 60) return null;
  const values = [...params.entries()]
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const digest = createHmac('sha256', secret).update(values).digest();
  const incoming = Buffer.from(hash, 'hex');
  if (incoming.length !== digest.length || !timingSafeEqual(incoming, digest)) return null;
  try {
    const user = JSON.parse(params.get('user') || '{}');
    if (!Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return { id: String(user.id), name: String(user.username || user.first_name || `Игрок ${user.id}`).slice(0, 32) };
  } catch { return null; }
}

function loadStore() {
  if (!existsSync(STORE_PATH)) return { players: {}, boss: { hp: BOSS_HP, maxHp: BOSS_HP, endsAt: Date.now() + WORLD_DURATION } };
  try {
    const data = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    if (!data || !data.players || !data.boss) throw Error('invalid');
    return data;
  } catch {
    throw new Error('Store data is corrupted. Restore a backup before starting the server.');
  }
}
function saveStore() {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  const next = STORE_PATH + '.tmp';
  writeFileSync(next, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(next, STORE_PATH);
}
const store = loadStore();
function playerOf(identity) {
  if (!store.players[identity.id]) {
    store.players[identity.id] = {
      name: identity.name, level: 1, xp: 0, cash: 2500, marks: 0,
      energy: ENERGY_MAX, energyAt: Date.now(),
      stats: { strength: 10, stamina: 10, reaction: 10, charisma: 10 },
      attackCount: 0, damage: 0,
    };
  }
  return store.players[identity.id];
}
function regen(player, now = Date.now()) {
  if (player.energy >= ENERGY_MAX) { player.energy = ENERGY_MAX; player.energyAt = now; return; }
  const ticks = Math.floor(Math.max(0, now - player.energyAt) / ENERGY_REGEN_MS);
  if (ticks > 0) {
    player.energy = Math.min(ENERGY_MAX, player.energy + ticks);
    player.energyAt += ticks * ENERGY_REGEN_MS;
    if (player.energy === ENERGY_MAX) player.energyAt = now;
  }
}
function resetBoss(now = Date.now()) {
  if (now >= store.boss.endsAt || store.boss.hp <= 0) {
    store.boss = { hp: BOSS_HP, maxHp: BOSS_HP, endsAt: now + WORLD_DURATION };
  }
}
function xpNeeded(level) { return 100 + level * 60; }
function gainXp(player, amount) {
  player.xp += amount;
  while (player.xp >= xpNeeded(player.level)) {
    player.xp -= xpNeeded(player.level);
    player.level++;
    player.cash += player.level * 25;
  }
}
function stateFor(player) {
  const remainingEnergyMs = player.energy >= ENERGY_MAX ? 0 : ENERGY_REGEN_MS - Math.max(0, Date.now() - player.energyAt) % ENERGY_REGEN_MS;
  return { player: { ...player, xpNeeded: xpNeeded(player.level), energyMax: ENERGY_MAX, remainingEnergyMs }, boss: store.boss, demo: DEMO };
}
function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function identityFor(req) {
  if (DEMO) return { id: 'demo', name: 'Street_Legend' };
  const raw = req.headers['x-telegram-init-data'];
  return typeof raw === 'string' ? verifyTelegramInitData(raw, TOKEN) : null;
}
async function readBody(req) {
  let total = 0;
  const data = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 4096) throw Error('Payload too large');
    data.push(chunk);
  }
  return JSON.parse(Buffer.concat(data).toString('utf8') || '{}');
}
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml' };
function staticFile(req, res, pathname) {
  const filename = resolve(PUBLIC, '.' + normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
  if (!filename.startsWith(PUBLIC + sep)) return json(res, 403, { error: 'Forbidden' });
  if (!existsSync(filename)) return json(res, 404, { error: 'Not found' });
  const suffix = extname(filename);
  if (!mime[suffix]) return json(res, 404, { error: 'Not found' });
  const body = readFileSync(filename);
  res.writeHead(200, { 'Content-Type': mime[suffix], 'Content-Length': body.length, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
const server = createServer(async (req, res) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self' https://web.telegram.org");
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (req.method === 'GET' && path === '/healthz') return json(res, 200, { ok: true, demo: DEMO });
    if (req.method === 'GET' && !path.startsWith('/api/')) return staticFile(req, res, path);
    if (!path.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    const id = identityFor(req);
    if (!id) return json(res, 401, { error: 'Нужен вход через Telegram. В обычном браузере используйте локальный деморежим.' });
    const player = playerOf(id);
    player.name = id.name;
    regen(player);
    resetBoss();
    if (req.method === 'GET' && path === '/api/state') {
      saveStore();
      return json(res, 200, stateFor(player));
    }
    if (req.method === 'POST' && path === '/api/action') {
      const body = await readBody(req);
      let message = '';
      if (body.type === 'train' && STATS.has(body.stat)) {
        if (player.energy < 10 || player.cash < 50) return json(res, 409, { error: 'Не хватает энергии или наличных', ...stateFor(player) });
        player.energy -= 10; player.cash -= 50;
        player.stats[body.stat] += 1;
        gainXp(player, 25);
        message = '+1 к характеристике, +25 опыта';
      } else if (body.type === 'attack') {
        if (player.energy < 10) return json(res, 409, { error: 'Не хватает энергии', ...stateFor(player) });
        player.energy -= 10;
        const damage = Math.floor((player.stats.strength * 22 + player.stats.reaction * 9 + 50) * (0.85 + Math.random() * 0.3));
        const actualDamage = Math.min(store.boss.hp, damage);
        store.boss.hp -= actualDamage;
        player.damage += actualDamage;
        player.attackCount++;
        player.cash += 75;
        gainXp(player, 35);
        message = `Урон: ${actualDamage.toLocaleString('ru-RU')}. +75 ₽, +35 опыта`;
        if (store.boss.hp <= 0) message += '. Босс побеждён!';
      } else return json(res, 400, { error: 'Неизвестное действие' });
      saveStore();
      return json(res, 200, { message, ...stateFor(player) });
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return json(res, 400, { error: 'Ошибка обработки запроса' });
  }
});
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = DEMO ? '127.0.0.1' : '0.0.0.0';
  server.listen(PORT, host, () => console.log(`КВАРТАЛЫ → http://${host}:${PORT} ${DEMO ? '(LOCAL DEMO)' : '(TELEGRAM AUTH)'}`));
}
export { server };
