// api/lib/_validation.js
// KloudAudit — Centralized Input Validation Schemas
// Uses Zod for type-safe validation across all API endpoints

const { z } = require('zod');

// ── SESSION ID ────────────────────────────────────────────────────────────────
// Format: ka_1234567890123_abc1234
const SessionIdSchema = z.string()
  .regex(/^ka_\d{13,}_[a-z0-9]{7,}$/, 'Invalid session ID format')
  .max(100);

// ── EMAIL ─────────────────────────────────────────────────────────────────────
const EmailSchema = z.string()
  .email('Invalid email address')
  .max(255)
  .optional()
  .or(z.literal(null))
  .or(z.literal(''));

// ── PROVIDER ──────────────────────────────────────────────────────────────────
const ProviderSchema = z.enum(['AWS', 'GCP', 'Azure', 'Multi-cloud'], {
  errorMap: () => ({ message: 'Provider must be AWS, GCP, Azure, or Multi-cloud' })
});

// ── AUDIT TYPE ────────────────────────────────────────────────────────────────
const AuditTypeSchema = z.enum(['cost', 'security'], {
  errorMap: () => ({ message: 'Audit type must be cost or security' })
}).default('cost');

// ── SAVE AUDIT SCHEMA ─────────────────────────────────────────────────────────
const SaveAuditSchema = z.object({
  sessionId: SessionIdSchema,
  email: EmailSchema,
  provider: ProviderSchema,
  monthlyBill: z.number()
    .int('Monthly bill must be an integer')
    .min(0, 'Monthly bill cannot be negative')
    .max(100000000, 'Monthly bill exceeds maximum'), // $100M cap
  companyName: z.string()
    .max(200, 'Company name too long')
    .optional()
    .or(z.literal(null))
    .or(z.literal('')),
  flaggedIds: z.array(z.string().max(50))
    .max(50, 'Too many flagged issues (max 50)'),
  wasteScore: z.number()
    .int('Waste score must be an integer')
    .min(0, 'Waste score cannot be negative')
    .max(100, 'Waste score cannot exceed 100'),
  savingsMin: z.number()
    .int('Savings min must be an integer')
    .min(0, 'Savings min cannot be negative')
    .max(100000000, 'Savings min exceeds maximum'),
  savingsMax: z.number()
    .int('Savings max must be an integer')
    .min(0, 'Savings max cannot be negative')
    .max(100000000, 'Savings max exceeds maximum'),
  auditType: AuditTypeSchema,
});

// ── CHECKOUT SCHEMA ───────────────────────────────────────────────────────────
const CreateCheckoutSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  provider: ProviderSchema,
  monthlyBill: z.number().min(0).max(100000000),
  companyName: z.string().max(200),
  savingsMin: z.number().min(0).max(100000000),
  savingsMax: z.number().min(0).max(100000000),
  flaggedIssues: z.array(z.object({
    id: z.string().max(50),
    label: z.string().max(200),
  })).max(50),
  currency: z.string().regex(/^[a-z]{3}$/, 'Invalid currency code'),
  currencyAmount: z.number().int().min(1).max(1000000), // max $10,000
  sessionId: SessionIdSchema,
  productType: z.enum(['blueprint', 'security_blueprint', 'bundle']).optional(),
});

// ── BENCHMARK SCHEMA ──────────────────────────────────────────────────────────
const GetBenchmarksSchema = z.object({
  provider: ProviderSchema.optional(),
  minBill: z.coerce.number().min(0).max(100000000).optional(),
  maxBill: z.coerce.number().min(0).max(100000000).optional(),
});

// ── UNSUBSCRIBE SCHEMA ────────────────────────────────────────────────────────
const UnsubscribeSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
});

// ── VALIDATION HELPER ─────────────────────────────────────────────────────────
/**
 * Validate request body against a Zod schema
 * @param {object} data - Request body to validate
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
function validate(data, schema) {
  try {
    const validated = schema.parse(data);
    return { success: true, data: validated };
  } catch (err) {
    // Extract first error message
    const firstError = err.errors?.[0];
    const message = firstError 
      ? `${firstError.path.join('.')}: ${firstError.message}`
      : 'Validation error';
    
    return { 
      success: false, 
      error: message,
      details: err.errors, // full error details for debugging
    };
  }
}

module.exports = {
  // Schemas
  SessionIdSchema,
  EmailSchema,
  ProviderSchema,
  AuditTypeSchema,
  SaveAuditSchema,
  CreateCheckoutSchema,
  GetBenchmarksSchema,
  UnsubscribeSchema,
  
  // Helper
  validate,
};
