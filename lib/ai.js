// AI helpers. Uses an OpenAI-compatible API when OPENAI_API_KEY is set,
// otherwise falls back to the free Pollinations endpoints (no key needed).
import { config } from '../config.js';
import { postJson, getText, getBuffer } from './http.js';

const SYSTEM = `You are ${config.botName}, a friendly, concise WhatsApp assistant. Answer clearly in the user's language. Keep replies short unless asked for detail.`;

function clean(text) {
  return String(text ?? '').trim();
}

/** @param {{role:string, content:string}[]} messages */
export async function chat(messages, { system = SYSTEM } = {}) {
  const payload = [{ role: 'system', content: system }, ...messages];
  const { key, baseUrl, model } = config.openai;

  if (key) {
    const data = await postJson(`${baseUrl}/chat/completions`, { model, messages: payload }, { headers: { authorization: `Bearer ${key}` }, timeout: 60000 });
    const out = clean(data?.choices?.[0]?.message?.content);
    if (out) return out;
    throw new Error('The AI returned an empty answer.');
  }

  try {
    const data = await postJson('https://text.pollinations.ai/openai', { model: 'openai', messages: payload }, { timeout: 60000 });
    const out = clean(data?.choices?.[0]?.message?.content);
    if (out) return out;
  } catch { /* fall through to the simple GET endpoint */ }

  const last = messages[messages.length - 1]?.content ?? '';
  const out = clean(await getText(`https://text.pollinations.ai/${encodeURIComponent(last.slice(0, 1500))}?system=${encodeURIComponent(system)}`, { timeout: 60000 }));
  if (!out) throw new Error('The AI service did not answer. Try again in a moment.');
  return out;
}

/** @returns {Promise<Buffer>} image bytes */
export async function generateImage(prompt) {
  const { key, baseUrl, imageModel } = config.openai;
  if (key) {
    const data = await postJson(`${baseUrl}/images/generations`, { model: imageModel, prompt, n: 1, size: '1024x1024' }, { headers: { authorization: `Bearer ${key}` }, timeout: 120000 });
    const item = data?.data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (item?.url) return getBuffer(item.url);
    throw new Error('The image API returned no image.');
  }
  const seed = Math.floor(Math.random() * 1e9);
  const buf = await getBuffer(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`, { timeout: 120000 });
  if (buf.length < 2000) throw new Error('Image generation failed. Try a different prompt.');
  return buf;
}
