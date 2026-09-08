import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { createRuntime } from './runtime.js';
import './styles.css';

const rootElement = document.querySelector<HTMLDivElement>('#root');

if (!rootElement) {
  throw new Error('Desktop root element was not found.');
}

const runtime = createRuntime();

createRoot(rootElement).render(
  <StrictMode>
    <App client={runtime.client} pickRepository={runtime.pickRepository} />
  </StrictMode>,
);
