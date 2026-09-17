// AquaSentinel — Firebase app bootstrap (ES module).
//
// Every other Firebase-aware module (auth.js, data.js) imports `auth` and
// `db` from here, so the app is initialized exactly once. Loaded as
// type="module" — see SETUP.md for why that matters (import order).
//
// If you need a newer SDK version, check https://firebase.google.com/docs/web/setup
// and update the version number in the three import URLs below together.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const cfg = window.AQUA_FIREBASE_CONFIG;
if (!cfg || cfg.apiKey === 'TODO-paste-from-firebase-console') {
    // eslint-disable-next-line no-console
    console.warn(
        'AquaSentinel: js/firebase-config.js still has placeholder values.\n' +
        'Sign-in and data will not work until you paste in your Firebase project config — see SETUP.md, step 1.'
    );
}

export const app = initializeApp(cfg || {});
export const auth = getAuth(app);
export const db = getFirestore(app);
