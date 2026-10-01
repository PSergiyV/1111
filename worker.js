// Cloudflare Worker: платный доступ к аудиоэкскурсиям.
// R2 (AUDIO) хранит полные mp3 как <tourId>.mp3, KV (CODES) хранит коды доступа.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_DEVICES = 3;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (o, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    // Выдача кодов после оплаты (только для вас, нужен ADMIN_KEY)
    if (url.pathname === '/admin/codes' && req.method === 'POST') {
      if (!env.ADMIN_KEY || req.headers.get('Authorization') !== 'Bearer ' + env.ADMIN_KEY)
        return json({ ok: false, error: 'Немає доступу' }, 401);
      const { tourId, count = 1 } = await req.json().catch(() => ({}));
      if (!validId(tourId)) return json({ ok: false, error: 'Потрібен коректний tourId' }, 400);
      const codes = [];
      for (let i = 0; i < Math.min(Number(count) || 1, 100); i++) {
        const code = makeCode();
        await env.CODES.put('code:' + code, JSON.stringify({ tourId, devices: [] }));
        codes.push(code);
      }
      return json({ ok: true, tourId, codes });
    }

    // Проверка кода и выдача полного аудио
    const isCheck = url.pathname === '/check';
    if (isCheck || url.pathname.startsWith('/audio/')) {
      const tourId = isCheck ? url.searchParams.get('tour') : decodeURIComponent(url.pathname.slice(7));
      const res = await verify(env, tourId, url.searchParams.get('code'), url.searchParams.get('device'));
      if (!res.ok) return json(res, 403);
      return isCheck ? json({ ok: true }) : sendAudio(req, env, tourId, cors);
    }
    return json({ ok: false, error: 'Не знайдено' }, 404);
  },
};

const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);

function makeCode() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}

async function verify(env, tourId, code, device) {
  if (!validId(tourId) || !code || !device) return { ok: false, error: 'Введіть код доступу.' };
  const key = 'code:' + String(code).trim().toUpperCase();
  const rec = await env.CODES.get(key, 'json');
  if (!rec || rec.tourId !== tourId) return { ok: false, error: 'Код не підходить до цієї екскурсії.' };
  if (!rec.devices.includes(device)) {
    if (rec.devices.length >= MAX_DEVICES)
      return { ok: false, error: 'Цей код уже використовується на трьох пристроях.' };
    rec.devices.push(device);
    await env.CODES.put(key, JSON.stringify(rec));
  }
  return { ok: true };
}

async function sendAudio(req, env, tourId, cors) {
  const key = tourId + '.mp3';
  const head = await env.AUDIO.head(key);
  if (!head) return new Response('Файл не знайдено', { status: 404, headers: cors });
  const size = head.size;
  let start = 0, end = size - 1, status = 200;

  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || '');
  if (m && (m[1] || m[2])) {
    if (m[1] === '') start = Math.max(0, size - Number(m[2]));
    else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
    if (start > end || start >= size)
      return new Response(null, { status: 416, headers: { ...cors, 'Content-Range': `bytes */${size}` } });
    status = 206;
  }

  const obj = await env.AUDIO.get(key, status === 206 ? { range: { offset: start, length: end - start + 1 } } : undefined);
  const headers = new Headers(cors);
  headers.set('Content-Type', 'audio/mpeg');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Cache-Control', 'private, no-store');
  if (status === 206) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  return new Response(obj.body, { status, headers });
}
