/** Minimal but structurally valid PDF, used so uploads exercise the real checks. */
export function makePdf(marker = 'default'): Buffer {
  const body = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
% marker: ${marker}
trailer << /Root 1 0 R >>
%%EOF`;
  return Buffer.from(body, 'latin1');
}

export function makeNonPdf(): Buffer {
  return Buffer.from('This is plainly not a PDF file.', 'utf8');
}
