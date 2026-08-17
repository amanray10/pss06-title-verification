import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';
import './index.css';

/**
 * The Google OAuth *client ID* is public by design - it ships to every browser
 * that loads the app, and it is useless without the authorised-origin
 * allowlist configured in the Google Cloud console. It is still read from the
 * environment rather than hard-coded, so a fork can point at its own Google
 * project without editing source. (The client *secret* is never used here;
 * this is the browser implicit flow.)
 *
 * Set it in frontend/.env:
 *   VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
 */
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

if (!clientId) {
  console.warn(
    '[PSS06] VITE_GOOGLE_CLIENT_ID is not set - "Continue with Google" will '
    + 'not work. Copy frontend/.env.example to frontend/.env and add your '
    + 'client ID from https://console.cloud.google.com/apis/credentials. '
    + 'Email + password sign-in works without it.'
  );
}

// The provider is always mounted: useGoogleLogin() needs its context to exist
// even when the button is never clicked.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={clientId}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>
);
