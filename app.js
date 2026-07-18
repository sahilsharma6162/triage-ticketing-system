const express = require('express');
const ticketRoutes = require('./routes/ticketRoutes');

const app = express();

// Standard parsers
app.use(express.json());

// Log requests
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// REST Root Router registration
app.use('/api', ticketRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[App Error Output]:', err);
  res.status(err.status || 500).json({
    error: err.message || 'An unexpected backend internal error occurred.'
  });
});

module.exports = app;
