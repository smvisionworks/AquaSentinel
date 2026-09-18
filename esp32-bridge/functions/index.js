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
const functionsV1 = require('firebase-functions/v1');
const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { statusForConductivity, statusForWaterLevel, statusForWaterFlow, statusForGas, worstOf } = require('./thresholds');

admin.initializeApp();
const db = admin.firestore();

// ---- POST /ingestReading — an ESP32 node's periodic "Send" step ---------
// Body: { deviceKey, conductivity, waterLevel, waterFlow, gas, edgeStage?,
//         actuators?: { dosingPump?: {state}, valve?: {state} } }
// Auth: `deviceKey` is a long random secret assigned per device (see
// seed/seed.js), looked up in the `devices` collection — not a Firebase
// Auth account, since an ESP32 can't do an OAuth-style sign-in.
//
// This is for site devices reporting the full water-sensor + gas-sensor
// set (conductivity as a turbidity proxy, water level, water flow, CO2
// gas). A device that only has a subset of raw sensors should use
// ingestFieldReading below instead.
exports.ingestReading = onRequest({ cors: false }, async (req, res) => {
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
    res.status(200).json({ ok: true, siteId, status: overallStatus });
});

// ---- POST /ingestFieldReading — a prototype/field ESP32's "Send" step ---
// For devices that don't have pH/EC/temperature probes — e.g. Una's
// breadboard prototype with a resistive water-level sensor, a capacitive
// soil-moisture sensor, and a gas sensor repurposed as a contamination
// proxy (see the Wokwi simulation design doc). Kept as its own endpoint and
// its own `fieldNodes` collection rather than forcing these raw ADC
// readings into the mine-site water-chemistry schema `ingestReading`
// expects — that would mean inventing pH/EC numbers that were never
// actually measured.
//
// Body: { deviceKey, waterRaw, waterStatus?, soilRaw, soilStatus?,
//         soilWet?, gasRaw, gasStatus? }
// Auth: same per-device `deviceKey` scheme as ingestReading, but this
// device's `devices/{deviceKey}` doc has a `nodeId` field instead of a
// `siteId` — see README.md for how to register one.
exports.ingestFieldReading = onRequest({ cors: false }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Use POST.' });
        return;
    }

    const body = req.body || {};
    const { deviceKey, waterRaw, waterStatus, soilRaw, soilStatus, soilWet, gasRaw, gasStatus } = body;

    if (!deviceKey || typeof deviceKey !== 'string') {
        res.status(401).json({ ok: false, error: 'Missing deviceKey.' });
        return;
    }
    const required = { waterRaw, soilRaw, gasRaw };
    for (const [key, val] of Object.entries(required)) {
        if (typeof val !== 'number' || Number.isNaN(val)) {
            res.status(400).json({ ok: false, error: `Missing or non-numeric field: ${key}` });
            return;
        }
    }

    const deviceSnap = await db.collection('devices').doc(deviceKey).get();
    if (!deviceSnap.exists) {
        logger.warn('ingestFieldReading: unknown deviceKey', { deviceKey });
        res.status(401).json({ ok: false, error: 'Unrecognised device key.' });
        return;
    }
    const { nodeId } = deviceSnap.data();
    if (!nodeId) {
        res.status(500).json({ ok: false, error: "Device is registered but has no nodeId — is this actually a site device (has siteId instead)? Use ingestReading for those." });
        return;
    }

    const nodeRef = db.collection('fieldNodes').doc(nodeId);
    const now = admin.firestore.FieldValue.serverTimestamp();

    const nodeUpdate = {
        lastReading: now,
        'sensors.water.raw': waterRaw,
        'sensors.water.status': waterStatus || null,
        'sensors.soil.raw': soilRaw,
        'sensors.soil.status': soilStatus || null,
        'sensors.soil.wet': typeof soilWet === 'boolean' ? soilWet : null,
        'sensors.gas.raw': gasRaw,
        'sensors.gas.status': gasStatus || null,
    };

    const batch = db.batch();
    batch.set(nodeRef, nodeUpdate, { merge: true });
    batch.set(nodeRef.collection('readings').doc(), {
        at: now, waterRaw, waterStatus: waterStatus || null,
        soilRaw, soilStatus: soilStatus || null, soilWet: typeof soilWet === 'boolean' ? soilWet : null,
        gasRaw, gasStatus: gasStatus || null,
    });
    await batch.commit();

    res.status(200).json({ ok: true, nodeId });
});

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
