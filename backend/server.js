require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 5001;

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: corsOrigin.includes(',') ? corsOrigin.split(',').map((s) => s.trim()) : corsOrigin }));
app.use(express.json());

app.use('/api/v1', routes);

// 404 for unknown API paths
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Error handler — log the detail, return something generic.
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`HyperTessera API running on http://localhost:${PORT}`);
  console.log(`  health   http://localhost:${PORT}/api/v1/health`);
  console.log(`  metrics  http://localhost:${PORT}/api/v1/metrics/homepage`);
  console.log(`  products http://localhost:${PORT}/api/v1/products`);
});
