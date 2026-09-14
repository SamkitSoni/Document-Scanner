import type { Request, Response } from 'express';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../common/errors.js';
import * as documentsService from '../services/documents.service.js';

const documentTypeSchema = z.enum([
  'FINANCIAL_STATEMENT',
  'BANK_STATEMENT',
  'REGISTRATION_CERTIFICATE',
  'TAX_RETURN',
  'OTHER',
]);

/**
 * Multipart fields arrive as strings, so metadata is parsed and shape-checked
 * here rather than trusted.
 */
const metadataSchema = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'metadata must be a JSON object' });
        return z.NEVER;
      }
      return parsed as Record<string, unknown>;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'metadata must be valid JSON' });
      return z.NEVER;
    }
  });

export const uploadBodySchema = z.object({
  documentType: documentTypeSchema,
  metadata: metadataSchema,
});

export const documentIdParamSchema = z.object({
  id: z.string().regex(/^DOC-[0-9A-Z]{10}$/, 'Not a valid document id'),
});

export async function upload(req: Request, res: Response): Promise<void> {
  const parsed = uploadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(
      'The request contains invalid values.',
      parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    );
  }

  const result = await documentsService.uploadDocument({
    file: req.file,
    documentType: parsed.data.documentType,
    metadata: parsed.data.metadata,
  });

  // A duplicate is not a new resource, so it is reported as 200 rather than 201.
  res.status(result.duplicate ? 200 : 201).json(result);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const document = await documentsService.getDocument(id);
  if (!document) throw new NotFoundError('Document');

  res.json(toDetailResponse(document));
}

type DocumentRow = NonNullable<Awaited<ReturnType<typeof documentsService.getDocument>>>;

function toDetailResponse(d: DocumentRow) {
  return {
    documentId: d.id,
    status: d.status,
    documentType: d.documentType,
    filename: d.filename,
    sizeBytes: d.sizeBytes,
    attemptCount: d.attemptCount,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    metadata: d.metadata,
    // `result` means "data we accepted". A failed validation still has an
    // extraction worth seeing — it is the first thing an operator asks about —
    // but it is surfaced separately so nothing downstream mistakes rejected
    // data for a usable result.
    result: d.status === 'PROCESSED' ? d.extractedData : null,
    rejectedData: d.status === 'VALIDATION_FAILED' ? (d.extractedData ?? null) : null,
    failureReason: d.failureReason ?? null,
    validationErrors: d.validationErrors ?? null,
  };
}
