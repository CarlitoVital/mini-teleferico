// Ratenbegrenzung im Speicher mit gleitendem Zeitfenster pro Schlüssel (IP-Bereich, Benutzername oder Konto).
import net from 'node:net';

export class RateLimiter {
  constructor({ limit, windowMs, now = () => Date.now(), maxKeys = 100_000 }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.maxKeys = maxKeys;
    // Schlüssel → aufsteigende Zeitstempel der Treffer (höchstens `limit` Stück).
    // Map-Reihenfolge = Zeitpunkt des letzten Treffers, abgelaufene Einträge liegen also vorne.
    this.hits = new Map();
  }

  /** Zeitstempel im aktuellen Fenster (veraltete werden entfernt) oder undefined. */
  #live(key, t) {
    const stamps = this.hits.get(key);
    if (!stamps) return undefined;
    const cutoff = t - this.windowMs;
    let i = 0;
    while (i < stamps.length && stamps[i] <= cutoff) i++;
    if (i === stamps.length) {
      this.hits.delete(key);
      return undefined;
    }
    if (i > 0) stamps.splice(0, i);
    return stamps;
  }

  /**
   * Platz für einen neuen Schlüssel? Bei voller Tabelle werden zuerst abgelaufene Einträge
   * entfernt, dann der am längsten unbenutzte Zähler, der sein Limit noch nicht erreicht hat.
   * Gesperrte Zähler werden nie verdrängt (sonst ließe sich eine Sperre per Flut aufheben);
   * sind alle Einträge gesperrt, gilt auch der neue Schlüssel als gesperrt.
   */
  #room(t, evict) {
    if (this.hits.size < this.maxKeys) return true;
    this.prune(t);
    if (this.hits.size < this.maxKeys) return true;
    for (const [k, stamps] of this.hits) {
      if (stamps.length < this.limit) {
        if (evict) this.hits.delete(k);
        return true;
      }
    }
    return false;
  }

  /** true, wenn das Limit für diesen Schlüssel erreicht ist. */
  blocked(key) {
    const t = this.now();
    const stamps = this.#live(key, t);
    if (stamps) return stamps.length >= this.limit;
    return !this.#room(t, false);
  }

  /** Zählt einen Versuch (ist die Tabelle voll gesperrter Zähler, wird ein neuer Schlüssel nicht erfasst). */
  hit(key) {
    const t = this.now();
    let stamps = this.#live(key, t);
    if (stamps) {
      this.hits.delete(key); // ans Ende der Reihenfolge
    } else {
      if (!this.#room(t, true)) return;
      stamps = [];
    }
    stamps.push(t);
    if (stamps.length > this.limit) stamps.shift();
    this.hits.set(key, stamps);
  }

  reset(key) {
    this.hits.delete(key);
  }

  /** Nimmt den letzten Versuch zurück (z. B. weil er erfolgreich war). */
  undo(key) {
    const stamps = this.hits.get(key);
    if (!stamps) return;
    stamps.pop();
    if (stamps.length === 0) this.hits.delete(key);
  }

  /** Sekunden, bis wieder ein Versuch möglich ist (für Retry-After). */
  retryAfter(key) {
    const t = this.now();
    const stamps = this.#live(key, t);
    let until = t;
    if (stamps) {
      if (stamps.length >= this.limit) until = stamps[stamps.length - this.limit] + this.windowMs;
    } else if (!this.#room(t, false)) {
      const first = this.hits.values().next().value;
      until = first[first.length - 1] + this.windowMs;
    }
    return Math.max(1, Math.ceil((until - t) / 1000));
  }

  /** Abgelaufene Einträge entfernen. */
  prune(t = this.now()) {
    const cutoff = t - this.windowMs;
    for (const [k, stamps] of this.hits) {
      if (stamps[stamps.length - 1] > cutoff) break;
      this.hits.delete(k);
    }
  }

  get size() {
    return this.hits.size;
  }
}

/** Zerlegt eine gültige IPv6-Adresse in 8 Zahlen (16 Bit). */
function ipv6Groups(addr) {
  let s = addr;
  // eingebettete IPv4-Schreibweise (z. B. 64:ff9b::1.2.3.4) in zwei Gruppen umwandeln
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    s = `${s.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const tl = tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - h.length - tl.length;
  return [...h, ...Array(fill).fill('0'), ...tl].map((g) => parseInt(g, 16));
}

/**
 * Schlüssel für IP-Limits: IPv4 je Adresse (auch in der Form ::ffff:a.b.c.d),
 * IPv6 je /64-Netz – sonst könnte ein Client mit jeder neuen Adresse aus seinem Netz neu anfangen.
 */
export function ipKey(ip) {
  if (typeof ip !== 'string' || !ip) return 'unbekannt';
  const addr = ip.trim().replace(/%.*$/, ''); // Zonen-Index (fe80::1%eth0) weglassen
  if (net.isIPv4(addr)) return addr;
  if (!net.isIPv6(addr)) return addr;
  const g = ipv6Groups(addr.toLowerCase());
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}
