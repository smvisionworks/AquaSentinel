// AquaSentinel — small reusable chart primitives (inline SVG, no chart
// library). Follows the house rules: thin 2px lines with rounded ends, a
// single sequential hue per series, recessive gridlines, and a hover
// crosshair + tooltip on anything that isn't a bare stat tile.

(function (global) {
    'use strict';

    function buildPath(values, w, h, padY) {
        const n = values.length;
        const min = Math.min(...values), max = Math.max(...values);
        const range = (max - min) || 1;
        const x = (i) => (i / (n - 1)) * w;
        const y = (v) => h - padY - ((v - min) / range) * (h - padY * 2);
        const pts = values.map((v, i) => [x(i), y(v)]);
        const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
        return { d, pts, min, max };
    }

    // Compact decorative sparkline for list rows / stat tiles — no hover,
    // matches the "bare stat tile" exception in the house dataviz rules.
    function renderSparkline(el, values, color) {
        color = color || '#22d3ee';
        const w = 120, h = 36, pad = 4;
        const { d } = buildPath(values, w, h, pad);
        el.innerHTML = `
            <svg viewBox="0 0 ${w} ${h}" class="w-full h-full" preserveAspectRatio="none">
                <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
            </svg>`;
    }

    // Full trend chart with a recessive normal-range band, gridline, and a
    // hover crosshair + tooltip — used on the Site Detail sensor cards.
    function renderTrendChart(el, values, opts) {
        opts = opts || {};
        const color = opts.color || '#22d3ee';
        const unit = opts.unit || '';
        const normRange = opts.normRange || null;
        const w = 320, h = 120, pad = 14;
        const { d, pts, min, max } = buildPath(values, w, h, pad);
        const range = (max - min) || 1;

        let bandRect = '';
        if (normRange) {
            const yTop = h - pad - ((Math.min(normRange[1], max) - min) / range) * (h - pad * 2);
            const yBot = h - pad - ((Math.max(normRange[0], min) - min) / range) * (h - pad * 2);
            bandRect = `<rect x="0" y="${yTop.toFixed(2)}" width="${w}" height="${Math.max(yBot - yTop, 0).toFixed(2)}" fill="#22d3ee" opacity="0.06"/>`;
        }

        const gradId = 'grad-' + Math.random().toString(36).slice(2, 9);
        const areaD = d + ` L${w},${h} L0,${h} Z`;

        el.innerHTML = `
            <svg viewBox="0 0 ${w} ${h}" class="w-full h-auto overflow-visible" preserveAspectRatio="none" role="img" aria-label="Trend chart">
                <defs>
                    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
                        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                ${bandRect}
                <line x1="0" y1="${h - pad}" x2="${w}" y2="${h - pad}" stroke="#334155" stroke-width="1" opacity="0.5"/>
                <path d="${areaD}" fill="url(#${gradId})" stroke="none"/>
                <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <g class="hover-layer" opacity="0">
                    <line class="hover-crosshair" x1="0" y1="0" x2="0" y2="${h}" stroke="#7dd3fc" stroke-width="1" stroke-dasharray="2,2"/>
                    <circle class="hover-dot" r="3.5" fill="${color}" stroke="#0a0f1d" stroke-width="1.5"/>
                </g>
            </svg>
            <div class="chart-tooltip glass-panel rounded-lg px-2.5 py-1.5 text-xs pointer-events-none absolute opacity-0 transition-opacity" style="z-index:20;"></div>
        `;

        const svg = el.querySelector('svg');
        const hoverLayer = el.querySelector('.hover-layer');
        const crosshair = el.querySelector('.hover-crosshair');
        const dot = el.querySelector('.hover-dot');
        const tooltip = el.querySelector('.chart-tooltip');
        el.style.position = el.style.position || 'relative';

        function onMove(evt) {
            const rect = svg.getBoundingClientRect();
            const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
            const relX = ((clientX - rect.left) / rect.width) * w;
            let idx = Math.round((relX / w) * (values.length - 1));
            idx = Math.max(0, Math.min(values.length - 1, idx));
            const p = pts[idx];
            crosshair.setAttribute('x1', p[0]); crosshair.setAttribute('x2', p[0]);
            dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]);
            hoverLayer.setAttribute('opacity', '1');
            tooltip.textContent = values[idx] + unit;
            const leftPct = (p[0] / w) * 100;
            tooltip.style.left = `calc(${leftPct}% - 24px)`;
            tooltip.style.top = '-6px';
            tooltip.classList.remove('opacity-0');
        }
        function onLeave() {
            hoverLayer.setAttribute('opacity', '0');
            tooltip.classList.add('opacity-0');
        }
        el.addEventListener('mousemove', onMove);
        el.addEventListener('mouseleave', onLeave);
        el.addEventListener('touchmove', onMove, { passive: true });
        el.addEventListener('touchend', onLeave);
    }

    global.AQUA_CHARTS = { renderSparkline, renderTrendChart };
})(window);
