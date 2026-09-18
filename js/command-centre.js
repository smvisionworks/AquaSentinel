// AquaSentinel — Command Centre: fleet-wide stats, live map, site grid.
// Re-renders automatically whenever Firestore pushes an update (a new
// ESP32 reading, a status change) — no page reload needed.

import { AQUA } from './data.js';
import { AQUA_SHELL } from './app-shell.js';

document.addEventListener('DOMContentLoaded', async () => {
    const user = await AQUA_SHELL.renderShell('command-centre', { title: 'Command Centre', breadcrumb: 'Compliance Command Centre' });
    if (!user) return; // not signed in — redirect to login.html already underway

    const statusColor = { normal: '#34d399', warning: '#fbbf24', critical: '#fb7185' };
    let map = null;
    const markersBySite = {};
    const sparkUnsubs = [];

    function render() {
        const sites = AQUA.sites;
        const counts = { normal: 0, warning: 0, critical: 0 };
        sites.forEach((s) => counts[s.status]++);
        const openIncidents = AQUA.incidents.filter((i) => i.status !== 'resolved').length;

        // ---- Stat tiles ----
        const tiles = [
            { label: 'Total Sites', value: sites.length, icon: 'fa-map-location-dot', color: 'text-cyan-400' },
            { label: 'Normal', value: counts.normal, icon: 'fa-circle-check', color: 'text-emerald-400' },
            { label: 'Warning', value: counts.warning, icon: 'fa-triangle-exclamation', color: 'text-amber-400' },
            { label: 'Critical', value: counts.critical, icon: 'fa-circle-exclamation', color: 'text-rose-400' },
            { label: 'Open Incidents', value: openIncidents, icon: 'fa-shield-halved', color: 'text-cyan-400' },
        ];
        document.getElementById('stat-tiles').innerHTML = tiles.map((t) => `
            <div class="glass-panel rounded-2xl p-5 border border-slate-800">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-slate-400 text-xs font-medium uppercase tracking-wide">${t.label}</span>
                    <i class="fa-solid ${t.icon} ${t.color}"></i>
                </div>
                <div class="font-display text-3xl font-bold text-white">${t.value}</div>
            </div>
        `).join('');

        // ---- Map (created once, then markers refreshed in place) ----
        if (!map) {
            map = L.map('site-map', { zoomControl: true, attributionControl: true }).setView([-25.870, 29.230], 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
                subdomains: 'abcd', maxZoom: 19,
            }).addTo(map);
        }

        const bounds = [];
        const seen = new Set();
        sites.forEach((site) => {
            seen.add(site.id);
            bounds.push([site.lat, site.lng]);
            const color = statusColor[site.status];
            const icon = L.divIcon({
                className: '',
                html: `<div class="site-pin ${site.status === 'critical' ? 'pulse' : ''}" style="background:${color}; position:relative;"></div>`,
                iconSize: [20, 20], iconAnchor: [10, 10],
            });
            const s = site.sensors;
            const popupHtml = `
                <div class="min-w-[220px]">
                    <div class="flex items-center justify-between mb-1.5">
                        <span class="font-display font-bold text-sm text-white">${site.name}</span>
                        ${AQUA_SHELL.statusBadge(site.status, { size: 'sm' })}
                    </div>
                    <div class="text-xs text-slate-400 mb-2">${site.mine} · ${site.region}</div>
                    <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-300 mb-3">
                        <div>Conductivity: <span class="text-white font-semibold">${s.conductivity ? s.conductivity.value : '—'} µS/cm</span></div>
                        <div>Water Level: <span class="text-white font-semibold">${s.waterLevel ? s.waterLevel.value : '—'}%</span></div>
                        <div>Flow: <span class="text-white font-semibold">${s.waterFlow ? s.waterFlow.value : '—'} L/min</span></div>
                        <div>Gas: <span class="text-white font-semibold">${s.gas ? s.gas.value : '—'} ppm</span></div>
                    </div>
                    <a href="site.html?id=${site.id}" class="inline-flex items-center gap-1.5 text-cyan-400 text-xs font-semibold hover:text-cyan-300">
                        View Site <i class="fa-solid fa-arrow-right text-[10px]"></i>
                    </a>
                </div>
            `;
            if (markersBySite[site.id]) {
                markersBySite[site.id].setIcon(icon);
                markersBySite[site.id].setPopupContent(popupHtml);
            } else {
                const marker = L.marker([site.lat, site.lng], { icon }).addTo(map);
                marker.bindPopup(popupHtml);
                markersBySite[site.id] = marker;
            }
        });
        Object.keys(markersBySite).forEach((id) => {
            if (!seen.has(id)) { map.removeLayer(markersBySite[id]); delete markersBySite[id]; }
        });
        if (!render.didFit && bounds.length) { map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 }); render.didFit = true; }

        // ---- Site grid ----
        document.getElementById('site-count').textContent = `${sites.length} active nodes`;
        document.getElementById('site-grid').innerHTML = sites.map((site) => {
            const s = site.sensors;
            return `
            <a href="site.html?id=${site.id}" class="glass-panel rounded-2xl p-5 border border-slate-800 hover:border-cyan-500/30 transition-colors block">
                <div class="flex items-start justify-between mb-3">
                    <div class="min-w-0">
                        <h3 class="font-display font-bold text-white text-sm truncate">${site.name}</h3>
                        <p class="text-slate-400 text-xs mt-0.5 truncate">${site.mine}</p>
                    </div>
                    ${AQUA_SHELL.statusBadge(site.status, { size: 'sm' })}
                </div>
                <div class="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div class="bg-slate-900/60 rounded-xl py-2">
                        <div class="text-[10px] text-slate-500 uppercase">Conductivity</div>
                        <div class="text-sm font-display font-bold text-white">${s.conductivity ? s.conductivity.value : '—'}</div>
                    </div>
                    <div class="bg-slate-900/60 rounded-xl py-2">
                        <div class="text-[10px] text-slate-500 uppercase">Level</div>
                        <div class="text-sm font-display font-bold text-white">${s.waterLevel ? s.waterLevel.value : '—'}%</div>
                    </div>
                    <div class="bg-slate-900/60 rounded-xl py-2">
                        <div class="text-[10px] text-slate-500 uppercase">Gas</div>
                        <div class="text-sm font-display font-bold text-white">${s.gas ? s.gas.value : '—'}</div>
                    </div>
                </div>
                <div class="spark-${site.id} h-9"></div>
                <div class="flex items-center justify-between mt-3 text-xs text-slate-500">
                    <span><i class="fa-solid fa-clock mr-1"></i>${site.lastReading ? AQUA.timeAgo(site.lastReading) : '—'}</span>
                    <span class="text-cyan-400 font-medium">View details →</span>
                </div>
            </a>`;
        }).join('');

        // Sparklines: live-subscribed per site, torn down and rebuilt each
        // render so they always track the currently-listed sites.
        sparkUnsubs.splice(0).forEach((unsub) => unsub());
        sites.forEach((site) => {
            const el = document.querySelector(`.spark-${CSS.escape(site.id)}`);
            if (!el) return;
            const unsub = AQUA.watchSiteReadings(site.id, 14, (readings) => {
                AQUA_CHARTS.renderSparkline(el, readings.map((r) => r.conductivity), statusColor[site.status]);
            });
            sparkUnsubs.push(unsub);
        });
    }

    AQUA.onChange(render);
});
