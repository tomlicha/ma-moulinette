import { describe, expect, it } from 'vitest';
import { isAppleMobile, noBluetoothHint, noBluetoothStatus } from './bluetooth-support';

const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';

describe('Bluetooth absent', () => {
  it('reconnaît iPad (même en mode ordinateur), iPhone et Chrome sur iPad', () => {
    expect(isAppleMobile({ userAgent: IPAD_DESKTOP, maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobile({ userAgent: IPHONE })).toBe(true);
    expect(isAppleMobile({ userAgent: CHROME_IOS })).toBe(true);
    expect(isAppleMobile({ userAgent: IPAD_DESKTOP, maxTouchPoints: 0 })).toBe(false); // un vrai Mac
  });

  it('renvoie vers l’application iOS sur iPad, vers Chrome ailleurs', () => {
    expect(noBluetoothStatus({ userAgent: CHROME_IOS })).toContain('application iOS');
    expect(noBluetoothHint({ userAgent: IPHONE })).not.toContain('Chrome');
    expect(noBluetoothStatus({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130' })).toContain('Chrome ou Edge');
  });
});
