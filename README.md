# Phoveus Backend Proxy

Backend kecil (Node.js + Express) yang menjembatani `phoveus-agent-os.html` ke:

1. **Claude API** — untuk reasoning agent (opsional; fallback ke heuristik lokal kalau tidak dikonfigurasi).
2. **Binance Agent OS MCP server** — untuk benar-benar mengeksekusi `place_order`, setelah user approve di UI.

Alasan backend ini ada: API key Claude dan token Binance Agent OS **tidak boleh** ditaruh di file front-end / browser, karena siapa pun yang buka "View Source" bisa mencurinya. Semua kredensial hidup di server ini lewat `.env`.

## Cara pakai

```bash
cd phoveus-backend
cp .env.example .env
# lalu isi .env: ANTHROPIC_API_KEY, BINANCE_AGENT_OS_URL, BINANCE_AGENT_OS_TOKEN, ALLOWED_ORIGIN
npm install
npm start
```

Server jalan default di `http://localhost:8787`.

## Menyambungkan ke front-end

Di `phoveus-agent-os.html`, isi:

```js
const AGENT_PROXY_URL = "http://localhost:8787/api/agent-call";
```

Front-end akan mengirim `{ symbols, prices, changePct }` dan menerima `{ symbol, call, confidence, reasoning }` — tanpa pernah menyentuh API key apa pun.

## Endpoint

### `POST /api/agent-call`
Body: `{ symbols: string[], prices: object, changePct: object }`
Response: `{ symbol, call, confidence, reasoning }`
Kalau `ANTHROPIC_API_KEY` kosong atau Claude gagal merespons, otomatis fallback ke heuristik lokal berbasis perubahan harga 24 jam.

### `POST /api/place-order`
Body: `{ symbol, side: "BUY"|"SELL", quantity: number, orderType?, confirmed: true }`

**Wajib** `confirmed: true` — ini adalah gerbang approval manusia. Server menolak request tanpa field ini. UI kamu harus menampilkan detail order dan minta klik konfirmasi eksplisit dari user sebelum memanggil endpoint ini.

⚠️ **Sebelum dipakai sungguhan:** nama tool (`place_order`) dan bentuk argumennya di `server.js` masih **asumsi** berdasarkan pola umum MCP trading server. Cek dulu tool yang sesungguhnya lewat `GET /api/tools?key=ADMIN_DEBUG_KEY` dan sesuaikan `server.js` dengan skema yang benar dari MCP server Binance Agent OS kamu sebelum production.

### `GET /api/tools?key=...`
Endpoint debug untuk melihat daftar tool MCP yang tersedia dari Binance Agent OS. Dilindungi `ADMIN_DEBUG_KEY` di `.env` — jangan expose ke publik.

### `GET /healthz`
Health check sederhana.

## Checklist keamanan sebelum production

- [ ] Jangan pernah commit file `.env` (sudah ada di `.gitignore`).
- [ ] `ALLOWED_ORIGIN` diisi domain front-end kamu yang sebenarnya, bukan `*`.
- [ ] Deploy lewat HTTPS (mis. Render, Railway, Fly.io, VPS + reverse proxy TLS).
- [ ] Scope token Binance Agent OS dibatasi seminimal mungkin (`market_data:read`, `spot_trade:approve_each_order`), jangan minta permission lebih dari yang dipakai.
- [ ] Agent hanya berjalan di dedicated subaccount — jangan sambungkan ke akun utama.
- [ ] Rate limit di kode ini masih sangat sederhana (in-memory per proses) — untuk trafik nyata, ganti dengan solusi yang lebih layak.
- [ ] Tambahkan logging/audit trail permanen untuk setiap order yang dikirim (saat ini baru `console.log`).
- [ ] Review ulang skema tool MCP lewat `/api/tools` — jangan asumsikan nama/parameter di `server.js` sudah 100% benar.

## Struktur

```
phoveus-backend/
├── server.js        # Express app: /api/agent-call, /api/place-order, /api/tools
├── package.json
├── .env.example
├── .gitignore
└── README.md
```
