import { describe, expect, it } from 'vitest';
import { validateExtractedData } from '../../src/processing/validator.js';

const valid = {
  companyName: 'ABC Construction Pvt Ltd',
  registrationNumber: 'U12345DL2020PTC123456',
  address: 'New Delhi',
  annualRevenue: 12_500_000,
  documentDate: '2026-08-15',
};

/** Convenience: the set of `field:rule` pairs a validation produced. */
function failures(data: Record<string, unknown>): string[] {
  const outcome = validateExtractedData(data as never);
  return outcome.valid ? [] : outcome.issues.map((i) => `${i.field}:${i.rule}`);
}

describe('extracted data validation', () => {
  it('accepts a complete, well-formed extraction', () => {
    const outcome = validateExtractedData(valid);
    expect(outcome.valid).toBe(true);
  });

  it('requires companyName', () => {
    expect(failures({ ...valid, companyName: undefined })).toContain('companyName:required');
    // Whitespace is not a name.
    expect(failures({ ...valid, companyName: '   ' })).toContain('companyName:required');
  });

  it('requires registrationNumber', () => {
    expect(failures({ ...valid, registrationNumber: undefined })).toContain(
      'registrationNumber:required',
    );
    expect(failures({ ...valid, registrationNumber: '' })).toContain(
      'registrationNumber:required',
    );
  });

  it('rejects negative annualRevenue but accepts zero', () => {
    // Zero is the boundary: a dormant company legitimately reports no revenue.
    expect(validateExtractedData({ ...valid, annualRevenue: 0 }).valid).toBe(true);
    expect(failures({ ...valid, annualRevenue: -1 })).toContain('annualRevenue:min');
  });

  it('rejects a non-numeric annualRevenue', () => {
    const result = failures({ ...valid, annualRevenue: '12500000' });
    expect(result.some((f) => f.startsWith('annualRevenue:'))).toBe(true);
  });

  it('rejects a malformed or impossible documentDate', () => {
    expect(failures({ ...valid, documentDate: '15-08-2026' })).toContain('documentDate:format');
    // Parses in JS as 2026-03-03; a real calendar check must reject it.
    expect(failures({ ...valid, documentDate: '2026-02-31' })).toContain('documentDate:format');
    expect(failures({ ...valid, documentDate: 'not-a-date' })).toContain('documentDate:format');
  });

  it('reports one problem per field, not two overlapping ones', () => {
    // A malformed date is both "wrong format" and "not a real date"; the
    // operator should be told one thing that is wrong, not both.
    const outcome = validateExtractedData({ ...valid, documentDate: '15-08-2026' } as never);
    expect(outcome.valid).toBe(false);
    if (outcome.valid) return;

    const dateIssues = outcome.issues.filter((i) => i.field === 'documentDate');
    expect(dateIssues).toHaveLength(1);
    expect(dateIssues[0]?.message).toBe('Document date must be in YYYY-MM-DD format.');
  });

  it('treats address as optional', () => {
    const { address: _address, ...withoutAddress } = valid;
    expect(validateExtractedData(withoutAddress as never).valid).toBe(true);
  });

  it('reports every broken rule at once, not just the first', () => {
    const result = failures({ companyName: '', registrationNumber: '', annualRevenue: -5 });
    expect(result).toEqual(
      expect.arrayContaining([
        'companyName:required',
        'registrationNumber:required',
        'annualRevenue:min',
      ]),
    );
  });

  it('fails safely when the processor returned nothing', () => {
    const outcome = validateExtractedData(undefined);
    expect(outcome.valid).toBe(false);
  });

  it('produces messages fit to show a user', () => {
    const outcome = validateExtractedData({ ...valid, annualRevenue: -1 } as never);
    expect(outcome.valid).toBe(false);
    if (outcome.valid) return;

    const message = outcome.issues.find((i) => i.field === 'annualRevenue')?.message ?? '';
    expect(message).toBe('Annual revenue cannot be negative.');
    // No Zod internals leaking into the UI.
    expect(message).not.toMatch(/zod|expected|received/i);
  });
});
