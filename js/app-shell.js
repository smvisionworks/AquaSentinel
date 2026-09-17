// AquaSentinel — shared dashboard chrome: sidebar, topbar, mobile toggle,
// and small render helpers (status badges) reused across every app page.

import { AQUA_AUTH } from './auth.js';
import { AQUA } from './data.js';

const NAV_ITEMS = [
    { key: 'command-centre', href: 'command-centre.html', label: 'Command Centre', icon: 'fa-satellite-dish' },
    { key: 'incidents', href: 'incidents.html', label: 'Incidents', icon: 'fa-triangle-exclamation' },
    { key: 'tasks', href: 'tasks.html', label: 'Tasks & Compliance', icon: 'fa-clipboard-check' },
    { key: 'system-logs', href: 'system-logs.html', label: 'System Logs', icon: 'fa-robot' },
];

function statusBadge(statusKey, opts) {
    opts = opts || {};
    const s = AQUA.STATUS[statusKey] || AQUA.STATUS.normal;
    const size = opts.size === 'sm' ? 'text-[10px] px-2 py-0.5' : '';
    return `<span class="status-badge ${s.bg} ${s.text} ${s.border} ${size}">
        <span class="status-dot ${s.dot}"></span>${s.label}
    </span>`;
}

// Every dashboard page is gated behind sign-in. Async now — real auth
// needs a round trip to resolve, so callers must `await` this before
// touching the DOM it builds. Returns the signed-in user, or null having
// already kicked off a redirect to login.html.
async function renderShell(activeKey, opts) {
    opts = opts || {};

    const user = await AQUA_AUTH.requireAuth();
    if (!user) return null;
    const role = AQUA_AUTH.roleOf(user);

    const sidebarEl = document.getElementById('sidebar');
    const topbarEl = document.getElementById('topbar');
    const backdropEl = document.getElementById('sidebar-backdrop');

    if (sidebarEl) {
        sidebarEl.innerHTML = `
            <div class="px-5 h-20 flex items-center border-b border-slate-800/80 shrink-0">
                <a href="index.html" class="flex items-center space-x-3">
                    <div class="logo-chip w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shrink-0">
                        <img src="assets/aquasentinel-icon.png" alt="AquaSentinel logo" class="w-full h-full object-cover">
                    </div>
                    <span class="font-display font-bold text-lg tracking-wider text-white">AQUA<span class="text-cyan-400">SENTINEL</span></span>
                </a>
            </div>
            <nav class="flex-1 overflow-y-auto px-3 py-5 space-y-1.5">
                ${NAV_ITEMS.map((item) => `
                    <a href="${item.href}" class="nav-link ${item.key === activeKey ? 'active' : ''}">
                        <i class="fa-solid ${item.icon}"></i>
                        <span>${item.label}</span>
                    </a>
                `).join('')}
            </nav>
            <div class="p-4 border-t border-slate-800/80 space-y-3">
                <a href="index.html" class="nav-link">
                    <i class="fa-solid fa-arrow-left"></i>
                    <span>Back to Homepage</span>
                </a>
                <div class="glass-panel rounded-xl p-3 flex items-center space-x-3">
                    <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white shrink-0">${user.initials}</div>
                    <div class="min-w-0 flex-1">
                        <div class="text-xs font-semibold text-white truncate">${user.name}</div>
                        <div class="text-[10px] text-slate-400 truncate">${role.label}</div>
                    </div>
                    <button id="shell-switch-user" class="switch-user-btn shrink-0" title="Sign out">
                        <i class="fa-solid fa-right-from-bracket"></i>
                    </button>
                </div>
            </div>
        `;
    }

    if (topbarEl) {
        topbarEl.innerHTML = `
            <div class="h-20 px-4 sm:px-6 flex items-center justify-between gap-4">
                <div class="flex items-center gap-3 min-w-0">
                    <button id="sidebar-toggle" class="lg:hidden w-10 h-10 rounded-xl glass-panel flex items-center justify-center text-slate-300 shrink-0">
                        <i class="fa-solid fa-bars"></i>
                    </button>
                    <div class="min-w-0">
                        <div class="text-[11px] uppercase tracking-widest text-cyan-400 font-semibold">${opts.breadcrumb || 'AquaSentinel'}</div>
                        <h1 class="font-display font-bold text-lg sm:text-xl text-white truncate">${opts.title || ''}</h1>
                    </div>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    <span class="hidden sm:inline-flex items-center px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2 animate-ping"></span>
                        System Live
                    </span>
                    <div class="user-chip">
                        <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">${user.initials}</div>
                        <div class="hidden sm:block min-w-0">
                            <div class="text-xs font-semibold text-white leading-tight truncate">${user.name}</div>
                            <span class="role-pill">${role.label}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    const toggleBtn = document.getElementById('sidebar-toggle');
    if (toggleBtn && sidebarEl && backdropEl) {
        toggleBtn.addEventListener('click', () => {
            sidebarEl.classList.add('open');
            backdropEl.classList.add('open');
        });
        backdropEl.addEventListener('click', () => {
            sidebarEl.classList.remove('open');
            backdropEl.classList.remove('open');
        });
    }

    const switchBtn = document.getElementById('shell-switch-user');
    if (switchBtn) {
        switchBtn.addEventListener('click', async () => {
            await AQUA_AUTH.logout();
            window.location.href = 'login.html';
        });
    }

    return user;
}

export const AQUA_SHELL = { renderShell, statusBadge, NAV_ITEMS };
window.AQUA_SHELL = AQUA_SHELL; // console-debugging convenience only
