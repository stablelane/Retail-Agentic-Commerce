"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="px-4 pt-14 sm:px-8">
      <div className="mx-auto max-w-(--container-content) pt-16 text-center">
        <h1 className="font-serif text-h2 leading-[1.1] font-normal">The shop is taking a break</h1>
        <p className="mt-4 text-body text-text-secondary">
          We couldn’t load the catalog just now. Please try again in a moment.
        </p>
        <button type="button" onClick={reset} className="btn-pill mt-8">
          Try again
        </button>
      </div>
    </div>
  );
}
