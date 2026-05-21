// api/lib/_scoring.js
// KloudAudit — Audit Scoring Engine
// Calculates waste scores, letter grades, and performance metrics

'use strict';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const MAX_POSSIBLE_ISSUES = 23; // Total checks across all sections (from AUDIT_SECTIONS)

// Impact weights for score calculation
const IMPACT_WEIGHTS = {
  'Critical': 10,
  'High': 7,
  'Medium': 4,
  'Low': 2,
};

// ── CALCULATE WASTE SCORE ─────────────────────────────────────────────────────
/**
 * Calculate waste score (0-100) based on flagged issues
 * Higher score = BETTER (less waste)
 * 
 * @param {Array<string>} flaggedIds - Array of flagged check IDs (e.g., ['rightsizing', 'spot'])
 * @param {number} monthlyBill - Monthly cloud spend
 * @param {number} savingsMin - Minimum estimated savings
 * @param {Array<object>} allChecks - All available checks with impact levels (from AUDIT_SECTIONS)
 * @returns {number} Score from 0-100
 */
function calculateWasteScore(flaggedIds = [], monthlyBill = 0, savingsMin = 0, allChecks = []) {
  // Start with perfect score
  let score = 100;
  
  // ── PENALTY 1: Number of issues found ──
  const issueCountPenalty = (flaggedIds.length / MAX_POSSIBLE_ISSUES) * 30;
  score -= issueCountPenalty;
  
  // ── PENALTY 2: Impact severity of issues ──
  let impactPenalty = 0;
  flaggedIds.forEach(id => {
    const check = allChecks.find(c => c.id === id);
    if (check && check.impact) {
      impactPenalty += IMPACT_WEIGHTS[check.impact] || 0;
    }
  });
  // Normalize impact penalty (max ~40 points)
  score -= Math.min(40, impactPenalty);
  
  // ── PENALTY 3: Waste percentage ──
  if (monthlyBill > 0 && savingsMin > 0) {
    const wastePercentage = (savingsMin / monthlyBill) * 100;
    if (wastePercentage > 40) score -= 20;      // >40% waste = critical
    else if (wastePercentage > 30) score -= 15; // >30% waste = very bad
    else if (wastePercentage > 20) score -= 10; // >20% waste = bad
    else if (wastePercentage > 10) score -= 5;  // >10% waste = could improve
  }
  
  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── CALCULATE LETTER GRADE ────────────────────────────────────────────────────
/**
 * Convert numerical score to letter grade
 * @param {number} score - Waste score (0-100)
 * @returns {string} Letter grade (A+, A, B+, B, C+, C, D, F)
 */
function getLetterGrade(score) {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 85) return 'B+';
  if (score >= 80) return 'B';
  if (score >= 75) return 'C+';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ── GET GRADE COLOR ───────────────────────────────────────────────────────────
/**
 * Get color for grade display
 * @param {string} grade - Letter grade
 * @returns {string} Hex color code
 */
function getGradeColor(grade) {
  if (grade.startsWith('A')) return '#4ade80'; // green
  if (grade.startsWith('B')) return '#fbbf24'; // yellow
  if (grade.startsWith('C')) return '#fb923c'; // orange
  return '#f87171'; // red (D and F)
}

// ── GET SCORE COLOR ───────────────────────────────────────────────────────────
/**
 * Get color for numerical score display
 * @param {number} score - Waste score (0-100)
 * @returns {string} Hex color code
 */
function getScoreColor(score) {
  if (score >= 80) return '#4ade80'; // green
  if (score >= 60) return '#fbbf24'; // yellow
  if (score >= 40) return '#fb923c'; // orange
  return '#f87171'; // red
}

// ── CALCULATE ALL SCORES ──────────────────────────────────────────────────────
/**
 * Calculate complete scoring data for an audit
 * @param {object} auditData - Audit data object
 * @returns {object} Complete scoring data
 */
function calculateScores(auditData) {
  const {
    flaggedIds = [],
    monthlyBill = 0,
    savingsMin = 0,
    savingsMax = 0,
    allChecks = [],
  } = auditData;
  
  const wasteScore = calculateWasteScore(flaggedIds, monthlyBill, savingsMin, allChecks);
  const letterGrade = getLetterGrade(wasteScore);
  const gradeColor = getGradeColor(letterGrade);
  const scoreColor = getScoreColor(wasteScore);
  
  // Calculate waste percentage
  const wastePercentage = monthlyBill > 0 
    ? Math.round((savingsMin / monthlyBill) * 100)
    : 0;
  
  // Calculate annual impact
  const annualSavingsMin = savingsMin * 12;
  const annualSavingsMax = savingsMax * 12;
  
  return {
    wasteScore,
    letterGrade,
    gradeColor,
    scoreColor,
    wastePercentage,
    flaggedCount: flaggedIds.length,
    totalChecks: allChecks.length || MAX_POSSIBLE_ISSUES,
    annualSavingsMin,
    annualSavingsMax,
    monthlyBill,
    savingsMin,
    savingsMax,
  };
}

// ── GET PERFORMANCE MESSAGE ───────────────────────────────────────────────────
/**
 * Get human-readable message based on score
 * @param {number} score - Waste score (0-100)
 * @param {string} grade - Letter grade
 * @returns {string} Performance message
 */
function getPerformanceMessage(score, grade) {
  if (score >= 90) {
    return '🎉 Excellent! Your cloud infrastructure is highly optimized.';
  }
  if (score >= 80) {
    return '👍 Great job! Minor improvements could save even more.';
  }
  if (score >= 70) {
    return '⚠️ Good foundation, but significant savings are available.';
  }
  if (score >= 60) {
    return '⚠️ Your cloud has notable waste. Time to optimize.';
  }
  if (score >= 40) {
    return '🚨 Critical issues detected. Immediate action recommended.';
  }
  return '🚨 Severe waste detected. Your cloud is burning cash.';
}

// ── COMPARE SCORES ────────────────────────────────────────────────────────────
/**
 * Compare two audit scores (for battle mode / before-after)
 * @param {number} score1 - First score
 * @param {number} score2 - Second score
 * @returns {object} Comparison result
 */
function compareScores(score1, score2) {
  const diff = score2 - score1;
  const improvement = diff > 0;
  const percentChange = score1 > 0 ? Math.abs((diff / score1) * 100) : 0;
  
  return {
    diff: Math.abs(diff),
    improvement,
    percentChange: Math.round(percentChange),
    winner: improvement ? 2 : 1,
    message: improvement 
      ? `${diff} points better (${Math.round(percentChange)}% improvement)`
      : diff < 0 
        ? `${Math.abs(diff)} points worse`
        : 'Same score',
  };
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
module.exports = {
  calculateWasteScore,
  getLetterGrade,
  getGradeColor,
  getScoreColor,
  calculateScores,
  getPerformanceMessage,
  compareScores,
  
  // Constants (for testing)
  MAX_POSSIBLE_ISSUES,
  IMPACT_WEIGHTS,
};
