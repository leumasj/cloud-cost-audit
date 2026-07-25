// api/lib/_sanitize.js
// Shared text sanitization for values that get embedded in Claude prompts.

// Strips newlines/control chars (which could be used to simulate new
// instruction blocks) and caps length, since none of these fields
// legitimately need to be long or multi-line.
function sanitizeForPrompt(str, maxLen = 100) {
  return String(str).replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ').trim().slice(0, maxLen);
}

module.exports = { sanitizeForPrompt };
