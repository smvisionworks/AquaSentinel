// AquaSentinel — Cloud Functions.
//
// The ESP32 nodes already do the real work at the edge (Sense → Decide →
// Act happens on-device, locally, in milliseconds — that's the point of
// the architecture). These functions are the "Send" step: they receive
// what a device already decided, write it to Firestore as the
// system-of-record, and keep a server-side safety net that logs an
// incident even if a device's own logic missed it or its report got
// garbled in transit. They never gate the physical response — by the time
// a reading reaches here, the pump/valve has already acted.

const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const functionsV1 = require('firebase-functions/v1');
const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { statusForConductivity, statusForWaterLevel, statusForWaterFlow, statusForGas, worstOf } = require('./thresholds');
const { buildPrompt, callGemini, parseReportJson } = require('./ai-report');

admin.initializeApp();
const db = admin.firestore();

// Set once with: firebase functions:secrets:set GEMINI_API_KEY
// (see SETUP.md — "Turn on the AI Incident Analysis Agent"). Get a free key
// at aistudio.google.com/apikey — Gemini's free tier needs no billing
// account, unlike most other providers. Never put the key directly in
// code or in firebase-config.js: this one identifies your quota, unlike
// the client-side Firebase config values.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const AI_REPORT_MODEL = 'gemini-3.8-flash';

// ---- POST /ingestReading — an ESP32 node's periodic "Send" step ---------
// Body: { deviceKey, conductivity, waterLevel, waterFlow, gas, edgeStage?,
//         actuators?: { dosingPump?: {state}, valve?: {state} } }
// conductivity/waterLevel/waterFlow all come from the single water sensor
// (conductivity doubles as our turbidity proxy); gas is the CO2 reading
// from the gas sensor mounted face-down over the water surface.
// Auth: `deviceKey` is a long random secret assigned per device (see
// seed/seed.js), looked up in the `devices` collection — not a Firebase
// Auth account, since an ESP32 can't do an OAuth-style sign-in.
// Shared by ingestReading (an ESP32 POSTing directly, deviceKey-authenticated)
// and syncHackathonFeed (the scheduled poll of a teammate's Realtime
// Database feed, below) — both end up with the same four numbers for a
// known siteId, and from here on they're treated identically: same status
// thresholds, same Firestore writes, same safety-net incident logging.
async function applyReading({ siteId, conductivity, waterLevel, waterFlow, gas, edgeStage, actuators }) {
    const siteRef = db.collection('sites').doc(siteId);

    const sensorStatus = {
        conductivity: statusForConductivity(conductivity),
        waterLevel: statusForWaterLevel(waterLevel),
        waterFlow: statusForWaterFlow(waterFlow),
        gas: statusForGas(gas),
    };
    const overallStatus = worstOf(Object.values(sensorStatus));
    const now = admin.firestore.FieldValue.serverTimestamp();

    const siteUpdate = {
        status: overallStatus,
        lastReading: now,
        'sensors.conductivity.value': conductivity,
        'sensors.conductivity.status': sensorStatus.conductivity,
        'sensors.waterLevel.value': waterLevel,
        'sensors.waterLevel.status': sensorStatus.waterLevel,
        'sensors.waterFlow.value': waterFlow,
        'sensors.waterFlow.status': sensorStatus.waterFlow,
        'sensors.gas.value': gas,
        'sensors.gas.status': sensorStatus.gas,
    };
    if (edgeStage) siteUpdate.edgeStage = edgeStage;
    if (actuators && actuators.dosingPump && actuators.dosingPump.state) {
        siteUpdate['actuators.dosingPump.state'] = actuators.dosingPump.state;
        siteUpdate['actuators.dosingPump.lastActivated'] = now;
    }
    if (actuators && actuators.valve && actuators.valve.state) {
        siteUpdate['actuators.valve.state'] = actuators.valve.state;
        siteUpdate['actuators.valve.lastActivated'] = now;
    }

    const batch = db.batch();
    batch.update(siteRef, siteUpdate);
    batch.set(siteRef.collection('readings').doc(), { at: now, conductivity, waterLevel, waterFlow, gas });

    // Safety-net incident logging: if this reading is warning/critical and
    // there isn't already an open incident for this site from the last
    // hour, log one — a second, server-side record of the same event the
    // device already acted on physically.
    if (overallStatus !== 'normal') {
        const oneHourAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 3600 * 1000);
        const recent = await db.collection('incidents')
            .where('siteId', '==', siteId)
            .where('status', 'in', ['open', 'investigating'])
            .where('timestamp', '>', oneHourAgo)
            .limit(1)
            .get();

        if (recent.empty) {
            const worstSensor = Object.entries(sensorStatus).find(([, s]) => s === overallStatus);
            const incidentRef = db.collection('incidents').doc();
            batch.set(incidentRef, {
                siteId,
                severity: overallStatus,
                timestamp: now,
                trigger: `Auto-detected from device reading: ${worstSensor ? worstSensor[0] : 'reading'} in ${overallStatus} range (Conductivity ${conductivity} µS/cm, Water Level ${waterLevel}%, Water Flow ${waterFlow} L/min, Gas ${gas} ppm CO₂).`,
                response: ['Edge device (ESP32) responded locally per its own thresholds', 'Reading + incident auto-logged to compliance ledger by Cloud Function'],
                evidence: { before: { conductivity, waterLevel, gas }, after: { conductivity, waterLevel, gas } },
                status: 'open',
                assignedTo: null,
                audit: [{ at: new Date().toISOString(), text: `Edge decision: ${overallStatus.toUpperCase()} — auto-logged by ingestReading Cloud Function.` }],
            });
        }
    }

    await batch.commit();
    return overallStatus;
}

// cors: true (rather than false, like the other endpoints) because the Site
// Detail page now calls this directly from the browser for the "ICT
// Baddies" hackathon feed — see js/site-detail.js's pollHackathonFeed().
// deviceKey is still what actually authenticates a reading; this just lets
// the browser's request through instead of being blocked before it arrives.
exports.ingestReading = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Use POST.' });
        return;
    }

    const body = req.body || {};
    const { deviceKey, conductivity, waterLevel, waterFlow, gas, edgeStage, actuators } = body;

    if (!deviceKey || typeof deviceKey !== 'string') {
        res.status(401).json({ ok: false, error: 'Missing deviceKey.' });
        return;
    }
    const required = { conductivity, waterLevel, waterFlow, gas };
    for (const [key, val] of Object.entries(required)) {
        if (typeof val !== 'number' || Number.isNaN(val)) {
            res.status(400).json({ ok: false, error: `Missing or non-numeric field: ${key}` });
            return;
        }
    }

    const deviceSnap = await db.collection('devices').doc(deviceKey).get();
    if (!deviceSnap.exists) {
        logger.warn('ingestReading: unknown deviceKey', { deviceKey });
        res.status(401).json({ ok: false, error: 'Unrecognised device key.' });
        return;
    }
    const { siteId } = deviceSnap.data();

    const overallStatus = await applyReading({ siteId, conductivity, waterLevel, waterFlow, gas, edgeStage, actuators });
    res.status(200).json({ ok: true, siteId, status: overallStatus });
});

// ---- syncHackathonFeed — pulls readings from a teammate's board ----------
// Your teammate's ESP32 runs its own sketch and reports straight into their
// hackathon-b819d Realtime Database (no code of yours involved — you don't
// flash or touch that board). Every minute, this function polls that feed
// and folds it into AquaSentinel exactly like a real device POST would —
// same thresholds, same Firestore writes, same incident/AI-report pipeline
// — under the site now named "ICT Baddies" (see seed/seed.js). This is what
// replaced the USB/Arduino bridge on your end.
//
// Field mapping (matches the raw values your team's own sketch already
// sends — see the retired esp32-bridge/firmware sketch for where these
// numbers came from):
//   water_val (raw ADC, same pin as our old waterLevel sensor) -> waterLevel %
//   turbidity_analog (raw ADC)                                 -> conductivity (passthrough, no rescale)
//   gas_val (raw ADC)                                           -> gas (passthrough, no rescale)
//   waterFlow has no sensor in this feed, so it's estimated from how fast
//   waterLevel changes between polls — same placeholder approach the old
//   firmware used, just computed here instead of on the board.
const HACKATHON_FEED_URL = 'https://hackathon-b819d-default-rtdb.firebaseio.com/sensors.json';
const HACKATHON_FEED_SITE_ID = 'site-field-prototype'; // display name: "ICT Baddies"
const HACKATHON_TANK_CAPACITY_LITRES = 50; // same placeholder as the retired firmware's flow estimate

exports.syncHackathonFeed = onSchedule('* * * * *', async () => {
    let feed;
    try {
        const resp = await fetch(HACKATHON_FEED_URL);
        if (!resp.ok) {
            logger.error('syncHackathonFeed: feed request failed', { status: resp.status });
            return;
        }
        feed = await resp.json();
    } catch (err) {
        logger.error('syncHackathonFeed: feed request threw', { error: err.message });
        return;
    }

    if (!feed || typeof feed.water_val !== 'number' || typeof feed.turbidity_analog !== 'number' || typeof feed.gas_val !== 'number') {
        logger.warn('syncHackathonFeed: feed missing expected numeric fields', { feed });
        return;
    }

    const siteRef = db.collection('sites').doc(HACKATHON_FEED_SITE_ID);
    const siteSnap = await siteRef.get();
    const prevData = siteSnap.exists ? siteSnap.data() : null;
    const prevLevel = prevData?.sensors?.waterLevel?.value;
    const prevAt = prevData?.lastReading;

    const waterLevel = Math.max(0, Math.min(100, Math.round((feed.water_val / 2500) * 100)));
    const conductivity = feed.turbidity_analog;
    const gas = feed.gas_val;

    let waterFlow = 0;
    if (typeof prevLevel === 'number' && prevAt && typeof prevAt.toMillis === 'function') {
        const dtMinutes = (Date.now() - prevAt.toMillis()) / 60000;
        if (dtMinutes > 0) {
            waterFlow = (Math.abs(waterLevel - prevLevel) / 100) * HACKATHON_TANK_CAPACITY_LITRES / dtMinutes;
        }
    }

    await applyReading({ siteId: HACKATHON_FEED_SITE_ID, conductivity, waterLevel, waterFlow, gas });
    logger.info('syncHackathonFeed: applied reading', { conductivity, waterLevel, waterFlow, gas });
});

// ---- AI Incident Analysis & Compliance Agent -----------------------------
// Fires the moment an incident document is created — whether that's the
// safety-net logging above, or a device's own report — and turns the
// already-decided incident + its recent sensor history into a structured,
// human-readable report for the Compliance Manager. This is deliberately
// a separate function from ingestReading: the deterministic detection
// above must never be slowed down or blocked by an LLM call, so detection
// and reporting are two independent steps chained only by Firestore.
exports.onIncidentCreated = onDocumentCreated(
    { document: 'incidents/{incidentId}', secrets: [GEMINI_API_KEY] },
    async (event) => {
        const incidentId = event.params.incidentId;
        const incident = event.data.data();
        const reportRef = db.collection('aiReports').doc(incidentId);
        const timestampIso = incident.timestamp && incident.timestamp.toDate
            ? incident.timestamp.toDate().toISOString()
            : new Date().toISOString();

        try {
            const siteSnap = await db.collection('sites').doc(incident.siteId).get();
            const site = {
                id: incident.siteId,
                name: siteSnap.exists ? (siteSnap.data().name || incident.siteId) : incident.siteId,
            };

            const readingsSnap = await db.collection('sites').doc(incident.siteId)
                .collection('readings').orderBy('at', 'desc').limit(10).get();
            const readings = readingsSnap.docs.reverse().map((d) => {
                const r = d.data();
                return {
                    at: r.at && r.at.toDate ? r.at.toDate().toISOString() : 'unknown',
                    conductivity: r.conductivity, waterLevel: r.waterLevel, waterFlow: r.waterFlow, gas: r.gas,
                };
            });

            const prompt = buildPrompt({
                site,
                incident: { severity: incident.severity, timestampIso, trigger: incident.trigger || '' },
                readings,
            });
            const rawText = await callGemini({ apiKey: GEMINI_API_KEY.value(), model: AI_REPORT_MODEL, prompt });
            const report = parseReportJson(rawText);

            await reportRef.set({
                incidentId,
                siteId: incident.siteId,
                siteName: site.name,
                severity: incident.severity, // from Firestore, not from the model
                detectedAt: incident.timestamp || admin.firestore.FieldValue.serverTimestamp(),
                generatedAt: admin.firestore.FieldValue.serverTimestamp(),
                model: AI_REPORT_MODEL,
                status: 'generated',
                title: report.title,
                observations: report.observations,
                assessment: report.assessment,
                recommendedActions: report.recommendedActions,
                evidenceSummary: report.evidenceSummary,
            });
            logger.info('AI incident report generated', { incidentId });
        } catch (err) {
            // Never let a bad/missing API key or a flaky network call take
            // down incident detection — that already happened and is safe
            // in Firestore. Log a failed report doc instead so System Logs
            // can show "report generation failed" rather than nothing.
            logger.error('AI incident report generation failed', { incidentId, error: err.message });
            await reportRef.set({
                incidentId,
                siteId: incident.siteId,
                severity: incident.severity,
                detectedAt: incident.timestamp || admin.firestore.FieldValue.serverTimestamp(),
                generatedAt: admin.firestore.FieldValue.serverTimestamp(),
                model: AI_REPORT_MODEL,
                status: 'failed',
                error: err.message,
            }, { merge: true });
        }
    }
);

// ---- New account defaults ------------------------------------------------
// Every new Firebase Auth user starts as a read-only 'viewer' — nobody can
// grant themselves incident/task/report write access just by signing up.
// An admin promotes a user to 'field' or 'compliance' by editing their
// users/{uid} doc directly in the Firestore console (or via the seed
// script, for the three demo accounts).
exports.onUserCreate = functionsV1.auth.user().onCreate(async (user) => {
    await db.collection('users').doc(user.uid).set({
        name: user.displayName || user.email || 'New User',
        role: 'viewer',
        title: 'Viewer',
        initials: (user.displayName || user.email || '?').slice(0, 2).toUpperCase(),
    }, { merge: true });
});
