// AquaSentinel — one-time seed script.
//
// Populates a fresh Firestore project with the same demo data the site
// used to ship as a static mock (js/data.js), PLUS creates the 3 demo
// Firebase Auth accounts with real passwords so the login screen has
// something to sign into. Safe to re-run — it upserts everything.
//
// Usage (see ../SETUP.md for the full walkthrough):
//   cd seed
//   npm install
//   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node seed.js

const admin = require('firebase-admin');

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const auth = admin.auth();
const db = admin.firestore();

const NOW = Date.now();
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

// ---- Deterministic pseudo-history, same generator the old mock used ------
function history(base, spread, points, seed) {
    let s = seed;
    const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const out = [];
    let v = base;
    for (let i = 0; i < points; i++) {
        v += (rand() - 0.5) * spread;
        out.push(Math.round(v * 100) / 100);
    }
    out[out.length - 1] = base;
    return out;
}

const MINE_NAME = 'Khanyisa Colliery';
const MINE_REGION = 'Mpumalanga — eMalahleni';

// ---- Demo accounts (email/password + role) --------------------------------
// Passwords are intentionally simple placeholders for a hackathon demo —
// change them (or delete these accounts) before this ever touches real
// production data.
const DEMO_USERS = [
    { email: 'unathi@khanyisacolliery.demo', password: 'AquaDemo2026!', name: 'Unathi M.', initials: 'UM', role: 'compliance', title: 'Compliance Manager' },
    { email: 'karabo@khanyisacolliery.demo', password: 'AquaDemo2026!', name: 'Karabo S.', initials: 'KS', role: 'field', title: 'Field Officer' },
    { email: 'thabo@khanyisacolliery.demo', password: 'AquaDemo2026!', name: 'Thabo K.', initials: 'TK', role: 'viewer', title: 'Site Manager (Viewer)' },
];

// ---- Sites: one mine, six water-monitoring points -------------------------
// Sensor model: a water sensor reads conductivity (our turbidity proxy),
// water level, and water flow; a gas sensor mounted face-down over the
// water reads CO2. No pH probe, no temperature probe, no composite WQI —
// see functions/thresholds.js for the bounds these status values follow.
const SITES = [
    {
        id: 'site-tailings-01', name: 'Tailings Dam Outflow', device: 'ESP32-AQS-014',
        lat: -25.8752, lng: 29.2323, status: 'warning', edgeStage: 'act',
        sensors: {
            conductivity: { label: 'Conductivity (Turbidity)', value: 1460, unit: 'µS/cm', status: 'warning', normRange: [0, 1200], seed: [90, 37] },
            waterLevel: { label: 'Water Level', value: 88, unit: '%', status: 'warning', normRange: [20, 85], seed: [4, 23] },
            waterFlow: { label: 'Water Flow', value: 14, unit: 'L/min', status: 'normal', normRange: [3, 30], seed: [2, 51] },
            gas: { label: 'Gas (CO₂)', value: 1300, unit: 'ppm', status: 'warning', normRange: [0, 1000], seed: [110, 12] },
        },
        actuators: { dosingPump: { state: 'active', label: 'Dosing Pump P-01', lastActivatedHoursAgo: 0.15 }, valve: { state: 'open', label: 'Isolation Valve V-01', lastActivatedHoursAgo: null } },
    },
    {
        id: 'site-pitwater-01', name: 'Pit Water Station', device: 'ESP32-AQS-002',
        lat: -25.8695, lng: 29.2410, status: 'critical', edgeStage: 'act',
        sensors: {
            conductivity: { label: 'Conductivity (Turbidity)', value: 2380, unit: 'µS/cm', status: 'critical', normRange: [0, 1200], seed: [140, 29] },
            waterLevel: { label: 'Water Level', value: 96, unit: '%', status: 'critical', normRange: [20, 85], seed: [3, 19] },
            waterFlow: { label: 'Water Flow', value: 46, unit: 'L/min', status: 'critical', normRange: [3, 30], seed: [6, 7] },
            gas: { label: 'Gas (CO₂)', value: 2450, unit: 'ppm', status: 'critical', normRange: [0, 1000], seed: [180, 41] },
        },
        actuators: { dosingPump: { state: 'active', label: 'Dosing Pump P-01', lastActivatedHoursAgo: 0.3 }, valve: { state: 'closed', label: 'Isolation Valve V-01', lastActivatedHoursAgo: 0.2 } },
    },
    {
        id: 'site-plant-01', name: 'Process Plant Discharge', device: 'ESP32-AQS-009',
        lat: -25.8810, lng: 29.2260, status: 'normal', edgeStage: 'send',
        sensors: {
            conductivity: { label: 'Conductivity (Turbidity)', value: 310, unit: 'µS/cm', status: 'normal', normRange: [0, 1200], seed: [25, 17] },
            waterLevel: { label: 'Water Level', value: 55, unit: '%', status: 'normal', normRange: [20, 85], seed: [5, 13] },
            waterFlow: { label: 'Water Flow', value: 12, unit: 'L/min', status: 'normal', normRange: [3, 30], seed: [2, 3] },
            gas: { label: 'Gas (CO₂)', value: 420, unit: 'ppm', status: 'normal', normRange: [0, 1000], seed: [60, 31] },
        },
        actuators: { dosingPump: { state: 'idle', label: 'Dosing Pump P-01', lastActivatedHoursAgo: 48 }, valve: { state: 'open', label: 'Isolation Valve V-01', lastActivatedHoursAgo: null } },
    },
    {
        id: 'site-borehole-03', name: 'Borehole 3 — Groundwater', device: 'ESP32-AQS-021',
        lat: -25.8630, lng: 29.2200, status: 'normal', edgeStage: 'send',
        sensors: {
            conductivity: { label: 'Conductivity (Turbidity)', value: 420, unit: 'µS/cm', status: 'normal', normRange: [0, 1200], seed: [30, 25] },
            waterLevel: { label: 'Water Level', value: 48, unit: '%', status: 'normal', normRange: [20, 85], seed: [4, 15] },
            waterFlow: { label: 'Water Flow', value: 9, unit: 'L/min', status: 'normal', normRange: [3, 30], seed: [1.5, 5] },
            gas: { label: 'Gas (CO₂)', value: 380, unit: 'ppm', status: 'normal', normRange: [0, 1000], seed: [55, 35] },
        },
        actuators: { dosingPump: { state: 'idle', label: 'Dosing Pump P-01', lastActivatedHoursAgo: 72 }, valve: { state: 'open', label: 'Isolation Valve V-01', lastActivatedHoursAgo: null } },
    },
    {
        id: 'site-stormwater-01', name: 'Perimeter Stormwater Drain', device: 'ESP32-AQS-017',
        lat: -25.8870, lng: 29.2380, status: 'warning', edgeStage: 'decide',
        sensors: {
            conductivity: { label: 'Conductivity (Turbidity)', value: 1310, unit: 'µS/cm', status: 'warning', normRange: [0, 1200], seed: [80, 33] },
            waterLevel: { label: 'Water Level', value: 87, unit: '%', status: 'warning', normRange: [20, 85], seed: [3, 21] },
            waterFlow: { label: 'Water Flow', value: 18, unit: 'L/min', status: 'normal', normRange: [3, 30], seed: [3, 45] },
            gas: { label: 'Gas (CO₂)', value: 650, unit: 'ppm', status: 'normal', normRange: [0, 1000], seed: [70, 9] },
        },
        actuators: { dosingPump: { state: 'idle', label: 'Dosing Pump P-01', lastActivatedHoursAgo: 6 }, valve: { state: 'open', label: 'Isolation Valve V-01', lastActivatedHoursAgo: null } },
    },
    {
        id: 'site-catchment-dam-02', name: 'Catchment Dam (Downstream)', device: 'ESP32-AQS-015',
        lat: -25.8460, lng: 29.1690, status: 'normal', edgeStage: 'send',
        sensors: {
            conductivity: { label: 'Conductivity (Turbidity)', value: 380, unit: 'µS/cm', status: 'normal', normRange: [0, 1200], seed: [28, 24] },
            waterLevel: { label: 'Water Level', value: 52, unit: '%', status: 'normal', normRange: [20, 85], seed: [4, 14] },
            waterFlow: { label: 'Water Flow', value: 15, unit: 'L/min', status: 'normal', normRange: [3, 30], seed: [2, 34] },
            gas: { label: 'Gas (CO₂)', value: 410, unit: 'ppm', status: 'normal', normRange: [0, 1000], seed: [50, 44] },
        },
        actuators: { dosingPump: { state: 'idle', label: 'Dosing Pump P-01', lastActivatedHoursAgo: 30 }, valve: { state: 'open', label: 'Isolation Valve V-01', lastActivatedHoursAgo: null } },
    },
    {
        // Real ESP32 breadboard prototype — a teammate's board, running its
        // own sketch, that reports into the hackathon-b819d Realtime
        // Database. The syncHackathonFeed scheduled Cloud Function (see
        // functions/index.js) polls that feed every minute and writes real
        // readings here — no bridge script or USB connection needed on this
        // end any more. These sensor values are just placeholders until the
        // first synced reading arrives. Coordinates are a rough guess near
        // the other Khanyisa Colliery points — move the pin to wherever the
        // board is actually testing.
        id: 'site-field-prototype', name: 'ICT Baddies', device: 'ESP32-PROTO-01',
        lat: -25.8700, lng: 29.2300, status: 'normal', edgeStage: 'send',
        sensors: {
            conductivity: { label: 'Conductivity (Turbidity)', value: 400, unit: 'µS/cm', status: 'normal', normRange: [0, 1200], seed: [20, 6] },
            waterLevel: { label: 'Water Level', value: 50, unit: '%', status: 'normal', normRange: [20, 85], seed: [3, 8] },
            waterFlow: { label: 'Water Flow', value: 0, unit: 'L/min', status: 'normal', normRange: [3, 30], seed: [0.5, 10] },
            gas: { label: 'Gas (CO₂)', value: 400, unit: 'ppm', status: 'normal', normRange: [0, 1000], seed: [30, 12] },
        },
        actuators: { dosingPump: { state: 'idle', label: 'Dosing Pump P-01', lastActivatedHoursAgo: null }, valve: { state: 'open', label: 'Isolation Valve V-01', lastActivatedHoursAgo: null } },
    },
];

const INCIDENTS = [
    { id: 'inc-1001', siteId: 'site-pitwater-01', severity: 'critical', hoursAgo: 0.3,
      trigger: 'Water level spiked to 96% (critical) with conductivity at 2380 µS/cm and CO₂ climbing sharply to 2450 ppm — consistent with a containment breach and an acid mine drainage release.',
      response: ['Dosing Pump P-01 activated (alkaline neutralisation)', 'Isolation Valve V-01 closed — downstream flow contained'],
      evidence: { before: { conductivity: 2380, waterLevel: 96, gas: 2450 }, after: { conductivity: 2100, waterLevel: 74, gas: 1620 } },
      status: 'investigating', assignedTo: 'Unathi M.',
      audit: [
          { at: hoursAgo(0.3), text: 'Edge decision: CRITICAL — valve closed, pump activated automatically by ESP32-AQS-002.' },
          { at: hoursAgo(0.28), text: 'Incident auto-logged to compliance ledger (#INC-1001).' },
          { at: hoursAgo(0.1), text: 'Assigned to Unathi M. for site inspection.' },
      ] },
    { id: 'inc-1002', siteId: 'site-tailings-01', severity: 'warning', hoursAgo: 0.15,
      trigger: 'Conductivity trending up to 1460 µS/cm with water level rising toward 88% — early containment-rise signature.',
      response: ['Dosing Pump P-01 activated (alkaline neutralisation)'],
      evidence: { before: { conductivity: 1390, waterLevel: 82, gas: 1180 }, after: { conductivity: 1460, waterLevel: 88, gas: 1300 } },
      status: 'open', assignedTo: 'Karabo S.',
      audit: [
          { at: hoursAgo(0.15), text: 'Edge decision: WARNING — dosing pump activated automatically by ESP32-AQS-014.' },
          { at: hoursAgo(0.14), text: 'Incident auto-logged to compliance ledger (#INC-1002).' },
      ] },
    { id: 'inc-1004', siteId: 'site-pitwater-01', severity: 'critical', hoursAgo: 30,
      trigger: 'Water flow surged to 46 L/min following heavy rainfall, with conductivity rising to 2510 µS/cm — suspected tailings runoff breach.',
      response: ['Isolation Valve V-01 closed — downstream flow contained', 'Site inspection task created'],
      evidence: { before: { conductivity: 2510, waterLevel: 91, gas: 2200 }, after: { conductivity: 2260, waterLevel: 68, gas: 1400 } },
      status: 'resolved', assignedTo: 'Amu N.',
      audit: [
          { at: hoursAgo(30), text: 'Edge decision: CRITICAL — valve closed automatically by ESP32-AQS-002.' },
          { at: hoursAgo(29.5), text: 'Incident auto-logged to compliance ledger (#INC-1004).' },
          { at: hoursAgo(20), text: 'Site inspected — valve reopened after manual water test confirmed recovery.' },
          { at: hoursAgo(19.8), text: 'Marked resolved by Amu N.' },
      ] },
    { id: 'inc-1005', siteId: 'site-stormwater-01', severity: 'warning', hoursAgo: 3,
      trigger: 'Water level drifted to 87% (threshold 85%) with conductivity trending upward over 3 hours.',
      response: ['Edge processor flagged WARNING — dosing pump on standby'],
      evidence: { before: { conductivity: 1220, waterLevel: 84, gas: 600 }, after: { conductivity: 1310, waterLevel: 87, gas: 650 } },
      status: 'investigating', assignedTo: 'Siya P.',
      audit: [
          { at: hoursAgo(3), text: 'Edge decision: WARNING — monitoring increased, dosing pump armed by ESP32-AQS-017.' },
          { at: hoursAgo(2.9), text: 'Incident auto-logged to compliance ledger (#INC-1005).' },
      ] },
    { id: 'inc-1006', siteId: 'site-tailings-01', severity: 'warning', hoursAgo: 50,
      trigger: 'CO₂ (gas) spike detected after upstream blasting activity, with conductivity briefly elevated.',
      response: ['Dosing Pump P-01 activated', 'Downstream sensor confirmed recovery within 40 minutes'],
      evidence: { before: { conductivity: 1180, waterLevel: 80, gas: 1450 }, after: { conductivity: 1120, waterLevel: 75, gas: 820 } },
      status: 'resolved', assignedTo: 'Karabo S.',
      audit: [
          { at: hoursAgo(50), text: 'Edge decision: WARNING — dosing pump activated automatically.' },
          { at: hoursAgo(49.3), text: 'Downstream sensor confirmed recovery — status returned to normal.' },
          { at: hoursAgo(49), text: 'Marked resolved by Karabo S.' },
      ] },
];

const TASKS = [
    { id: 'tsk-01', type: 'inspection', siteId: 'site-pitwater-01', title: 'Physical inspection — Valve V-01 closure event', assignedTo: 'Unathi M.', dueHoursAgo: -6, status: 'in-progress', priority: 'high' },
    { id: 'tsk-02', type: 'inspection', siteId: 'site-tailings-01', title: 'Verify dosing tank chemical levels', assignedTo: 'Karabo S.', dueHoursAgo: -24, status: 'pending', priority: 'medium' },
    { id: 'tsk-03', type: 'maintenance', siteId: 'site-stormwater-01', title: 'Calibrate water sensor (conductivity drift detected)', assignedTo: 'Siya P.', dueHoursAgo: -48, status: 'pending', priority: 'medium' },
    { id: 'tsk-04', type: 'report', siteId: 'site-pitwater-01', title: 'Submit incident report — INC-1001', assignedTo: 'Unathi M.', dueHoursAgo: -2, status: 'pending', priority: 'high' },
    { id: 'tsk-05', type: 'inspection', siteId: 'site-plant-01', title: 'Quarterly sensor housing inspection', assignedTo: 'Amu N.', dueHoursAgo: -72, status: 'done', priority: 'low' },
    { id: 'tsk-06', type: 'maintenance', siteId: 'site-catchment-dam-02', title: 'Replace conductivity probe membrane', assignedTo: 'Amu N.', dueHoursAgo: -96, status: 'done', priority: 'low' },
];

// recipient reflects who a South African mine's water-quality compliance
// report actually goes to — the Department of Water and Sanitation (DWS).
const REPORTS = [
    { id: 'rpt-01', siteId: 'site-pitwater-01', period: 'August 2026', status: 'overdue', dueHoursAgo: 72, submittedBy: null, submittedDateHoursAgo: null, recipient: 'DWS' },
    { id: 'rpt-02', siteId: 'site-tailings-01', period: 'August 2026', status: 'submitted', dueHoursAgo: 200, submittedBy: 'Karabo S.', submittedDateHoursAgo: 120, recipient: 'DWS' },
    { id: 'rpt-03', siteId: 'site-stormwater-01', period: 'August 2026', status: 'pending', dueHoursAgo: -48, submittedBy: null, submittedDateHoursAgo: null, recipient: 'DWS' },
    { id: 'rpt-04', siteId: 'site-plant-01', period: 'August 2026', status: 'submitted', dueHoursAgo: 200, submittedBy: 'Amu N.', submittedDateHoursAgo: 150, recipient: 'DWS' },
    { id: 'rpt-05', siteId: 'site-borehole-03', period: 'August 2026', status: 'submitted', dueHoursAgo: 200, submittedBy: 'Amu N.', submittedDateHoursAgo: 160, recipient: 'DWS' },
    { id: 'rpt-06', siteId: 'site-catchment-dam-02', period: 'August 2026', status: 'submitted', dueHoursAgo: 200, submittedBy: 'Karabo S.', submittedDateHoursAgo: 140, recipient: 'DWS' },
];

async function seedUsers() {
    console.log('Seeding demo accounts...');
    const uidByEmail = {};
    for (const u of DEMO_USERS) {
        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(u.email);
            await auth.updateUser(userRecord.uid, { password: u.password, displayName: u.name });
        } catch (e) {
            if (e.code !== 'auth/user-not-found') throw e;
            userRecord = await auth.createUser({ email: u.email, password: u.password, displayName: u.name });
        }
        uidByEmail[u.email] = userRecord.uid;
        await db.collection('users').doc(userRecord.uid).set({
            name: u.name, initials: u.initials, role: u.role, title: u.title, email: u.email,
        }, { merge: true });
        console.log(`  ${u.email} -> uid ${userRecord.uid} (${u.role})`);
    }
    return uidByEmail;
}

async function seedSites() {
    console.log('Seeding sites + devices + reading history...');
    const batch = db.batch();
    for (const s of SITES) {
        const siteRef = db.collection('sites').doc(s.id);
        const sensors = {};
        const historyBySensor = {};
        for (const [key, d] of Object.entries(s.sensors)) {
            const hist = history(d.value, d.seed[0], 14, d.seed[1]);
            historyBySensor[key] = hist;
            sensors[key] = {
                label: d.label, value: d.value, unit: d.unit, status: d.status,
                ...(d.normRange ? { normRange: d.normRange } : {}),
            };
        }
        batch.set(siteRef, {
            name: s.name, mine: MINE_NAME, region: MINE_REGION,
            lat: s.lat, lng: s.lng, status: s.status, device: s.device, edgeStage: s.edgeStage,
            lastReading: admin.firestore.Timestamp.now(),
            sensors,
            actuators: {
                dosingPump: {
                    state: s.actuators.dosingPump.state, label: s.actuators.dosingPump.label,
                    lastActivated: s.actuators.dosingPump.lastActivatedHoursAgo == null ? null : admin.firestore.Timestamp.fromMillis(NOW - s.actuators.dosingPump.lastActivatedHoursAgo * 3600 * 1000),
                },
                valve: {
                    state: s.actuators.valve.state, label: s.actuators.valve.label,
                    lastActivated: s.actuators.valve.lastActivatedHoursAgo == null ? null : admin.firestore.Timestamp.fromMillis(NOW - s.actuators.valve.lastActivatedHoursAgo * 3600 * 1000),
                },
            },
        }, { merge: true });

        // Device key: a long-ish demo secret. In a real deployment, generate
        // a proper random secret per device and flash it to the ESP32 —
        // don't derive it predictably from the device id like this demo does.
        const deviceKey = `demo-${s.device.toLowerCase()}`;
        batch.set(db.collection('devices').doc(deviceKey), { siteId: s.id, label: s.device });

        // Reading history -> readings subcollection (spaced back from now,
        // matching how the old sparkline data was laid out: ~1.5h apart).
        const points = historyBySensor.conductivity.length;
        for (let i = 0; i < points; i++) {
            const readingRef = siteRef.collection('readings').doc();
            const hoursBack = (points - 1 - i) * 1.5;
            batch.set(readingRef, {
                at: admin.firestore.Timestamp.fromMillis(NOW - hoursBack * 3600 * 1000),
                conductivity: historyBySensor.conductivity[i],
                waterLevel: historyBySensor.waterLevel[i],
                waterFlow: historyBySensor.waterFlow[i],
                gas: historyBySensor.gas[i],
            });
        }
    }
    await batch.commit();
}

async function seedIncidentsTasksReports() {
    console.log('Seeding incidents, tasks, reports...');
    const batch = db.batch();
    for (const inc of INCIDENTS) {
        const { hoursAgo: h, ...rest } = inc;
        batch.set(db.collection('incidents').doc(inc.id), {
            ...rest,
            timestamp: admin.firestore.Timestamp.fromMillis(NOW - h * 3600 * 1000),
        });
    }
    for (const t of TASKS) {
        const { dueHoursAgo, ...rest } = t;
        batch.set(db.collection('tasks').doc(t.id), {
            ...rest,
            due: admin.firestore.Timestamp.fromMillis(NOW - dueHoursAgo * 3600 * 1000),
        });
    }
    for (const r of REPORTS) {
        const { dueHoursAgo, submittedDateHoursAgo, ...rest } = r;
        batch.set(db.collection('reports').doc(r.id), {
            ...rest,
            dueDate: admin.firestore.Timestamp.fromMillis(NOW - dueHoursAgo * 3600 * 1000),
            submittedDate: submittedDateHoursAgo == null ? null : admin.firestore.Timestamp.fromMillis(NOW - submittedDateHoursAgo * 3600 * 1000),
        });
    }
    await batch.commit();
}

async function main() {
    await seedUsers();
    await seedSites();
    await seedIncidentsTasksReports();
    console.log('\nDone. Demo sign-in accounts:');
    DEMO_USERS.forEach((u) => console.log(`  ${u.title}: ${u.email} / ${u.password}`));
    process.exit(0);
}

main().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
