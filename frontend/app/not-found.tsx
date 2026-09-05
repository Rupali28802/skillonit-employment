import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="page-wrap empty">
      <h1>This page has moved on.</h1>
      <p>The opportunity or page you requested is not available.</p>
      <Link href="/" className="primary">
        Find opportunities
      </Link>
    </div>
  );
}
