import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Add a global error listener to help debug black screen issues
window.addEventListener('error', (event) => {
  console.error("Global UI Error:", event.error);
  // If we're early in boot, show it on screen
  const root = document.getElementById('root');
  if (root && root.innerHTML === "") {
    root.innerHTML = `<div style="padding: 20px; color: white; background: #900; font-family: sans-serif; direction: rtl; text-align: center;">
      <h2 style="margin-bottom: 10px;">هەڵەیەکی کوشندە ڕوویدا</h2>
      <p style="opacity: 0.8; font-size: 14px;">${event.message}</p>
      <button onclick="window.location.reload()" style="padding: 10px 20px; margin-top: 20px; background: white; color: black; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">دووبارە هەوڵ بدەرەوە</button>
    </div>`;
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
