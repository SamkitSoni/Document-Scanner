import multer from 'multer';
import { env } from '../config/env.js';

/**
 * Memory storage: the bytes are needed to compute the content hash before any
 * decision about persisting them, and the 10MB cap keeps that safe.
 *
 * The declared mime type is checked here as a cheap first filter, but it is
 * client-controlled — the authoritative check is the magic-byte inspection in
 * the service layer.
 */
export const uploadSingleDocument = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
      return;
    }
    // Rejected without an error so the service can return a clean 415 rather
    // than multer's own error shape.
    cb(null, false);
  },
}).single('file');
