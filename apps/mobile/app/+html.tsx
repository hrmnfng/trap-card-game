import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';
import { colors } from '../src/lib/theme';

/**
 * Expo Router HTML shell for web (static output only — requires
 * `web.output: "static"` in app.json). This is where the PWA install metadata
 * lives: the manifest link, Apple touch icon, and theme color. Rendered at
 * export time in Node — no browser globals here.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <title>Trap Card Game</title>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" sizes="48x48" href="/icons/favicon.png" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content={colors.bg} />
        {/* Legacy fallback for iOS < 16.4, which ignores the manifest's
            display mode; harmless elsewhere. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <ScrollViewStyleReset />
      </head>
      <body style={{ backgroundColor: colors.bg }}>{children}</body>
    </html>
  );
}
