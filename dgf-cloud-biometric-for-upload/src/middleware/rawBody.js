/**
 * ADMS devices POST plain-text bodies (not JSON), and the exact
 * content-type a given firmware sends isn't guaranteed. Capture the raw
 * text body ourselves instead of relying on express.json()/express.text()
 * picking the right parser.
 */
function rawBodyMiddleware(req, res, next) {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks).toString('utf8');
    next();
  });
  req.on('error', next);
}

module.exports = { rawBodyMiddleware };
