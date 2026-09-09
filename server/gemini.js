// Thin wrapper around the Gemini REST API — no SDK dependency needed for a
// single generateContent call. Used for drafting follow-up emails; nothing
// here ever sends anything, it only returns text for the rep to review.

const MODEL = 'gemini-2.5-flash';

export async function geminiJson(prompt, { schema, temperature = 0 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set — copy server/.env.example to server/.env and fill it in');

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature, // 0 = most deterministic; these are factual extraction tasks, not creative ones
      ...(schema ? { responseSchema: schema } : {}),
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content (possibly blocked by safety filters)');

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Gemini response was not valid JSON');
  }
}
