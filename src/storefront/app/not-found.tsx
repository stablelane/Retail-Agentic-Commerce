import Link from "next/link";

export default function NotFound() {
  return (
    <div className="px-4 pt-14 sm:px-8">
      <div className="mx-auto max-w-(--container-content) pt-16 text-center">
        <h1 className="font-serif text-h2 leading-[1.1] font-normal">We couldn’t find that page</h1>
        <p className="mt-4 text-body text-text-secondary">
          It may have moved, or the product is no longer available.
        </p>
        <Link href="/catalog" className="btn-pill mt-8">
          Browse the catalog
        </Link>
      </div>
    </div>
  );
}
