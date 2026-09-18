// AquaSentinel — sensor threshold logic, kept separate from the Firestore/
// Admin SDK plumbing in index.js so it can be unit-tested with plain node
// (no firebase-admin/firebase-functions install required).

// Conductivity (capacitive water sensor) — used as our turbidity proxy.
// Numerically identical to the old EC bounds: higher dissolved/suspended
// solids read as higher conductivity, same as they did as EC.
function statusForConductivity(v) {
    if (v > 2000) return 'critical';
    if (v > 1200) return 'warning';
    return 'normal';
}
// Water level, as % of tank/containment height from the water sensor.
// Low = leak/empty risk, high = overflow risk.
function statusForWaterLevel(v) {
    if (v < 10 || v > 95) return 'critical';
    if (v < 20 || v > 85) return 'warning';
    return 'normal';
}
// Water flow, in L/min from the water sensor. Low = blockage, high = a
// burst pipe / uncontrolled discharge.
function statusForWaterFlow(v) {
    if (v < 1 || v > 40) return 'critical';
    if (v < 3 || v > 30) return 'warning';
    return 'normal';
}
// Dissolved/headspace CO2 gas, in ppm, from the gas sensor mounted face-down
// over the water surface.
function statusForGas(v) {
    if (v > 2000) return 'critical';
    if (v > 1000) return 'warning';
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
//
// NOTE: waterLevel/waterFlow/gas bounds are reasonable placeholder ranges
// (no datasheet/spec numbers were given for these three) — tune them once
// you know your tank geometry, expected flow rate, and gas sensor's real
// ppm response curve. conductivity reuses the old EC bounds directly.
const THRESHOLDS = {
    conductivity: { normal: '≤ 1200 µS/cm', warning: '1200–2000 µS/cm', critical: '> 2000 µS/cm' },
    waterLevel: { normal: '20% – 85%', warning: '10–20% or 85–95%', critical: '< 10% or > 95%' },
    waterFlow: { normal: '3 – 30 L/min', warning: '1–3 or 30–40 L/min', critical: '< 1 or > 40 L/min' },
    gas: { normal: '≤ 1000 ppm CO₂', warning: '1000–2000 ppm CO₂', critical: '> 2000 ppm CO₂' },
};

module.exports = { statusForConductivity, statusForWaterLevel, statusForWaterFlow, statusForGas, worstOf, THRESHOLDS };
