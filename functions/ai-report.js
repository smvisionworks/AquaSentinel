// AquaSentinel — AI Incident Analysis & Compliance Agent.
//
// Design principle (deliberate, see project brief): the model never
// decides WHETHER an incident happened or HOW SEVERE it is — that's
// already been decided by deterministic threshold rules in thresholds.js,
// before this file is ever called (index.js only invokes this after an
// incident document already exists). This module's only job is to take
// that already-verified incident + its underlying sensor readings and
// turn them into a clear, human-readable report: explain, contextualise,
// recommend. The prompt says so explicitly, and severity/site/timestamp
// in the saved report always come straight from Firestore — never parsed
// out of the model's own text — so a hallucinated severity can't leak
// into the compliance record.

const { THRESHOLDS } = require('./thresholds');

function buildPrompt({ site, incident, readings }) {
    const thresholdLines = Object.entries(THRESHOLDS)
        .map(([key, v]) => `- ${key}: normal ${v.normal}; warning ${v.warning}; critical ${v.critical}`)
        .join('\n');

    const readingLines = readings.length
        ? readings.map((r) => `  ${r.at} — pH ${r.ph}, EC ${r.ec} µS/cm, WQI ${r.waterQuality}, ${r.temperature}°C`).join('\n')
        : '  (no historical readings available for this site yet)';

    return `You are AquaSentinel's Incident Analysis & Compliance Agent, monitoring acid mine drainage risk at Khanyisa Colliery in Mpumalanga, South Africa.

A deterministic rules engine has ALREADY classified this event. Do not re-decide, question, or soften that classification, and do not invent a different severity or conclusion. Your only job is to analyse the sensor evidence below and produce a clear, plain-language incident report for the Compliance Manager.

INCIDENT (already decided by the rules engine — treat as established fact):
- Site: ${site.name} (${site.id})
- Severity: ${incident.severity}
- Detected: ${incident.timestampIso}
- Automated trigger note: ${incident.trigger || '(none recorded)'}

CONFIGURED THRESHOLDS (the rules the severity above was derived from):
${thresholdLines}

RECENT READINGS FROM THIS SITE, most recent last (this is your evidence — base your observations only on this):
${readingLines}

Respond with ONLY valid JSON — no markdown code fences, no extra commentary before or after — matching exactly this shape:
{
  "title": "short incident title, e.g. 'Potential Acid Mine Drainage Event'",
  "observations": ["3 to 5 short bullet points describing what the readings actually show"],
  "assessment": "1-2 sentence plain-language assessment of what this likely means",
  "recommendedActions": ["3 to 5 short, concrete recommended actions for field/compliance staff"],
  "evidenceSummary": "one sentence describing the reading window used as evidence"
}`;
}

// Uses the Gemini API (Google AI Studio) — its free tier needs no billing
// account/credit card, unlike most other providers, which is why it's the
// default here. responseMimeType: 'application/json' asks Gemini to
// return raw JSON directly (no markdown fences to strip), on top of the
// prompt's own instruction to do the same.
async function callGemini({ apiKey, model, prompt }) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
            'x-goog-api-key': apiKey,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1024 },
        }),
    });
    if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new Error(`Gemini API error ${res.status}: ${bodyText.slice(0, 500)}`);
    }
    const data = await res.json();
    const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const text = (parts && parts[0] && parts[0].text) || '';
    if (!text) throw new Error('Gemini API returned an empty response');
    return text;
}

// The model is told to return raw JSON, but strip fences defensively in
// case it wraps the answer in ```json ... ``` anyway.
function parseReportJson(text) {
    const cleaned = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.observations) || !Array.isArray(parsed.recommendedActions)) {
        throw new Error('Unexpected report shape from model (missing observations/recommendedActions arrays)');
    }
    return {
        title: String(parsed.title || 'Water Quality Incident'),
        observations: parsed.observations.map(String),
        assessment: String(parsed.assessment || ''),
        recommendedActions: parsed.recommendedActions.map(String),
        evidenceSummary: String(parsed.evidenceSummary || ''),
    };
}

module.exports = { buildPrompt, callGemini, parseReportJson };
