// Thin wrappers around the built-in fetch (Node 20+). No extra dependencies.
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 FreezerMD/1.0';

async function request(url, { method = 'GET', headers = {}, body, timeout = 30000, json } = {}) {
  const init = {
    method,
    headers: { 'user-agent': UA, accept: '*/*', ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers['content-type'] = 'application/json';
  } else if (body !== undefined) {
    init.body = body;
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} from ${new URL(url).hostname}${text ? `: ${text.slice(0, 120)}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

export async function getJson(url, opts) { return (await request(url, opts)).json(); }
export async function getText(url, opts) { return (await request(url, opts)).text(); }
export async function getBuffer(url, opts) {
  const res = await request(url, { timeout: 90000, ...opts });
  return Buffer.from(await res.arrayBuffer());
}
export async function postJson(url, json, opts = {}) { return (await request(url, { ...opts, method: 'POST', json })).json(); }
export async function postForm(url, form, opts = {}) {
  return (await request(url, {
    ...opts,
    method: 'POST',
    body: new URLSearchParams(form).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) },
  })).text();
}

export const decodeHtml = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
