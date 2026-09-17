# AquaSentinel — Firebase backend setup

This turns the site from a static mock into a real app backed by
Firestore (database), Firebase Authentication (real accounts + roles),
and one Cloud Function (the endpoint your ESP32 devices will eventually
push readings to). Everything here is code already — this doc is the
handful of steps only you can do, because they need your own Google
account.

Budget about 20–30 minutes the first time.

## What you'll have at the end

- A live Firebase project with Firestore + Authentication turned on
- 3 real sign-in accounts (Compliance Manager / Field Officer / Viewer),
  matching demo data seeded into Firestore
- The site running locally against that real backend, with live updates
- (Optional) the site + Cloud Function deployed to the internet

## 0. Install prerequisites (once)

You need [Node.js](https://nodejs.org) (18 or later) and the Firebase CLI:

```
npm install -g firebase-tools
firebase login
```

`firebase login` opens a browser window — sign in with the Google account
you want to own this project.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
   Name it something like `aquasentinel-demo`. You can skip Google
   Analytics — not needed here.
2. Once created, click the **web** icon (`</>`) to register a web app.
   Give it any nickname. You do **not** need Firebase Hosting checked at
   this step (we'll do that later, optionally).
3. Firebase shows you a `firebaseConfig` object — copy those values into
   `js/firebase-config.js` in this project, replacing the `TODO`
   placeholders. It looks like:
   ```js
   window.AQUA_FIREBASE_CONFIG = {
       apiKey: 'AIza...',
       authDomain: 'aquasentinel-demo.firebaseapp.com',
       projectId: 'aquasentinel-demo',
       storageBucket: 'aquasentinel-demo.appspot.com',
       messagingSenderId: '...',
       appId: '...',
   };
   ```
   These values are not secret — Firestore security rules (already
   written for you, in `firestore.rules`) are what actually control
   access.

## 2. Turn on Firestore and Authentication

In the Firebase console, left sidebar:

1. **Build → Firestore Database → Create database.** Choose a region
   close to you (e.g. `europe-west1` or `me-central1`), start in
   **production mode** (the security rules in this project replace the
   default-deny as soon as you deploy them — step 4).
2. **Build → Authentication → Get started.** Under **Sign-in method**,
   enable **Email/Password**.

## 3. Link the CLI to this project

From this project's root folder (where `firebase.json` lives):

```
firebase use --add
```

Pick the project you just created, and give it an alias like `default`
when asked.

## 4. Deploy the security rules and the Cloud Function

```
cd functions
npm install
cd ..
firebase deploy --only firestore:rules,functions
```

This publishes `firestore.rules` (who can read/write what — see the
comments at the top of that file for the reasoning) and the
`ingestReading` / `onUserCreate` functions in `functions/index.js`.

If this is the very first Cloud Function you've deployed on this Google
Cloud project, the console may prompt you to enable billing (Cloud
Functions requires the pay-as-you-go Blaze plan — the free tier still
covers a hackathon demo's usage comfortably; you won't be charged unless
you go well beyond it).

## 5. Seed the demo data

This creates the 3 sign-in accounts and populates Firestore with the same
Khanyisa Colliery site/incident/task/report data the mock used to ship
with.

You'll need a **service account key** so the seed script can act as an
admin: in the Firebase console, go to **Project settings → Service
accounts → Generate new private key**. Save the downloaded file as
`seed/serviceAccountKey.json` (this filename is already covered by
`.gitignore` if you're using git — never commit it).

```
cd seed
npm install
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node seed.js
```

You should see it print the 3 demo accounts and their passwords. Re-run
this any time you want to reset the demo data back to its starting state
— it's safe to run repeatedly.

## 6. Run the site

No build step — it's still a static site, just now talking to a real
backend. Because it uses ES modules, open it through a local web server
rather than double-clicking the HTML file (browsers block module scripts
loaded via `file://`):

```
npx serve .
```

(or `python3 -m http.server 8000`, or the VS Code "Live Server"
extension — anything that serves plain static files works). Then open
the printed `localhost` URL and go to `login.html`. Sign in with one of
the 3 demo accounts shown on that page.

## 7. (Optional) Deploy it so it's reachable on the internet

```
firebase deploy --only hosting
```

Firebase gives you a `https://<project-id>.web.app` URL. Note: your
ESP32 devices will need internet access to reach the deployed
`ingestReading` Cloud Function endpoint (its URL is printed after
`firebase deploy --only functions`, and also visible under **Build →
Functions** in the console) — see the next section for the exact request
shape.

## Wiring up a real ESP32

Each device needs a **device key** — a per-device secret the
`ingestReading` function uses to know which site a reading belongs to
(see `firestore.rules`: devices are never readable from the browser, only
from the Cloud Function via the Admin SDK). The seed script already
created one per demo site, named `demo-<device-id>` (e.g.
`demo-esp32-aqs-002`) — check the `devices` collection in the Firestore
console, or read `seed/seed.js` to see exactly how they're derived. For
a real deployment, generate a proper random secret per device instead
and flash it into the device's own code — don't reuse the demo's
predictable naming scheme.

From the ESP32 (or any HTTP client, for testing), POST JSON to the
function's URL:

```
POST https://<region>-<project-id>.cloudfunctions.net/ingestReading
Content-Type: application/json

{
  "deviceKey": "demo-esp32-aqs-002",
  "ph": 3.4,
  "ec": 2380,
  "waterQuality": 31,
  "temperature": 19.8
}
```

The function computes each sensor's status from the same thresholds the
dashboard shows, updates that site's live snapshot, appends a reading to
its history (which is what feeds the trend charts and sparklines), and —
if the reading is warning/critical and there's no already-open incident
for that site — automatically logs one. This mirrors the real
architecture: the ESP32 already decided and acted locally (dosing pump /
valve) before it ever sends anything here; this endpoint is the "Send"
step, plus a server-side safety net that keeps a compliance record even
if a device's own report is dropped or delayed.

## Turn on the AI Incident Analysis Agent (System Logs page)

This is optional but is what powers the **System Logs** page: the moment
`ingestReading` (or a device) logs an incident, a second Cloud Function
(`onIncidentCreated`) reads that site's recent sensor history and asks an
AI model to turn it into a plain-language report — observations,
assessment, recommended actions — which is saved to Firestore and shown
on that page.

This uses **Google's Gemini API**, specifically because its free tier
needs no billing account or credit card — unlike most other AI providers,
where "free" usually just means a small trial credit before it starts
charging. As long as you stay within the free tier's request limits (fine
for a demo — a handful of incidents, not thousands of requests a minute),
this part costs nothing.

Important design point, worth knowing before you demo this: **the AI never
decides whether something is an incident, or how severe it is.** That's
already been decided by the fixed threshold rules in `functions/
thresholds.js` before the AI is ever called — the AI only explains and
recommends. The prompt (`functions/ai-report.js`) says this explicitly,
and the severity/site/timestamp saved to Firestore always come from the
incident record itself, never parsed out of the model's own text.

1. Get a free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   — sign in with any Google account, click **Create API key**. No card,
   no billing setup.
2. Store it as a Cloud Functions secret — **never** put it in
   `firebase-config.js` or anywhere else client-side:
   ```
   firebase functions:secrets:set GEMINI_API_KEY
   ```
   Paste the key when prompted.
3. Deploy (or redeploy) functions so the new trigger picks it up:
   ```
   firebase deploy --only functions
   ```
4. Trigger an incident (wait for a real one, or POST a test reading per
   the ESP32 section above with an out-of-range value) and check the
   **System Logs** page in the app a few seconds later.

If you'd rather skip this for now, everything else works fine without
it — the System Logs page just stays empty, and incidents/tasks/reports
are unaffected either way (this function is entirely separate from
`ingestReading`, so a slow or failed AI call can never block or delay the
actual incident being logged).

**A separate, unavoidable note on cost:** Cloud Functions itself (both this
one and `ingestReading`) requires Firebase's Blaze (pay-as-you-go) plan —
that's a Firebase platform requirement, not something tied to which AI
provider you pick, and it was already true before this feature existed.
Blaze still asks for a card on file, but its free-tier quotas (2 million
function invocations/month, generous Firestore reads/writes) comfortably
cover a demo project — you're very unlikely to actually be charged
anything. If you specifically want to avoid putting a card on Firebase at
all, the only way around that is skipping Cloud Functions entirely, which
means no `ingestReading` endpoint and no AI reports — the rest of the
dashboard (Firestore + Auth) still works fine without them.

## Troubleshooting

- **"Missing or insufficient permissions" in the browser console** —
  you're signed in, but as the wrong role for the action you tried (e.g.
  a Field Officer trying to submit a report), or the rules haven't been
  deployed yet (step 4).
- **Login page says "that email/password combination doesn't match an
  account"** — run the seed script (step 5); it creates the 3 demo
  Firebase Auth accounts, they don't exist until then.
- **Nothing loads, console shows a Firebase config error** — double
  check `js/firebase-config.js` has your real project's values, not the
  `TODO` placeholders.
- **A new account you create yourself (outside the seed script) can only
  view, not edit, anything** — that's intentional (see
  `functions/index.js`'s `onUserCreate`): every new sign-up defaults to
  the read-only Viewer role. Promote someone to Field Officer or
  Compliance Manager by editing their document under `users/{uid}` in
  the Firestore console and changing its `role` field.
- **System Logs page stays empty** — either no incident has fired yet, or
  the `ANTHROPIC_API_KEY` secret above hasn't been set/deployed. Check
  the Cloud Functions logs (`firebase functions:log` or the Firebase
  console's Functions tab) for `onIncidentCreated` — a "failed" entry
  there, or a matching `status: 'failed'` document in the `aiReports`
  collection, will show the actual error.
