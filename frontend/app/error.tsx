'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="page-wrap">
      <div className="empty">
        <h1>We couldn’t load this page.</h1>
        <p>
          The service may be temporarily unavailable. Your saved information has
          not been changed.
        </p>
        <button className="primary" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
