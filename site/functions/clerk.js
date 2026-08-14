// netlify/functions/clerk.js
// Server-side proxy: keeps the Groq API key private and talks to Groq's API
// on behalf of the "Ask the Clerk" chat and "Draft a Letter" features.

const CLERK_SYSTEM_PROMPT = `You are "the Clerk," the in-house guide for a plain-language legal literacy website called Know Your Rights, focused on India.
Style: warm but plain-spoken, like a knowledgeable clerk at a help desk, not a lawyer's letter. Short paragraphs. No legal jargon unless you immediately explain it in plain words.
For every question:
1. Name the general area of law/right involved.
2. Explain in plain language what the person's rights likely are.
3. Give one or two concrete, practical next steps.
Always be clear this is general information, not a legal opinion on their specific case, since laws vary by state and details matter. If the situation sounds urgent (violence, arrest, immediate danger), lead with that and point them toward emergency help (police 112, women's helpline 181) before anything else.
If the question is unrelated to legal rights, gently redirect to what this site can help with.
Keep responses under 180 words.`;

const DRAFT_SYSTEM_PROMPT = `You draft short, formal letters/notices for a plain-language Indian legal literacy site, based on a user's chat conversation about their situation.
Rules:
- Pick the single most fitting document type given the conversation (e.g. "Letter to Landlord Demanding Return of Security Deposit", "Notice to Employer for Unpaid Wages", "Consumer Complaint Letter to Seller"). State that document type as the very first line, in the form: TITLE: <document type>
- Then output the letter itself in standard formal letter format: sender block, date, recipient block, subject line, salutation, 2-4 short body paragraphs stating facts and a clear demand/deadline, closing, sender name.
- Use bracketed placeholders in [ALL CAPS] for anything not explicitly stated in the conversation: [YOUR NAME], [YOUR ADDRESS], [DATE], [RECIPIENT NAME], [AMOUNT], [RELEVANT DATES], etc. Never invent specific facts, names, or amounts the user didn't give you.
- Keep tone firm, factual, and non-threatening — this is a formal request, not a legal threat, unless the conversation specifically involves an urgent legal notice.
- End the letter with a single line: "Note: This is a general draft, not legal advice. Have it reviewed before sending, especially for deadlines or legal claims."
- Output ONLY the title line and the letter text. No commentary before or after.`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is missing GROQ_API_KEY' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { mode, history } = payload;
  if (!Array.isArray(history) || history.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing conversation history' }) };
  }

  const systemPrompt = mode === 'draft' ? DRAFT_SYSTEM_PROMPT : CLERK_SYSTEM_PROMPT;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || ''),
    })),
  ];

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 1000,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Upstream API error', detail: errText }),
      };
    }

    const data = await upstream.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: text }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', detail: String(err) }),
    };
  }
};
