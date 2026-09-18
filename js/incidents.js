// AquaSentinel — Incidents log: filter, table, and a detail drawer with
// trigger, automated response, before/after evidence, and audit trail.
// Status changes now write to Firestore (see firestore.rules for who's
// allowed) and the table/drawer both re-render live off AQUA.onChange —
// including when someone else's change comes in.

import { AQUA } from './data.js';
import { AQUA_AUTH } from './auth.js';
import { AQUA_SHELL } from './app-shell.js';

document.addEventListener('DOMContentLoaded', async () => {
    const user = await AQUA_SHELL.renderShell('incidents', { title: 'Incidents', breadcrumb: 'Compliance Command Centre' });
    if (!user) return; // not signed in — redirect to login.html already underway

    const severitySel = document.getElementById('filter-severity');
    const statusSel = document.getElementById('filter-status');
    const siteSel = document.getElementById('filter-site');
    const tableBody = document.getElementById('incidents-table');
    const resultCount = document.getElementById('result-count');
    const drawer = document.getElementById('incident-drawer');
    const drawerBackdrop = document.getElementById('drawer-backdrop');
    const drawerContent = document.getElementById('incident-drawer-content');

    let openDrawerId = new URLSearchParams(window.location.search).get('id') || null;

    function statusOptions(current) {
        return ['open', 'investigating', 'resolved'].map((v) =>
            `<option value="${v}" ${v === current ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`
        ).join('');
    }

    function closeDrawer() {
        openDrawerId = null;
        drawer.classList.add('translate-x-full');
        drawerBackdrop.classList.add('opacity-0', 'pointer-events-none');
        history.replaceState(null, '', 'incidents.html');
    }
    drawerBackdrop.addEventListener('click', closeDrawer);

    function renderDrawer() {
        if (!openDrawerId) return;
        const inc = AQUA.incidents.find((i) => i.id === openDrawerId);
        if (!inc) { closeDrawer(); return; }
        const site = AQUA.siteById(inc.siteId);
        const canEdit = AQUA_AUTH.can('editIncidents');

        drawerContent.innerHTML = `
            <div class="flex items-start justify-between mb-6">
                <div>
                    <div class="text-xs font-mono text-slate-500 mb-1">#${inc.id.toUpperCase()}</div>
                    <h2 class="font-display text-xl font-bold text-white">${site ? site.name : inc.siteId}</h2>
                </div>
                <button id="drawer-close" class="w-9 h-9 rounded-xl glass-panel flex items-center justify-center text-slate-300 hover:text-white shrink-0">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div class="flex items-center gap-2 mb-5">
                ${AQUA_SHELL.statusBadge(inc.severity)}
                <span class="text-xs text-slate-500">${AQUA.fmtDate(inc.timestamp)}</span>
            </div>

            <div class="mb-5">
                <div class="text-xs uppercase tracking-widest text-cyan-400 font-semibold mb-2">Trigger</div>
                <p class="text-sm text-slate-200 leading-relaxed">${inc.trigger}</p>
            </div>

            <div class="mb-5">
                <div class="text-xs uppercase tracking-widest text-cyan-400 font-semibold mb-2">Automated Response</div>
                <ul class="space-y-2">
                    ${inc.response.map((r) => `<li class="flex items-start gap-2 text-sm text-slate-200"><i class="fa-solid fa-bolt text-cyan-400 mt-0.5"></i><span>${r}</span></li>`).join('')}
                </ul>
            </div>

            <div class="mb-5">
                <div class="text-xs uppercase tracking-widest text-cyan-400 font-semibold mb-2">Evidence — Before / After</div>
                <div class="grid grid-cols-2 gap-3">
                    <div class="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
                        <div class="text-[10px] uppercase text-slate-500 mb-2">Before</div>
                        <div class="text-xs text-slate-300 space-y-1">
                            <div>Conductivity: <span class="text-white font-semibold">${inc.evidence.before.conductivity} µS/cm</span></div>
                            <div>Water Level: <span class="text-white font-semibold">${inc.evidence.before.waterLevel}%</span></div>
                            <div>Gas (CO₂): <span class="text-white font-semibold">${inc.evidence.before.gas} ppm</span></div>
                        </div>
                    </div>
                    <div class="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
                        <div class="text-[10px] uppercase text-slate-500 mb-2">After</div>
                        <div class="text-xs text-slate-300 space-y-1">
                            <div>Conductivity: <span class="text-white font-semibold">${inc.evidence.after.conductivity} µS/cm</span></div>
                            <div>Water Level: <span class="text-white font-semibold">${inc.evidence.after.waterLevel}%</span></div>
                            <div>Gas (CO₂): <span class="text-white font-semibold">${inc.evidence.after.gas} ppm</span></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="mb-5">
                <div class="text-xs uppercase tracking-widest text-cyan-400 font-semibold mb-2">Audit Trail</div>
                <ol class="space-y-3 border-l border-slate-800 pl-4">
                    ${inc.audit.map((a) => `
                        <li class="relative">
                            <span class="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-cyan-400"></span>
                            <div class="text-xs text-slate-500">${AQUA.fmtDate(a.at)}</div>
                            <div class="text-sm text-slate-200">${a.text}</div>
                        </li>`).join('')}
                </ol>
            </div>

            <div class="mb-2">
                <div class="text-xs uppercase tracking-widest text-cyan-400 font-semibold mb-2">Assigned To</div>
                <p class="text-sm text-slate-200">${inc.assignedTo || '—'}</p>
            </div>

            <div class="pt-4 border-t border-slate-800 mt-5">
                <label class="text-xs uppercase tracking-widest text-cyan-400 font-semibold mb-2 block">Update Status</label>
                <select id="drawer-status-select" class="gated-select w-full bg-slate-900 border border-slate-700 text-sm text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-cyan-500" ${canEdit ? '' : 'disabled'}>
                    ${statusOptions(inc.status)}
                </select>
                ${canEdit ? '' : '<p class="gated-note mt-2"><i class="fa-solid fa-lock mr-1"></i>Your role is read-only — sign in as a Field Officer or Compliance Manager to update status.</p>'}
            </div>
        `;

        document.getElementById('drawer-close').addEventListener('click', closeDrawer);
        const statusSelectEl = document.getElementById('drawer-status-select');
        if (canEdit) {
            statusSelectEl.addEventListener('change', async (e) => {
                const newStatus = e.target.value;
                statusSelectEl.disabled = true;
                try {
                    await AQUA.updateIncidentStatus(inc.id, newStatus, AQUA_AUTH.currentUser().name);
                    // The Firestore listener will re-render this drawer with
                    // the fresh status + audit entry once the write lands.
                } catch (err) {
                    console.error(err);
                    alert('Could not update status: ' + err.message);
                    statusSelectEl.disabled = false;
                }
            });
        }

        drawer.classList.remove('translate-x-full');
        drawerBackdrop.classList.remove('opacity-0', 'pointer-events-none');
        history.replaceState(null, '', `incidents.html?id=${openDrawerId}`);
    }

    function openDrawer(incId) { openDrawerId = incId; renderDrawer(); }

    function renderTable() {
        const sevFilter = severitySel.value, statFilter = statusSel.value, siteFilter = siteSel.value;
        const rows = AQUA.incidents
            .filter((i) => sevFilter === 'all' || i.severity === sevFilter)
            .filter((i) => statFilter === 'all' || i.status === statFilter)
            .filter((i) => siteFilter === 'all' || i.siteId === siteFilter)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        resultCount.textContent = `${rows.length} incident${rows.length === 1 ? '' : 's'}`;

        tableBody.innerHTML = rows.map((inc) => {
            const site = AQUA.siteById(inc.siteId);
            return `
            <tr class="row-link" data-id="${inc.id}">
                <td class="font-mono text-slate-400">#${inc.id.toUpperCase()}</td>
                <td class="text-white font-medium">${site ? site.name : inc.siteId}</td>
                <td>${AQUA_SHELL.statusBadge(inc.severity, { size: 'sm' })}</td>
                <td class="text-slate-300 max-w-xs truncate">${inc.trigger}</td>
                <td class="capitalize text-slate-300">${inc.status}</td>
                <td class="text-slate-500 whitespace-nowrap">${AQUA.timeAgo(inc.timestamp)}</td>
            </tr>`;
        }).join('') || `<tr><td colspan="6" class="text-center text-slate-500 py-10">No incidents match these filters.</td></tr>`;

        tableBody.querySelectorAll('.row-link').forEach((row) => {
            row.addEventListener('click', () => openDrawer(row.dataset.id));
        });
    }

    [severitySel, statusSel, siteSel].forEach((sel) => sel.addEventListener('change', renderTable));

    function render() {
        // Site filter options only need populating once — guard against
        // AQUA.onChange firing repeatedly as new readings stream in.
        if (siteSel.options.length <= 1) {
            siteSel.innerHTML += AQUA.sites.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
        }
        renderTable();
        renderDrawer();
    }

    AQUA.onChange(render);
});
