// Printer resit Bluetooth (BLE) + arahan ESC/POS untuk kertas 58mm.
// Terbukti dengan ZyWell Z58-III: servis 000018f0-..., tulis ke 00002af1-... (writeWithoutResponse).
const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb', '0000ae00-0000-1000-8000-00805f9b34fb'
];
export const WIDTH = 32;                 // aksara sebaris (58mm, font A)
let device = null, channel = null;
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn(status()));

export const supported = () => 'bluetooth' in navigator;
export const status = () => ({ connected: !!(channel && device?.gatt?.connected), name: device?.name || '' });
export const onStatus = fn => { listeners.add(fn); return () => listeners.delete(fn); };

async function attach(dev) {
  device = dev;
  device.addEventListener('gattserverdisconnected', () => { channel = null; emit(); }, { once: true });
  const server = await device.gatt.connect();
  channel = null;
  for (const s of await server.getPrimaryServices()) {
    for (const c of await s.getCharacteristics()) {
      if (!channel && (c.properties.writeWithoutResponse || c.properties.write)) channel = c;
    }
  }
  if (!channel) throw new Error('No writable channel on this printer');
  emit();
}

// Pilih printer (perlu sentuhan pengguna). Chrome ingat kebenaran untuk sambungan semula.
export async function choose() {
  const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  await attach(dev);
}

// Cuba sambung semula ke printer yang pernah dibenarkan (jika Chrome sokong getDevices).
export async function reconnect() {
  if (status().connected) return true;
  try {
    if (device) { await attach(device); return true; }
    if (!navigator.bluetooth?.getDevices) return false;
    const list = await navigator.bluetooth.getDevices();
    for (const d of list) { try { await attach(d); return true; } catch { /* cuba seterusnya */ } }
  } catch { /* abaikan */ }
  return false;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function print(bytes) {
  if (!status().connected && !(await reconnect())) throw new Error('NOT_CONNECTED');
  const send = async size => {
    for (let i = 0; i < bytes.length; i += size) {
      const part = bytes.slice(i, i + size);
      if (channel.properties.writeWithoutResponse) await channel.writeValueWithoutResponse(part);
      else await channel.writeValueWithResponse(part);
      await sleep(20);
    }
  };
  try { await send(100); } catch { await send(20); }
}

// ---------- ESC/POS ----------
// Hanya ASCII: printer murah tak kenal UTF-8 (huruf berloghat dibuang).
export const ascii = s => String(s ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '');
export const lr = (l, r, w = WIDTH) => { l = ascii(l); r = ascii(r); return l.slice(0, Math.max(0, w - r.length - 1)).padEnd(w - r.length) + r; };
export const wrap = (s, w = WIDTH) => {
  const out = []; let line = '';
  ascii(s).split(/\s+/).filter(Boolean).forEach(word => {
    while (word.length > w) { if (line) { out.push(line); line = ''; } out.push(word.slice(0, w)); word = word.slice(w); }
    if ((line + ' ' + word).trim().length > w) { out.push(line); line = word; } else line = (line + ' ' + word).trim();
  });
  if (line) out.push(line);
  return out;
};

export function escpos() {
  const out = [];
  const api = {
    raw: (...b) => { out.push(...b); return api; },
    init: () => api.raw(0x1B, 0x40),
    align: a => api.raw(0x1B, 0x61, { left: 0, center: 1, right: 2 }[a]),
    bold: on => api.raw(0x1B, 0x45, on ? 1 : 0),
    size: (w, h) => api.raw(0x1D, 0x21, ((w - 1) << 4) | (h - 1)),
    text: s => { out.push(...new TextEncoder().encode(ascii(s) + '\n')); return api; },
    line: (ch = '-') => api.text(ch.repeat(WIDTH)),
    feed: n => api.raw(0x1B, 0x64, n),
    cut: () => api.raw(0x1D, 0x56, 0x42, 0x00),
    bytes: () => new Uint8Array(out)
  };
  return api;
}
