import net from 'net';

// Public merchant destinations only. Special-purpose, local, translation and
// tunnel addresses must not provide a route to internal administration services.
const publicIpv4 = (address: string) => {
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && ((b === 168) || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
};

export const normalizeRemoteHostname = (hostname: string) =>
  hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

export const isPublicRemoteAddress = (input: string) => {
  const address = normalizeRemoteHostname(input);
  const family = net.isIP(address);
  if (family === 4) return publicIpv4(address);
  if (family !== 6 || address.includes('%')) return false;
  // Expand compressed and dotted-tail forms before comparing address ranges.
  const normalized = address.replace(/(\d+\.\d+\.\d+\.\d+)$/, (tail) => {
    const [a, b, c, d] = tail.split('.').map(Number);
    return `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  });
  const halves = normalized.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const words = (halves.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail] : head).map((word) => parseInt(word, 16));
  if (words.length !== 8) return false;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return publicIpv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  if ((words[0] & 0xe000) !== 0x2000) return false;
  if (words[0] === 0x2001 && (words[1] < 0x0200 || words[1] === 0x0db8)) return false;
  if (words[0] === 0x2002 || (words[0] === 0x3fff && words[1] < 0x1000)) return false;
  return true;
};

export const isPublicRemoteUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const hostname = normalizeRemoteHostname(parsed.hostname);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash
      || !hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
    return net.isIP(hostname) ? isPublicRemoteAddress(hostname) : true;
  } catch { return false; }
};
