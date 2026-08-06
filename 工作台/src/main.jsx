import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import '@radix-ui/themes/styles.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/landing.css';
import './styles/workspaces.css';
import './styles/blueprint.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
