import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colors } from './theme';

/**
 * Guards the PWA install shell: the manifest must describe a standalone
 * portrait app, stay in sync with the theme palette, and only reference icons
 * that are actually committed under public/icons/.
 */
const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

const manifest = JSON.parse(readFileSync(`${publicDir}manifest.json`, 'utf8')) as {
  name: string;
  short_name: string;
  display: string;
  orientation: string;
  start_url: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
};

describe('PWA manifest', () => {
  it('declares a standalone portrait app', () => {
    expect(manifest.name).toBe('Trap Card Game');
    expect(manifest.short_name).toBe('TrapCard');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.start_url).toBe('/');
  });

  it('matches the app theme color', () => {
    expect(manifest.theme_color).toBe(colors.bg);
    expect(manifest.background_color).toBe(colors.bg);
  });

  it('references 192/512 icons plus a maskable variant, all present on disk', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect(existsSync(`${publicDir}${icon.src.replace(/^\//, '')}`), icon.src).toBe(true);
    }
  });
});
