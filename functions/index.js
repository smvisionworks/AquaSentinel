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
const { defineSecret } = require('firebase-functions/params');
const functionsV1 = require('firebase-functions/v1');
const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { statusForPh, statusForEc, statusForTemperature, statusForWQI, worstOf } = require('./thresholds');
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
// Body: { deviceKey, ph, ec, waterQuality, temperature, edgeStage?,
//         actuators?: { dosingPump?: {state}, valve?: {state} } }
// Auth: `deviceKey` is a long random secret assigned per device (see
// seed/seed.js), looked up in the `devices` collection — not a Firebase
// Auth account, since an ESP32 can't do an OAuth-style sign-in.
exports.ingestReading = onRequest({ cors: false }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Use POST.' });
        return;
    }

    const body = req.body || {};
    const { deviceKey, ph, ec, waterQuality, temperature, edgeStage, actuators } = body;

    if (!deviceKey || typeof deviceKey !== 'string') {
        res.status(401).json({ ok: false, error: 'Missing deviceKey.' });
        return;
    }
    const required = { ph, ec, waterQuality, temperature };
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
    const siteRef = db.collection('sites').doc(siteId);

    const sensorStatus = {
        ph: statusForPh(ph),
        ec: statusForEc(ec),
        temperature: statusForTemperature(temperature),
        waterQuality: statusForWQI(waterQuality),
    };
    const overallStatus = worstOf(Object.values(sensorStatus));
    const now = admin.firestore.FieldValue.serverTimestamp();

    const siteUpdate = {
        status: overallStatus,
        lastReading: now,
        'sensors.ph.value': ph,
        'sensors.ph.status': sensorStatus.ph,
        'sensors.ec.value': ec,
        'sensors.ec.status': sensorStatus.ec,
        'sensors.temperature.value': temperature,
        'sensors.temperature.status': sensorStatus.temperature,
        'sensors.waterQuality.value': waterQuality,
        'sensors.waterQuality.status': sensorStatus.waterQuality,
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
    batch.set(siteRef.collection('readings').doc(), { at: now, ph, ec, waterQuality, temperature });

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
                trigger: `Auto-detected from device reading: ${worstSensor ? worstSensor[0] : 'reading'} in ${overallStatus} range (pH ${ph}, EC ${ec} µS/cm, WQI ${waterQuality}, ${temperature}°C).`,
                response: ['Edge device (ESP32) responded locally per its own thresholds', 'Reading + incident auto-logged to compliance ledger by Cloud Function'],
                evidence: { before: { ph, ec, turbidity: 'UNKNOWN' }, after: { ph, ec, turbidity: 'UNKNOWN' } },
                status: 'open',
                assignedTo: null,
                audit: [{ at: new Date().toISOString(), text: `Edge decision: ${overallStatus.toUpperCase()} — auto-logged by ingestReading Cloud Function.` }],
            });
        }
    }

    await batch.commit();
    res.status(200).json({ ok: true, siteId, status: overallStatus });
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
                    ph: r.ph, ec: r.ec, waterQuality: r.waterQuality, temperature: r.temperature,
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
