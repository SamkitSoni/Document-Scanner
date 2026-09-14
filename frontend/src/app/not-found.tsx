import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted">
        That page does not exist. The document you are looking for may have a different id.
      </p>
      <Link href="/documents" className="btn-primary mt-6">
        Browse documents
      </Link>
    </div>
  );
}
