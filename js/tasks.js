// AquaSentinel — Tasks & Compliance: inspection/maintenance task list and
// compliance report tracking. Status changes and report submissions now
// write to Firestore (gated by firestore.rules) and the page re-renders
// live off AQUA.onChange.

import { AQUA } from './data.js';
import { AQUA_AUTH } from './auth.js';
import { AQUA_SHELL } from './app-shell.js';

document.addEventListener('DOMContentLoaded', async () => {
    const user = await AQUA_SHELL.renderShell('tasks', { title: 'Tasks & Compliance', breadcrumb: 'Compliance Command Centre' });
    if (!user) return; // not signed in — redirect to login.html already underway

    const TASK_STATUS = {
        pending:     { label: 'Pending',     cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
        'in-progress': { label: 'In Progress', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
        done:        { label: 'Done',        cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    };
    const REPORT_STATUS = {
        submitted: { label: 'Submitted', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
        pending:   { label: 'Pending',   cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
        overdue:   { label: 'Overdue',   cls: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
    };
    const PRIORITY_CLS = { high: 'text-rose-400', medium: 'text-amber-400', low: 'text-slate-400' };

    function pill(meta) {
        return `<span class="status-badge ${meta.cls}"><span class="status-dot" style="background:currentColor"></span>${meta.label}</span>`;
    }

    // ---- Tabs (static wiring, independent of data) ----
    const tabBtns = document.querySelectorAll('.tab-btn');
    const panels = { tasks: document.getElementById('panel-tasks'), reports: document.getElementById('panel-reports') };
    tabBtns.forEach((btn) => btn.addEventListener('click', () => {
        tabBtns.forEach((b) => b.classList.remove('text-cyan-400', 'border-cyan-400'));
        tabBtns.forEach((b) => b.classList.add('text-slate-400', 'border-transparent'));
        btn.classList.remove('text-slate-400', 'border-transparent');
        btn.classList.add('text-cyan-400', 'border-cyan-400');
        Object.entries(panels).forEach(([key, el]) => el.classList.toggle('hidden', key !== btn.dataset.tab));
    }));

    // ---- Report modal (static wiring) ----
    const modalBackdrop = document.getElementById('report-modal-backdrop');
    const modalMeta = document.getElementById('report-modal-meta');
    const reportForm = document.getElementById('report-form');
    let activeReportId = null;

    function openReportModal(reportId) {
        const r = AQUA.reports.find((rp) => rp.id === reportId);
        const site = AQUA.siteById(r.siteId);
        activeReportId = reportId;
        modalMeta.textContent = `${site ? site.name : r.siteId} — ${r.period}${r.recipient ? ' · to ' + r.recipient : ''}`;
        modalBackdrop.classList.remove('opacity-0', 'pointer-events-none');
    }
    function closeReportModal() {
        modalBackdrop.classList.add('opacity-0', 'pointer-events-none');
        activeReportId = null;
    }
    document.getElementById('report-modal-close').addEventListener('click', closeReportModal);
    modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeReportModal(); });
    reportForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = reportForm.querySelector('button[type=submit]');
        submitBtn.disabled = true;
        try {
            await AQUA.submitReport(activeReportId, AQUA_AUTH.currentUser().name);
            closeReportModal();
        } catch (err) {
            console.error(err);
            alert('Could not submit report: ' + err.message);
        } finally {
            submitBtn.disabled = false;
        }
    });

    function render() {
        const canEditTasks = AQUA_AUTH.can('editTasks');
        const canSubmitReports = AQUA_AUTH.can('submitReports');

        // ---- Stat tiles ----
        const pendingTasks = AQUA.tasks.filter((t) => t.status !== 'done').length;
        const overdueReports = AQUA.reports.filter((r) => r.status === 'overdue').length;
        const submittedReports = AQUA.reports.filter((r) => r.status === 'submitted').length;
        const tiles = [
            { label: 'Open Tasks', value: pendingTasks, icon: 'fa-list-check', color: 'text-cyan-400' },
            { label: 'Overdue Reports', value: overdueReports, icon: 'fa-file-circle-exclamation', color: 'text-rose-400' },
            { label: 'Submitted Reports', value: submittedReports, icon: 'fa-file-circle-check', color: 'text-emerald-400' },
            { label: 'Total Sites', value: AQUA.sites.length, icon: 'fa-map-location-dot', color: 'text-cyan-400' },
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

        // ---- Tasks table ----
        document.getElementById('tasks-table').innerHTML = AQUA.tasks.map((t) => {
            const site = AQUA.siteById(t.siteId);
            return `
            <tr>
                <td class="text-white font-medium">${t.title}</td>
                <td class="text-slate-300">${site ? site.name : t.siteId}</td>
                <td class="text-slate-300">${t.assignedTo}</td>
                <td class="text-slate-400 whitespace-nowrap">${AQUA.fmtDate(t.due)}</td>
                <td class="${PRIORITY_CLS[t.priority]} font-semibold capitalize">${t.priority}</td>
                <td>
                    <select data-id="${t.id}" class="gated-select task-status-select bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-2 py-1.5 focus:outline-none focus:border-cyan-500" ${canEditTasks ? '' : 'disabled'}>
                        ${Object.keys(TASK_STATUS).map((k) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${TASK_STATUS[k].label}</option>`).join('')}
                    </select>
                </td>
            </tr>`;
        }).join('') + (canEditTasks ? '' : `<tr><td colspan="6" class="gated-note text-center py-2"><i class="fa-solid fa-lock mr-1"></i>Viewer role is read-only — task status can't be changed.</td></tr>`);

        if (canEditTasks) {
            document.querySelectorAll('.task-status-select').forEach((sel) => {
                sel.addEventListener('change', async (e) => {
                    const id = e.target.dataset.id;
                    const newStatus = e.target.value;
                    e.target.disabled = true;
                    try {
                        await AQUA.updateTaskStatus(id, newStatus);
                    } catch (err) {
                        console.error(err);
                        alert('Could not update task: ' + err.message);
                        e.target.disabled = false;
                    }
                });
            });
        }

        // ---- Reports table ----
        document.getElementById('reports-table').innerHTML = AQUA.reports.map((r) => {
            const site = AQUA.siteById(r.siteId);
            const canSubmit = r.status !== 'submitted' && canSubmitReports;
            let action;
            if (r.status === 'submitted') {
                action = `<span class="text-slate-600 text-xs">Filed</span>`;
            } else if (canSubmit) {
                action = `<button data-id="${r.id}" class="submit-report-btn text-cyan-400 hover:text-cyan-300 text-xs font-semibold whitespace-nowrap"><i class="fa-solid fa-upload mr-1"></i>Submit</button>`;
            } else {
                action = `<span class="gated-note whitespace-nowrap" title="Only a Compliance Manager can submit reports"><i class="fa-solid fa-lock mr-1"></i>Manager only</span>`;
            }
            return `
            <tr>
                <td class="text-white font-medium">${site ? site.name : r.siteId}</td>
                <td class="text-slate-300">${r.period}${r.recipient ? `<div class="text-[10px] text-slate-500 mt-0.5">to ${r.recipient}</div>` : ''}</td>
                <td>${pill(REPORT_STATUS[r.status])}</td>
                <td class="text-slate-400 whitespace-nowrap">${AQUA.fmtDate(r.dueDate)}</td>
                <td class="text-slate-300">${r.submittedBy || '—'}</td>
                <td class="text-right">${action}</td>
            </tr>`;
        }).join('');

        document.querySelectorAll('.submit-report-btn').forEach((btn) => {
            btn.addEventListener('click', () => openReportModal(btn.dataset.id));
        });
    }

    AQUA.onChange(render);
});
