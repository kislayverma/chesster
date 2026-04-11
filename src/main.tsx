import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { useProfileStore } from './profile/profileStore';

// Kick off profile hydration before the first render so the dashboard
// doesn't flash an empty state on reload. The store starts in a
// "not hydrated" mode and pages that care render a loading placeholder
// until this resolves.
void useProfileStore.getState().hydrate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
