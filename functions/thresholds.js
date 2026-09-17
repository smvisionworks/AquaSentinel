// AquaSentinel — sensor threshold logic, kept separate from the Firestore/
// Admin SDK plumbing in index.js so it can be unit-tested with plain node
// (no firebase-admin/firebase-functions install required).

function statusForPh(v) {
    if (v < 5.5 || v > 9.5) return 'critical';
    if (v < 6.5 || v > 8.5) return 'warning';
    return 'normal';
}
function statusForEc(v) {
    if (v > 2000) return 'critical';
    if (v > 1200) return 'warning';
    return 'normal';
}
function statusForTemperature(v) {
    if (v < 15 || v > 26) return 'warning';
    return 'normal';
}
function statusForWQI(v) {
    if (v < 50) return 'critical';
    if (v < 75) return 'warning';
    return 'normal';
}
const RANK = { normal: 0, warning: 1, critical: 2 };
function worstOf(statuses) {
    return statuses.reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'normal');
}

// Human-readable versions of the same numeric bounds above — the single
// source of truth the AI incident-report agent (ai-report.js) quotes back
// to the model, so its prompt never drifts out of sync with what the
// system actually enforces.
const THRESHOLDS = {
    ph: { normal: '6.5 – 8.5', warning: '5.5–6.5 or 8.5–9.5', critical: '< 5.5 or > 9.5' },
    ec: { normal: '≤ 1200 µS/cm', warning: '1200–2000 µS/cm', critical: '> 2000 µS/cm' },
    temperature: { normal: '15°C – 26°C', warning: '< 15°C or > 26°C', critical: 'n/a (temperature is only ever normal/warning)' },
    waterQuality: { normal: '≥ 75 (WQI)', warning: '50–75 (WQI)', critical: '< 50 (WQI)' },
};

module.exports = { statusForPh, statusForEc, statusForTemperature, statusForWQI, worstOf, THRESHOLDS };
