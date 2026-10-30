import type { LocalDialogueContext } from '../shared/dialogueContext';

let batteryAt = -Infinity;
let battery: LocalDialogueContext['battery'];
let powerStatus: ((buffer: Buffer) => boolean) | null | undefined;
/** One tiny native call per minute. A desktop with no battery produces no battery dialogue. */
export function batteryContext(now = Date.now()): LocalDialogueContext['battery'] {
  if (now - batteryAt < 60000) return battery;
  batteryAt = now;
  try {
    if (powerStatus === undefined) {
      powerStatus = process.platform === 'win32' ? require('koffi').load('kernel32.dll').func('bool __stdcall GetSystemPowerStatus(_Out_ void *status)') : null;
    }
    const data = Buffer.alloc(12);
    if (powerStatus?.(data) && data[1] !== 255 && !(data[1] & 128) && data[2] <= 100 && data[0] <= 1) {
      battery = { percent: data[2], charging: data[0] === 1 };
    } else battery = undefined;
  } catch { battery = undefined; powerStatus = null; }
  return battery;
}

/** Optional public forecast, not a model call. No IP geolocation, browser or page scraping. */
export class WeatherContext {
  private city = ''; private due = 0; private pending = false;
  private coordinates: { latitude: number; longitude: number } | null = null;
  private weather: LocalDialogueContext['weather'];
  constructor(private fetcher: typeof fetch = fetch, private now = Date.now) {}
  snapshot(city: string) {
    if (!city.trim() || city !== this.city || !this.weather || this.now() - this.weather.observedAt > 3600000) return undefined;
    return { ...this.weather };
  }
  async refresh(city: string) {
    city = city.trim();
    if (city !== this.city) { this.city = city; this.coordinates = null; this.weather = undefined; this.due = 0; }
    if (!city || this.pending || this.now() < this.due) return;
    this.pending = true; this.due = this.now() + 30 * 60000;
    const current = city;
    try {
      if (!this.coordinates) {
        const response = await this.fetcher(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=2&language=en&format=json`, { signal: AbortSignal.timeout(3000) });
        if (!response.ok) return;
        const data = await response.json() as { results?: { latitude: number; longitude: number }[] };
        // Ambiguous locations remain unavailable until the city/state is made specific.
        if (data.results?.length !== 1) return;
        const p = data.results[0];
        if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180) return;
        if (this.city !== current) return;
        this.coordinates = { latitude: p.latitude, longitude: p.longitude };
      }
      const { latitude, longitude } = this.coordinates;
      const response = await this.fetcher(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timeformat=unixtime`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return;
      const data = await response.json() as { current?: { temperature_2m: number; weather_code: number; time: number } };
      const c = data.current;
      if (!c || !Number.isFinite(c.temperature_2m) || !Number.isFinite(c.time) || Math.abs(this.now() - c.time * 1000) > 3600000 || this.city !== current) return;
      const code = c.weather_code;
      const condition = code === 0 ? 'clear' : code >= 1 && code <= 3 ? 'cloud' : [45, 48].includes(code) ? 'fog'
        : code >= 51 && code <= 67 || code >= 80 && code <= 82 ? 'rain' : code >= 71 && code <= 77 || [85, 86].includes(code) ? 'snow' : code >= 95 && code <= 99 ? 'storm' : null;
      if (condition) this.weather = { condition, celsius: c.temperature_2m, observedAt: c.time * 1000 };
    } catch { /* unavailable weather stays silent; no immediate retry */ }
    finally { this.pending = false; }
  }
}
