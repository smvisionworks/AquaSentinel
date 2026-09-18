// AquaSentinel — Site Detail: sensors, edge pipeline, actuators, incidents,
// reading log for a single monitoring node (?id=<site-id> in the URL).
// Sensor trend charts are now backed by a live Firestore subcollection
// (sites/{id}/readings) rather than a baked-in history array.

import { AQUA } from './data.js';
import { AQUA_SHELL } from './app-shell.js';

document.addEventListener('DOMContentLoaded', async () => {
    const requestedId = new URLSearchParams(window.location.search).get('id');

    const user = await AQUA_SHELL.renderShell('command-centre', { title: 'Loading…', breadcrumb: 'Site Detail' });
    if (!user) return; // not signed in — redirect to login.html already underway

    const sensorMeta = [
        { key: 'conductivity', icon: 'fa-bolt-lightning' },
        { key: 'waterLevel', icon: 'fa-water' },
        { key: 'waterFlow', icon: 'fa-gauge-high' },
        { key: 'gas', icon: 'fa-smog' },
    ];
    let currentSiteId = null;
    let readingsUnsub = null;
    let latestReadings = [];

    // ---- ICT Baddies live feed relay -------------------------------
    // While this page is open on the "ICT Baddies" site (the teammate's
    // real ESP32, reporting into their hackathon-b819d Realtime Database),
    // poll that feed every 2 seconds — same cadence and field names as
    // their own dashboard's fetchData() — and forward each reading into
    // AquaSentinel's own ingestReading Cloud Function. That write is what
    // actually drives the sensor cards, trend charts and reading log
    // below: they're already listening to Firestore, so there's no
    // separate rendering path here, just this relay feeding the same pipe
    // every other device uses.
    const HACKATHON_FEED_URL = 'https://hackathon-b819d-default-rtdb.firebaseio.com/sensors.json';
    const HACKATHON_FEED_SITE_ID = 'site-field-prototype'; // "ICT Baddies"
    const HACKATHON_INGEST_URL = 'https://us-central1-aquasentinel-3db91.cloudfunctions.net/ingestReading';
    const HACKATHON_DEVICE_KEY = 'demo-esp32-proto-01';
    const HACKATHON_TANK_CAPACITY_LITRES = 50; // same placeholder used in functions/index.js's syncHackathonFeed

    let hackathonFeedTimer = null;
    let hackathonPrevWaterLevel = null;
    let hackathonPrevAt = null;

    async function pollHackathonFeed() {
        try {
            const resp = await fetch(HACKATHON_FEED_URL);
            const data = await resp.json();
            if (!data) return;
            const d = data.sensors ? data.sensors : data; // handles nested-under-'sensors' or root, like their own page

            if (typeof d.water_val !== 'number' || typeof d.turbidity_analog !== 'number' || typeof d.gas_val !== 'number') return;

            const waterLevel = Math.max(0, Math.min(100, Math.round((d.water_val / 2500) * 100)));
            const conductivity = d.turbidity_analog;
            const gas = d.gas_val;

            // No flow sensor in this feed — estimate it from how fast the
            // level changes between polls, same as the retired firmware did.
            let waterFlow = 0;
            const now = Date.now();
            if (hackathonPrevWaterLevel !== null && hackathonPrevAt) {
                const dtMinutes = (now - hackathonPrevAt) / 60000;
                if (dtMinutes > 0) {
                    waterFlow = (Math.abs(waterLevel - hackathonPrevWaterLevel) / 100) * HACKATHON_TANK_CAPACITY_LITRES / dtMinutes;
                }
            }
            hackathonPrevWaterLevel = waterLevel;
            hackathonPrevAt = now;

            await fetch(HACKATHON_INGEST_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceKey: HACKATHON_DEVICE_KEY, conductivity, waterLevel, waterFlow: Number(waterFlow.toFixed(2)), gas }),
            });
        } catch (err) {
            console.error('AquaSentinel: ICT Baddies feed poll failed', err);
        }
    }

    function syncHackathonFeedTimer(siteId) {
        if (siteId === HACKATHON_FEED_SITE_ID) {
            if (!hackathonFeedTimer) {
                pollHackathonFeed();
                hackathonFeedTimer = setInterval(pollHackathonFeed, 2000);
            }
        } else if (hackathonFeedTimer) {
            clearInterval(hackathonFeedTimer);
            hackathonFeedTimer = null;
            hackathonPrevWaterLevel = null;
            hackathonPrevAt = null;
        }
    }
    window.addEventListener('beforeunload', () => { if (hackathonFeedTimer) clearInterval(hackathonFeedTimer); });

    function renderHeader(site) {
        document.getElementById('site-header').innerHTML = `
            <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <div class="flex items-center gap-3 mb-2 flex-wrap">
                        <h1 class="font-display text-2xl sm:text-3xl font-bold text-white">${site.name}</h1>
                        ${AQUA_SHELL.statusBadge(site.status)}
                    </div>
                    <p class="text-slate-400 text-sm">${site.mine} · ${site.region}</p>
                    <div class="flex items-center gap-4 mt-3 text-xs text-slate-500">
                        <span><i class="fa-solid fa-microchip mr-1.5 text-cyan-400"></i>${site.device}</span>
                        <span><i class="fa-solid fa-clock mr-1.5 text-cyan-400"></i>Updated ${site.lastReading ? AQUA.timeAgo(site.lastReading) : '—'}</span>
                        <span><i class="fa-solid fa-location-dot mr-1.5 text-cyan-400"></i>${site.lat.toFixed(4)}, ${site.lng.toFixed(4)}</span>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    <label class="text-xs text-slate-400" for="site-switcher">Jump to site</label>
                    <select id="site-switcher" class="bg-slate-900 border border-slate-700 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-cyan-500">
                        ${AQUA.sites.map((s) => `<option value="${s.id}" ${s.id === site.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;
        document.getElementById('site-switcher').addEventListener('change', (e) => {
            window.location.href = 'site.html?id=' + e.target.value;
        });

        const topbarTitle = document.querySelector('#topbar h1');
        if (topbarTitle) topbarTitle.textContent = site.name;
    }

    function renderPipeline(site) {
        const stages = [
            { key: 'sense', label: 'Sense', icon: 'fa-satellite-dish', desc: 'Water + gas sensors sample the water' },
            { key: 'decide', label: 'Decide', icon: 'fa-microchip', desc: 'ESP32 compares to thresholds' },
            { key: 'act', label: 'Act', icon: 'fa-bolt', desc: 'Pump / valve respond locally' },
            { key: 'send', label: 'Send', icon: 'fa-cloud-arrow-up', desc: 'Reading logged to AquaSentinel' },
        ];
        const currentIdx = stages.findIndex((s) => s.key === site.edgeStage);
        document.getElementById('pipeline').innerHTML = stages.map((s, i) => {
            const state = i < currentIdx ? 'done' : (i === currentIdx ? 'active' : '');
            return `
                <div class="pipeline-step ${state}">
                    <div class="pipeline-line"></div>
                    <div class="step-dot"><i class="fa-solid ${s.icon}"></i></div>
                    <div class="text-xs font-semibold ${state === 'active' ? 'text-cyan-400' : state === 'done' ? 'text-emerald-400' : 'text-slate-500'}">${s.label}</div>
                    <div class="text-[10px] text-slate-500 mt-0.5 px-2">${s.desc}</div>
                </div>`;
        }).join('');
    }

    function renderSensorCards(site) {
        // Plain current-value readings, no trend chart — simpler, and
        // avoids the trend chart glitching on a site (like ICT Baddies)
        // that only has a handful of readings so far.
        document.getElementById('sensor-cards').innerHTML = sensorMeta.map((m) => {
            const d = site.sensors[m.key] || { label: m.key, value: '—', unit: '', status: 'normal' };
            const rangeText = d.normRange ? `Normal range: ${d.normRange[0]}–${d.normRange[1]} ${d.unit}` : 'Composite index (0–100)';
            return `
            <div class="glass-panel rounded-2xl p-5 border border-slate-800">
                <div class="flex items-start justify-between mb-1">
                    <div class="flex items-center gap-2 text-slate-300">
                        <i class="fa-solid ${m.icon} text-cyan-400"></i>
                        <span class="text-sm font-semibold">${d.label}</span>
                    </div>
                    ${AQUA_SHELL.statusBadge(d.status, { size: 'sm' })}
                </div>
                <div class="font-display text-3xl font-bold text-white mt-2">${d.value}<span class="text-base text-slate-400 font-sans font-normal ml-1">${d.unit}</span></div>
                <div class="text-[11px] text-slate-500">${rangeText}</div>
            </div>`;
        }).join('');
    }

    function renderActuators(site) {
        const actuatorMeta = {
            dosingPump: { icon: 'fa-syringe', states: { idle: { text: 'Idle', color: 'text-slate-400', dot: 'bg-slate-500' }, active: { text: 'Active — Dosing', color: 'text-cyan-400', dot: 'bg-cyan-400' } } },
            valve: { icon: 'fa-toggle-on', states: { open: { text: 'Open — Flow Normal', color: 'text-emerald-400', dot: 'bg-emerald-400' }, closed: { text: 'Closed — Contained', color: 'text-rose-400', dot: 'bg-rose-400' } } },
        };
        document.getElementById('actuator-cards').innerHTML = Object.keys(actuatorMeta).map((key) => {
            const a = site.actuators[key] || {};
            const meta = actuatorMeta[key];
            const stateInfo = meta.states[a.state] || meta.states[Object.keys(meta.states)[0]];
            return `
            <div class="glass-panel rounded-2xl p-5 border border-slate-800 flex items-center gap-4">
                <div class="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 text-xl shrink-0">
                    <i class="fa-solid ${meta.icon}"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="text-sm font-semibold text-white">${a.label || key}</div>
                    <div class="text-xs ${stateInfo.color} flex items-center gap-1.5 mt-1">
                        <span class="w-1.5 h-1.5 rounded-full ${stateInfo.dot} ${a.state === 'active' ? 'animate-pulse' : ''}"></span>${stateInfo.text}
                    </div>
                    <div class="text-[11px] text-slate-500 mt-1">${a.lastActivated ? 'Last activated ' + AQUA.timeAgo(a.lastActivated) : 'No recent activation'}</div>
                </div>
            </div>`;
        }).join('');
    }

    function renderIncidents(site) {
        const siteIncidents = AQUA.incidentsForSite(site.id);
        document.getElementById('site-incidents').innerHTML = siteIncidents.length ? siteIncidents.map((inc) => `
            <a href="incidents.html?id=${inc.id}" class="block bg-slate-900/60 hover:bg-slate-900 border border-slate-800 rounded-xl p-4 transition-colors">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-mono text-slate-500">#${inc.id.toUpperCase()}</span>
                    ${AQUA_SHELL.statusBadge(inc.severity, { size: 'sm' })}
                </div>
                <p class="text-sm text-slate-200 leading-snug">${inc.trigger}</p>
                <div class="text-[11px] text-slate-500 mt-2">${AQUA.timeAgo(inc.timestamp)} · Status: <span class="capitalize">${inc.status}</span></div>
            </a>
        `).join('') : `<div class="text-sm text-slate-500 text-center py-8">No incidents recorded for this site.</div>`;
    }

    function renderReadingLog() {
        const rows = latestReadings.slice(-8).reverse().map((r) => `
            <tr>
                <td class="text-slate-400">${r.at ? new Date(r.at).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td class="text-white font-medium">${r.conductivity} µS/cm</td>
                <td class="text-white font-medium">${r.waterLevel}%</td>
                <td class="text-white font-medium">${r.waterFlow} L/min</td>
                <td class="text-white font-medium">${r.gas} ppm</td>
            </tr>`);
        document.getElementById('reading-log').innerHTML = rows.join('') || `<tr><td colspan="5" class="text-center text-slate-500 py-6">No readings yet.</td></tr>`;
    }

    function render() {
        const site = AQUA.siteById(requestedId) || AQUA.sites[0];
        if (!site) return; // still loading

        if (site.id !== currentSiteId) {
            currentSiteId = site.id;
            if (readingsUnsub) readingsUnsub();
            readingsUnsub = AQUA.watchSiteReadings(site.id, 14, (readings) => {
                latestReadings = readings;
                const s = AQUA.siteById(currentSiteId);
                if (s) { renderSensorCards(s); renderReadingLog(); }
            });
            syncHackathonFeedTimer(site.id);
        }

        renderHeader(site);
        renderPipeline(site);
        renderSensorCards(site);
        renderActuators(site);
        renderIncidents(site);
        renderReadingLog();
    }

    AQUA.onChange(render);
});
