const express = require('express');
const { rawBodyMiddleware } = require('./middleware/rawBody');
const iclockRouter = require('./routes/iclock');

const app = express();

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'dgf-cloud-biometric', time: new Date().toISOString() });
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.use('/iclock', rawBodyMiddleware, iclockRouter);

// Last-resort error handler - a device should always get a response, never
// a hung connection or a stack trace.
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('[app] unhandled error:', err);
  res.status(200).type('text/plain').send('OK');
});

module.exports = app;
