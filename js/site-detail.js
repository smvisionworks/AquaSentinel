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
        { key: 'waterQuality', icon: 'fa-droplet' },
        { key: 'ph', icon: 'fa-flask' },
        { key: 'ec', icon: 'fa-bolt-lightning' },
        { key: 'temperature', icon: 'fa-temperature-half' },
    ];
    const statusColor = { normal: '#34d399', warning: '#fbbf24', critical: '#fb7185' };

    let currentSiteId = null;
    let readingsUnsub = null;
    let latestReadings = [];

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
            { key: 'sense', label: 'Sense', icon: 'fa-satellite-dish', desc: '4 sensors sample the water' },
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
                <div class="text-[11px] text-slate-500 mb-3">${rangeText}</div>
                <div class="chart-wrap chart-${m.key}"></div>
            </div>`;
        }).join('');

        sensorMeta.forEach((m) => {
            const d = site.sensors[m.key];
            const el = document.querySelector(`.chart-${m.key}`);
            const history = latestReadings.map((r) => r[m.key]).filter((v) => typeof v === 'number');
            if (el && d && history.length) {
                AQUA_CHARTS.renderTrendChart(el, history, { color: statusColor[d.status], unit: ' ' + d.unit, normRange: d.normRange });
            }
        });
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
                <td class="text-white font-medium">${r.ph}</td>
                <td class="text-white font-medium">${r.ec}</td>
                <td class="text-white font-medium">${r.temperature}°C</td>
            </tr>`);
        document.getElementById('reading-log').innerHTML = rows.join('') || `<tr><td colspan="4" class="text-center text-slate-500 py-6">No readings yet.</td></tr>`;
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
