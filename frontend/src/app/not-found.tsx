import Link from 'next/link';
import { Icon } from '@/components/Icon';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <span
        aria-hidden
        className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface-2 text-muted"
      >
        <Icon name="search" size={26} />
      </span>
      <h1 className="mt-5 text-display text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-muted">
        That page does not exist. The document you are looking for may have a different id.
      </p>
      <Link href="/documents" className="btn-primary mt-6">
        <Icon name="documents" size={15} />
        Browse documents
      </Link>
    </div>
  );
}
