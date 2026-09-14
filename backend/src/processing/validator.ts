import { z } from 'zod';
import type { ExtractedData, ValidationIssue } from '../common/types.js';

/**
 * Business rules over the extracted fields (requirement 4).
 *
 * Kept separate from the request-validation schemas: those guard the API's
 * inputs, these guard what the processor claims to have read out of a document.
 * The two evolve for different reasons.
 *
 * Messages here are written for an operator reading the UI, not for a
 * developer — a validation failure is shown directly in the document detail view.
 */

/**
 * ISO-8601 calendar date, and a real one — `2026-02-31` matches the pattern and
 * parses in JavaScript, but does not exist.
 *
 * `superRefine` rather than `.regex().refine()`: chained checks both report on
 * a badly formatted date, and an operator should be told one thing that is
 * wrong with a field, not two overlapping things.
 */
const isoDate = z.string().superRefine((value, ctx) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Document date must be in YYYY-MM-DD format.',
    });
    return;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Document date is not a real calendar date.',
    });
  }
});

export const extractedDataSchema = z.object({
  companyName: z
    .string({ required_error: 'Company name is missing.' })
    .trim()
    .min(1, 'Company name is missing.'),

  registrationNumber: z
    .string({ required_error: 'Registration number is missing.' })
    .trim()
    .min(1, 'Registration number is missing.'),

  // Optional in the brief's example shape; validated only when present.
  address: z.string().trim().min(1, 'Address is missing.').optional(),

  annualRevenue: z
    .number({
      required_error: 'Annual revenue is missing.',
      invalid_type_error: 'Annual revenue must be a number.',
    })
    .finite('Annual revenue must be a number.')
    .min(0, 'Annual revenue cannot be negative.'),

  documentDate: isoDate,
});

export type ValidatedData = z.infer<typeof extractedDataSchema>;

export type ValidationOutcome =
  | { valid: true; data: ValidatedData }
  | { valid: false; issues: ValidationIssue[] };

/**
 * Maps a Zod issue to the stable `{ field, rule, message }` shape stored on the
 * document. `rule` is an identifier the UI and the logs can group by; it must
 * stay stable even if the wording of a message changes.
 */
function toIssue(issue: z.ZodIssue): ValidationIssue {
  const field = issue.path.join('.') || '(root)';

  let rule: string;
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    rule = 'required';
  } else if (issue.code === 'too_small') {
    rule = issue.minimum === 0 ? 'min' : 'required';
  } else if (issue.code === 'invalid_string' || issue.code === 'custom') {
    rule = 'format';
  } else {
    rule = issue.code;
  }

  return { field, rule, message: issue.message };
}

export function validateExtractedData(data: Partial<ExtractedData> | undefined): ValidationOutcome {
  // No data at all is a processor failure, not a validation failure, but the
  // validator must still answer safely if it is ever called with nothing.
  const parsed = extractedDataSchema.safeParse(data ?? {});

  if (parsed.success) {
    return { valid: true, data: parsed.data };
  }

  return { valid: false, issues: parsed.error.issues.map(toIssue) };
}
