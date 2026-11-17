import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
// @ts-expect-error module JavaScript sans types
import { appBoundDomains, setAppBoundDomains, setOfflineUrl } from './sync.mjs';

describe('accord de la coquille iOS au serveur', () => {
  it('remplace les domaines app-bound d’Info.plist', () => {
    const plist = fs.readFileSync(new URL('../../ios/App/App/Info.plist', import.meta.url), 'utf8');
    const out = setAppBoundDomains(plist, ['localhost', 'preprod.example.dev']);
    expect(out).toContain('<string>preprod.example.dev</string>');
    expect(out).not.toContain('moulinette-ride.workers.dev</string>');
    expect(out.match(/WKAppBoundDomains/g)).toHaveLength(1);
    expect(setAppBoundDomains(out, ['localhost', 'preprod.example.dev'])).toBe(out);
  });

  it('ajoute la liste si elle manque', () => {
    const out = setAppBoundDomains('<plist>\n<dict>\n\t<key>A</key>\n</dict>\n</plist>\n', ['localhost']);
    expect(out).toContain('<key>WKAppBoundDomains</key>');
    expect(out.trim().endsWith('</plist>')).toBe(true);
  });

  it('pas de domaines pour un serveur de développement en clair', () => {
    expect(appBoundDomains('https://app.example.dev/')).toEqual(['localhost', 'app.example.dev']);
    expect(appBoundDomains('http://192.168.1.20:5173')).toEqual([]);
  });

  it('écrit l’adresse de l’application dans la page hors ligne', () => {
    const html = fs.readFileSync(new URL('../../public/offline.html', import.meta.url), 'utf8');
    expect(setOfflineUrl(html, 'https://app.example.dev')).toContain('<meta name="app-url" content="https://app.example.dev"');
  });
});
