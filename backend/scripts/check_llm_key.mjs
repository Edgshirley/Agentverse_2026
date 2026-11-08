// ============================================================================
// Checks that the LLM key in ../../secrets.env actually works.
// Usage (repo root):  node backend/scripts/check_llm_key.mjs
// Never prints the key itself — only its last 4 characters.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRETS_ENV = path.resolve(__dirname, '../../secrets.env');
if (fs.existsSync(SECRETS_ENV)) process.loadEnvFile(SECRETS_ENV);

const mask = (k) => `…${k.slice(-4)} (${k.length} chars)`;
const gemini = process.env.GEMINI_API_KEY?.trim();
const openai = process.env.OPENAI_API_KEY?.trim();

async function main() {
  if (gemini) {
    const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
    console.log(`Testing GEMINI_API_KEY ${mask(gemini)} with ${model}...`);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gemini },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }] }),
      },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${body?.error?.message ?? 'unknown error'}`);
    console.log('Gemini replied:', body?.candidates?.[0]?.content?.parts?.[0]?.text?.trim());
    return;
  }
  if (openai) {
    const base = (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
    console.log(`Testing OPENAI_API_KEY ${mask(openai)} with ${model} at ${base}...`);
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openai}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }] }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${body?.error?.message ?? 'unknown error'}`);
    console.log('OpenAI replied:', body?.choices?.[0]?.message?.content?.trim());
    return;
  }
  throw new Error(
    `No key found. Run: cp secrets.env.example secrets.env  — then paste your key into ${SECRETS_ENV}`,
  );
}

main().then(
  () => console.log('✅ Key works. The agents will now use the LLM instead of regex fallbacks.'),
  (err) => {
    console.error('❌', err.message);
    process.exit(1);
  },
);
