// Root fallback for paths that never reached a locale layout. Must render its
// own <html> because there is no root layout above it (the [locale] layout is
// the app's root layout).
export default function RootNotFound() {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'sans-serif', padding: 40 }}>
        <h1>404</h1>
        <p>
          {/* Plain anchor: this fallback sits above the locale layout, so
              next/link's locale-aware routing does not apply here. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/en">WorkshopOS →</a>
        </p>
      </body>
    </html>
  );
}
