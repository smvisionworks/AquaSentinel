// AquaSentinel — System Logs: the AI Compliance Agent's generated incident
// reports. Read-only for every role (same visibility as the incidents they
// explain) — there's nothing to edit here, this is a record of what the
// agent produced, not a workflow.

import { AQUA } from './data.js';
import { AQUA_SHELL } from './app-shell.js';

document.addEventListener('DOMContentLoaded', async () => {
    const user = await AQUA_SHELL.renderShell('system-logs', { title: 'System Logs', breadcrumb: 'AI Compliance Agent' });
    if (!user) return; // not signed in — redirect to login.html already underway

    const severitySel = document.getElementById('filter-severity');
    const list = document.getElementById('reports-list');
    const resultCount = document.getElementById('result-count');

    function reportCard(r) {
        const site = AQUA.siteById(r.siteId);
        const siteName = r.siteName || (site && site.name) || r.siteId;

        if (r.status === 'failed') {
            return `
            <div class="glass-panel rounded-2xl border border-slate-800 p-5 opacity-70">
                <div class="flex items-center gap-2 mb-2">
                    <i class="fa-solid fa-triangle-exclamation text-slate-500"></i>
                    <span class="text-sm font-semibold text-slate-300">AI report generation failed</span>
                    <span class="text-xs text-slate-500 ml-auto">${r.generatedAt ? AQUA.timeAgo(r.generatedAt) : ''}</span>
                </div>
                <p class="text-xs text-slate-500">Site: ${siteName} · Incident #${(r.incidentId || '').toUpperCase()}</p>
                <p class="text-xs text-slate-600 mt-1 font-mono">${r.error || 'Unknown error'}</p>
            </div>`;
        }

        return `
        <div class="glass-panel rounded-2xl border border-slate-800 p-5">
            <div class="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        <i class="fa-solid fa-robot text-cyan-400"></i>
                        <h3 class="font-display font-bold text-white">${r.title || 'Water Quality Incident'}</h3>
                    </div>
                    <p class="text-xs text-slate-500">
                        ${siteName} ·
                        <a href="incidents.html?id=${r.incidentId}" class="text-cyan-400 hover:underline">#${(r.incidentId || '').toUpperCase()}</a>
                        · Detected ${r.detectedAt ? AQUA.fmtDate(r.detectedAt) : '—'}
                    </p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    ${AQUA_SHELL.statusBadge(r.severity, { size: 'sm' })}
                    <span class="text-[10px] text-slate-500">${r.generatedAt ? AQUA.timeAgo(r.generatedAt) : ''}</span>
                </div>
            </div>

            <div class="mb-3">
                <div class="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold mb-1.5">Observations</div>
                <ul class="space-y-1">
                    ${r.observations.map((o) => `<li class="flex items-start gap-2 text-sm text-slate-200"><i class="fa-solid fa-circle-dot text-cyan-500/60 text-[6px] mt-2"></i><span>${o}</span></li>`).join('')}
                </ul>
            </div>

            <div class="mb-3">
                <div class="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold mb-1.5">Assessment</div>
                <p class="text-sm text-slate-300 leading-relaxed">${r.assessment}</p>
            </div>

            <div class="mb-3">
                <div class="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold mb-1.5">Recommended Action</div>
                <ul class="space-y-1">
                    ${r.recommendedActions.map((a) => `<li class="flex items-start gap-2 text-sm text-slate-200"><i class="fa-solid fa-bolt text-amber-400 mt-0.5"></i><span>${a}</span></li>`).join('')}
                </ul>
            </div>

            <div class="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                <p class="text-xs text-slate-500 italic">${r.evidenceSummary || ''}</p>
                <span class="text-[10px] text-slate-600 font-mono shrink-0">${r.model || ''}</span>
            </div>
        </div>`;
    }

    function render() {
        const sevFilter = severitySel.value;
        const rows = AQUA.aiReports
            .filter((r) => sevFilter === 'all' || r.severity === sevFilter)
            .sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0));

        resultCount.textContent = `${rows.length} report${rows.length === 1 ? '' : 's'}`;

        list.innerHTML = rows.map(reportCard).join('') || `
            <div class="glass-panel rounded-2xl border border-slate-800 p-10 text-center text-slate-500">
                <i class="fa-solid fa-robot text-3xl mb-3 text-slate-700"></i>
                <p class="text-sm">No AI incident reports yet — one will appear here automatically the next time a site reports a warning or critical reading.</p>
            </div>`;
    }

    severitySel.addEventListener('change', render);
    AQUA.onChange(render);
});
