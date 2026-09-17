// AquaSentinel — login screen: real Firebase email/password sign-in.
//
// Demo credentials are shown on the page itself (see login.html) — this
// is a hackathon/demo build, not a production login flow. Run
// seed/seed.js against your Firebase project first to create these
// accounts (see SETUP.md).

import { AQUA_AUTH } from './auth.js';

document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('login-form');
    const emailEl = document.getElementById('login-email');
    const passwordEl = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit');
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next') || 'command-centre.html';

    // Already signed in? Skip straight through instead of asking again.
    const existing = await AQUA_AUTH.whenReady();
    if (existing) {
        window.location.href = next;
        return;
    }

    document.querySelectorAll('.demo-fill').forEach((btn) => {
        btn.addEventListener('click', () => {
            emailEl.value = btn.dataset.email;
            passwordEl.value = btn.dataset.password;
        });
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in…';
        try {
            await AQUA_AUTH.login(emailEl.value.trim(), passwordEl.value);
            window.location.href = next;
        } catch (err) {
            errorEl.textContent = humanizeAuthError(err);
            errorEl.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In';
        }
    });
});

function humanizeAuthError(err) {
    const code = err && err.code;
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        return "That email/password combination doesn't match an account. Run seed/seed.js against your Firebase project to create the demo accounts (see SETUP.md).";
    }
    if (code === 'auth/invalid-email') return 'Enter a valid email address.';
    if (code === 'auth/too-many-requests') return 'Too many attempts — wait a moment and try again.';
    return (err && err.message) || 'Sign-in failed. Check your Firebase config in js/firebase-config.js.';
}
