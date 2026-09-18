// AquaSentinel — live data layer, backed by Firestore.
//
// Same public shape the old static mock exposed (AQUA.sites/incidents/
// tasks/reports, siteById/incidentsForSite/tasksForSite, fmtDate/timeAgo)
// so the dashboard pages needed only small changes — mainly: data now
// arrives asynchronously, so pages subscribe with AQUA.onChange(render)
// instead of reading the arrays once at load, and status/task/report
// changes go through the write helpers here instead of mutating objects
// in memory.

import { AQUA_AUTH } from './auth.js';
import { db } from './firebase-init.js';
import {
    collection, doc, onSnapshot, orderBy, query, limitToLast,
    updateDoc, arrayUnion, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ---- status helpers -------------------------------------------------
// Status colors are reserved and always paired with an icon + label in
// the UI — never color alone.
const STATUS = {
    normal:   { label: 'Normal',   dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: 'fa-circle-check' },
    warning:  { label: 'Warning',  dot: 'bg-amber-400',   text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   icon: 'fa-triangle-exclamation' },
    critical: { label: 'Critical', dot: 'bg-rose-400',    text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    icon: 'fa-circle-exclamation' },
};

function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
}

// Firestore Timestamp -> ISO string, passing through anything that's
// already a plain value (or null/undefined) unchanged.
function tsToIso(ts) {
    if (ts && typeof ts.toDate === 'function') return ts.toDate().toISOString();
    return ts || null;
}

function mapSite(id, data) {
    const act = data.actuators || {};
    return {
        id,
        name: data.name, mine: data.mine, region: data.region,
        lat: data.lat, lng: data.lng, status: data.status,
        lastReading: tsToIso(data.lastReading),
        device: data.device, edgeStage: data.edgeStage,
        sensors: data.sensors || {},
        actuators: {
            dosingPump: { ...(act.dosingPump || {}), lastActivated: tsToIso(act.dosingPump && act.dosingPump.lastActivated) },
            valve: { ...(act.valve || {}), lastActivated: tsToIso(act.valve && act.valve.lastActivated) },
        },
    };
}
function mapIncident(id, data) {
    return { id, siteId: data.siteId, severity: data.severity, timestamp: tsToIso(data.timestamp), trigger: data.trigger, response: data.response || [], evidence: data.evidence || {}, status: data.status, assignedTo: data.assignedTo, audit: data.audit || [] };
}
function mapTask(id, data) {
    return { id, type: data.type, siteId: data.siteId, title: data.title, assignedTo: data.assignedTo, due: tsToIso(data.due), status: data.status, priority: data.priority };
}
function mapReport(id, data) {
    return { id, siteId: data.siteId, period: data.period, status: data.status, dueDate: tsToIso(data.dueDate), submittedBy: data.submittedBy, submittedDate: tsToIso(data.submittedDate), recipient: data.recipient };
}
function mapAiReport(id, data) {
    return {
        id, incidentId: data.incidentId, siteId: data.siteId, siteName: data.siteName,
        severity: data.severity, detectedAt: tsToIso(data.detectedAt), generatedAt: tsToIso(data.generatedAt),
        model: data.model, status: data.status, title: data.title,
        observations: data.observations || [], assessment: data.assessment,
        recommendedActions: data.recommendedActions || [], evidenceSummary: data.evidenceSummary,
        error: data.error,
    };
}

// ---- live state -----------------------------------------------------
const state = { sites: [], incidents: [], tasks: [], reports: [], aiReports: [] };
const loaded = { sites: false, incidents: false, tasks: false, reports: false, aiReports: false };
const listeners = new Set();

function allLoaded() { return Object.values(loaded).every(Boolean); }
function fireChange() { listeners.forEach((cb) => { try { cb(); } catch (e) { console.error(e); } }); }

let readyResolve;
const ready = new Promise((res) => { readyResolve = res; });
function markLoaded(key) {
    loaded[key] = true;
    if (allLoaded()) readyResolve();
    fireChange();
}

// Subscribes to future data changes; if the initial load already
// happened, fires immediately too, so pages can just do
// `AQUA.onChange(render)` and not separately handle the first paint.
function onChange(cb) {
    listeners.add(cb);
    if (allLoaded()) cb();
    return () => listeners.delete(cb);
}

function startListeners() {
    onSnapshot(collection(db, 'sites'), (snap) => {
        state.sites = snap.docs.map((d) => mapSite(d.id, d.data()));
        markLoaded('sites');
    }, (err) => console.error('AquaSentinel: sites listener failed', err));

    onSnapshot(collection(db, 'incidents'), (snap) => {
        state.incidents = snap.docs.map((d) => mapIncident(d.id, d.data()));
        markLoaded('incidents');
    }, (err) => console.error('AquaSentinel: incidents listener failed', err));

    onSnapshot(collection(db, 'tasks'), (snap) => {
        state.tasks = snap.docs.map((d) => mapTask(d.id, d.data()));
        markLoaded('tasks');
    }, (err) => console.error('AquaSentinel: tasks listener failed', err));

    onSnapshot(collection(db, 'reports'), (snap) => {
        state.reports = snap.docs.map((d) => mapReport(d.id, d.data()));
        markLoaded('reports');
    }, (err) => console.error('AquaSentinel: reports listener failed', err));

    onSnapshot(collection(db, 'aiReports'), (snap) => {
        state.aiReports = snap.docs.map((d) => mapAiReport(d.id, d.data()));
        markLoaded('aiReports');
    }, (err) => console.error('AquaSentinel: aiReports listener failed', err));
}

// Firestore reads need an authenticated request (see firestore.rules) —
// wait for sign-in before opening the collection listeners.
AQUA_AUTH.whenReady().then((user) => { if (user) startListeners(); });

function siteById(id) { return state.sites.find((s) => s.id === id); }
function incidentsForSite(id) { return state.incidents.filter((i) => i.siteId === id); }
function tasksForSite(id) { return state.tasks.filter((t) => t.siteId === id); }

// Live per-site reading history (for sparklines / trend charts) — kept
// out of the main sites listener since it's a subcollection query only
// the pages that actually chart it need. Returns an unsubscribe fn.
function watchSiteReadings(siteId, limitN, cb) {
    const q = query(collection(db, 'sites', siteId, 'readings'), orderBy('at', 'asc'), limitToLast(limitN));
    return onSnapshot(q, (snap) => {
        cb(snap.docs.map((d) => {
            const v = d.data();
            return { at: tsToIso(v.at), conductivity: v.conductivity, waterLevel: v.waterLevel, waterFlow: v.waterFlow, gas: v.gas };
        }));
    }, (err) => console.error('AquaSentinel: readings listener failed', err));
}

// ---- writes (gated by firestore.rules, not just the UI) -------------
async function updateIncidentStatus(incidentId, status, actorName) {
    await updateDoc(doc(db, 'incidents', incidentId), {
        status,
        audit: arrayUnion({ at: new Date().toISOString(), text: `Status changed to "${status}" by ${actorName}.` }),
    });
}
async function updateTaskStatus(taskId, status) {
    await updateDoc(doc(db, 'tasks', taskId), { status });
}
async function submitReport(reportId, actorName) {
    await updateDoc(doc(db, 'reports', reportId), {
        status: 'submitted', submittedBy: actorName, submittedDate: serverTimestamp(),
    });
}

export const AQUA = {
    STATUS,
    get sites() { return state.sites; },
    get incidents() { return state.incidents; },
    get tasks() { return state.tasks; },
    get reports() { return state.reports; },
    get aiReports() { return state.aiReports; },
    ready, onChange,
    siteById, incidentsForSite, tasksForSite, watchSiteReadings,
    updateIncidentStatus, updateTaskStatus, submitReport,
    fmtDate, timeAgo,
};
window.AQUA = AQUA; // console-debugging convenience only
