// api/geo.js — returns visitor country code using Vercel's built-in geo header.
// No third-party API, no rate limits, no CORS issues.
module.exports = function handler(req, res) {
  const country = req.headers['x-vercel-ip-country'] || '';
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ country_code: country });
};
