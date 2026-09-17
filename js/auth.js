// AquaSentinel — real auth, backed by Firebase Authentication + a
// users/{uid} Firestore doc for role. Replaces the earlier localStorage
// mock (same idea — one mine, several staff, permission separation not
// tenant separation — just backed by a real account now instead of a
// clicked demo card).
//
// External shape kept close to the old mock version on purpose, so
// app-shell.js and the gated pages barely had to change: currentUser(),
// can(), requireAuth(), logout(). login() is now async and takes a
// password, since it's a real sign-in.

import { auth, db } from './firebase-init.js';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const ROLES = {
    field: {
        key: 'field', label: 'Field Officer',
        description: 'Acknowledges incidents and completes inspection/maintenance tasks on site.',
        canEditIncidents: true, canEditTasks: true, canSubmitReports: false,
    },
    compliance: {
        key: 'compliance', label: 'Compliance Manager',
        description: 'Full access — manages incidents, tasks, and submits the formal compliance reports.',
        canEditIncidents: true, canEditTasks: true, canSubmitReports: true,
    },
    viewer: {
        key: 'viewer', label: 'Viewer',
        description: 'Read-only overview across every site — no status changes, no submissions.',
        canEditIncidents: false, canEditTasks: false, canSubmitReports: false,
    },
};

// Cached, synchronously-readable session state. Firebase Auth's own state
// (and the linked Firestore role doc) resolve asynchronously — this cache
// is what lets currentUser()/can() stay simple synchronous calls for the
// rest of the app, same as before. It's null until the first resolution.
let _sessionUser = null;
let _roleUnsub = null;
const _readyWaiters = [];
let _ready = false;

function notifyReady() {
    _ready = true;
    _readyWaiters.splice(0).forEach((fn) => fn(_sessionUser));
}

onAuthStateChanged(auth, (fbUser) => {
    if (_roleUnsub) { _roleUnsub(); _roleUnsub = null; }

    if (!fbUser) {
        _sessionUser = null;
        notifyReady();
        return;
    }

    // Live-listen the role doc (not just a one-off read) so a role change
    // made by an admin in the Firestore console takes effect on this
    // user's next render without them having to sign out and back in.
    _roleUnsub = onSnapshot(doc(db, 'users', fbUser.uid), (snap) => {
        const data = snap.exists() ? snap.data() : {};
        _sessionUser = {
            uid: fbUser.uid,
            email: fbUser.email,
            name: data.name || fbUser.displayName || fbUser.email,
            initials: data.initials || (fbUser.email || '?').slice(0, 2).toUpperCase(),
            role: data.role || 'viewer',
            title: data.title || ROLES[data.role || 'viewer'].label,
        };
        notifyReady();
    }, (err) => {
        // eslint-disable-next-line no-console
        console.error('AquaSentinel: could not read users/ role doc', err);
        _sessionUser = { uid: fbUser.uid, email: fbUser.email, name: fbUser.email, initials: '?', role: 'viewer', title: 'Viewer' };
        notifyReady();
    });
});

// Resolves once the first auth-state (+ role doc, if signed in) result is
// in. Callers that need to know "are we signed in" before rendering
// anything should await this rather than reading currentUser() cold.
function whenReady() {
    if (_ready) return Promise.resolve(_sessionUser);
    return new Promise((resolve) => _readyWaiters.push(resolve));
}

function currentUser() {
    return _sessionUser;
}

async function login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    // Wait for onAuthStateChanged + the role-doc listener to populate the
    // cache with THIS uid before returning, so callers can rely on
    // currentUser() right after login() resolves. Deliberately doesn't
    // reuse the `_ready` latch (which only ever needs to fire once, for
    // requireAuth()'s "has auth resolved at all yet" check) — resetting
    // that flag here raced against onAuthStateChanged firing before this
    // await returned, which could leave the reset promise waiting on a
    // notifyReady() that had already happened and would never happen
    // again.
    return new Promise((resolve) => {
        function check() {
            if (_sessionUser && _sessionUser.uid === uid) resolve(_sessionUser);
            else _readyWaiters.push(check);
        }
        check();
    });
}

async function logout() {
    await signOut(auth);
}

function roleOf(user) {
    user = user || currentUser();
    return ROLES[(user && user.role) || 'viewer'];
}

function can(action) {
    const r = roleOf();
    if (action === 'editIncidents') return !!r.canEditIncidents;
    if (action === 'editTasks') return !!r.canEditTasks;
    if (action === 'submitReports') return !!r.canSubmitReports;
    return false;
}

// Redirects to login.html if nobody's signed in once the first auth check
// completes. Async now (real auth needs a round trip) — callers must
// await it. Returns the user, or null having already kicked off a
// redirect.
async function requireAuth() {
    const u = await whenReady();
    if (!u) {
        const here = location.pathname.split('/').pop() + location.search;
        location.href = 'login.html?next=' + encodeURIComponent(here);
        return null;
    }
    return u;
}

export const AQUA_AUTH = { ROLES, currentUser, login, logout, roleOf, can, requireAuth, whenReady };
window.AQUA_AUTH = AQUA_AUTH; // console-debugging convenience only
