import type { Request, Response } from 'express';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../common/errors.js';
import { DOCUMENT_STATUSES } from '../common/types.js';
import { env } from '../config/env.js';
import { validatedQuery } from '../middleware/validate.js';
import * as documentsService from '../services/documents.service.js';

/**
 * Zod's default for a failed enum is "Invalid enum value. Expected 'A' | 'B' …",
 * which names our internal constants at the user. Every message in this file is
 * overridden for the same reason: these strings reach a person, not a log.
 */
const documentTypeSchema = z.enum(
  ['FINANCIAL_STATEMENT', 'BANK_STATEMENT', 'REGISTRATION_CERTIFICATE', 'TAX_RETURN', 'OTHER'],
  { errorMap: () => ({ message: 'Choose a document type from the list.' }) },
);

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
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Extra details must be a set of labels and values.' });
        return z.NEVER;
      }
      return parsed as Record<string, unknown>;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Extra details could not be read. Remove them and try again.' });
      return z.NEVER;
    }
  });

export const uploadBodySchema = z.object({
  documentType: documentTypeSchema,
  metadata: metadataSchema,
});

export const documentIdParamSchema = z.object({
  id: z.string().regex(/^DOC-[0-9A-Z]{10}$/, 'That document link does not look right.'),
});

export async function upload(req: Request, res: Response): Promise<void> {
  const parsed = uploadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(
      'Some details need fixing before we can continue.',
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
  if (!document) throw new NotFoundError('That document');

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

/**
 * Query schema for the document list.
 *
 * `status` and `documentType` are repeatable: Express gives a single value as a
 * string and repeats as an array, so both are normalised to an array here and
 * controllers never have to care which arrived.
 */
const repeatable = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.array(schema)]).optional().transform((v) => {
    if (v === undefined) return undefined;
    return (Array.isArray(v) ? v : [v]) as z.infer<T>[];
  });

const statusSchema = z.enum(DOCUMENT_STATUSES, {
  errorMap: () => ({ message: 'Choose a status from the list.' }),
});

/** `field:direction`, defaulting to newest first — what the list view wants. */
const sortSchema = z
  .enum(['createdAt:desc', 'createdAt:asc', 'filename:asc', 'filename:desc'], {
    errorMap: () => ({ message: 'Choose a sort order from the list.' }),
  })
  .default('createdAt:desc')
  .transform((value) => {
    const [field, direction] = value.split(':') as ['createdAt' | 'filename', 'asc' | 'desc'];
    return { sortField: field, sortDirection: direction };
  });

export const listQuerySchema = z
  .object({
    status: repeatable(statusSchema),
    documentType: repeatable(documentTypeSchema),
    search: z
      .string()
      .trim()
      .min(1, 'Enter something to search for.')
      .max(200, 'That search is too long.')
      .optional(),
    from: z.coerce.date({ invalid_type_error: 'Enter a valid start date.' }).optional(),
    to: z.coerce.date({ invalid_type_error: 'Enter a valid end date.' }).optional(),
    page: z.coerce.number().int().positive('Enter a valid page number.').default(1),
    // Capped: an uncapped page size lets one request read the whole table.
    pageSize: z.coerce
      .number()
      .int()
      .positive('Enter a valid number of results per page.')
      .max(100, 'You can show at most 100 documents at a time.')
      .default(20),
    sort: sortSchema,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The start date must come before the end date.',
    path: ['from'],
  });

type ListQuery = z.infer<typeof listQuerySchema>;

export async function list(_req: Request, res: Response): Promise<void> {
  const q = validatedQuery<ListQuery>(res);

  const { items, pagination } = await documentsService.listDocuments({
    status: q.status,
    documentType: q.documentType,
    search: q.search,
    from: q.from,
    to: q.to,
    page: q.page,
    pageSize: q.pageSize,
    sortField: q.sort.sortField,
    sortDirection: q.sort.sortDirection,
  });

  res.json({ data: items.map(toSummaryResponse), pagination });
}

/** The list view needs far less than the detail view; sending less keeps it quick. */
function toSummaryResponse(d: DocumentRow) {
  return {
    documentId: d.id,
    filename: d.filename,
    documentType: d.documentType,
    status: d.status,
    sizeBytes: d.sizeBytes,
    attemptCount: d.attemptCount,
    failureReason: d.failureReason ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export async function getHistory(req: Request, res: Response): Promise<void> {
  const events = await documentsService.getHistory(req.params.id as string);

  res.json(
    events.map((e) => ({
      status: e.status,
      timestamp: e.createdAt.toISOString(),
      attempt: e.attempt,
      reason: e.reason,
      detail: e.detail,
    })),
  );
}

export async function getStats(_req: Request, res: Response): Promise<void> {
  res.json(await documentsService.getStats());
}

export async function getFile(req: Request, res: Response): Promise<void> {
  const { document, data } = await documentsService.getDocumentFile(req.params.id as string);

  res.setHeader('Content-Type', document.mimeType);
  res.setHeader('Content-Length', data.length);
  // inline, not attachment: the detail view previews the PDF rather than
  // downloading it. The filename is quoted and stripped of quotes of its own.
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${document.filename.replace(/["\\]/g, '')}"`,
  );

  // The frontend embeds this response in an <object> from a different origin,
  // which helmet's default `frame-ancestors 'self'` (and the legacy
  // X-Frame-Options) would block. Both are narrowed to the configured frontend
  // origins for this route only, so the rest of the API keeps helmet's
  // defaults. `X-Frame-Options` has no multi-origin form and is superseded by
  // `frame-ancestors`, so it is removed rather than rewritten.
  const frameAncestors = env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .join(' ');

  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; object-src 'self'; frame-ancestors 'self' ${frameAncestors}`,
  );
  res.removeHeader('X-Frame-Options');

  res.send(data);
}

export async function retry(req: Request, res: Response): Promise<void> {
  const document = await documentsService.retryDocument(req.params.id as string);

  res.json({
    documentId: document.id,
    status: document.status,
    attemptCount: document.attemptCount,
  });
}
