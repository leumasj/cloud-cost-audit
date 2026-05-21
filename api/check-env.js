// api/check-env.js
// Diagnostic endpoint - DELETE AFTER TESTING

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  return res.status(200).json({
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    supabaseUrlPrefix: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 30) + '...' : 'NOT SET',
    hasSupabaseKey: !!process.env.SUPABASE_ANON_KEY,
    nodeVersion: process.version,
    vercelEnv: process.env.VERCEL_ENV,
  });
};
