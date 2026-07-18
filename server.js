require('dotenv').config();
const app = require('./app');
const db = require('./config/db');

const PORT = parseInt(process.env.PORT || '3000', 10);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[+] Smart Ticket Triage System Running at: http://localhost:${PORT}`);
});

// Graceful Shut-Down
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('\n[*] Signal received. Shutting down server gracefully...');
  server.close(() => {
    console.log('[*] Server shut down.');
    db.pool.end(() => {
      console.log('[*] Database Pool connections drained. Process exit.');
      process.exit(0);
    });
  });
}
