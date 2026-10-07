# Ruang AI — AI Provider Chat

Aplikasi chatbot web ringan yang terhubung ke API OpenAI-compatible atau endpoint Anthropic Messages. API key hanya dibaca oleh server Node dan tidak pernah dikirim ke browser.

## Menjalankan aplikasi

Persyaratan: Node.js 18.17 atau lebih baru. Tidak ada dependency runtime.

1. Salin file konfigurasi contoh:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Buka `.env`, lalu isi konfigurasi AI Provider Anda:

   ```env
   OPENAI_BASE_URL=https://agentrouter.org/v1
   OPENAI_API_KEY=api_key_anda
   OPENAI_MODEL=gpt-4o-mini
   ```

   Untuk Anthropic, gunakan konfigurasi alternatif berikut:

   ```env
   ANTHROPIC_BASE_URL=https://ai.bluepack.my.id/messages
   ANTHROPIC_API_KEY=api_key_anthropic_anda
   ANTHROPIC_MODEL=
   ```

   Jika `ANTHROPIC_*` diisi, server mengirim format Anthropic Messages ke endpoint tersebut, termasuk header `Authorization`. Respons JSON Anthropic ditampilkan tanpa blok `thinking` internal.

   Gunakan base URL persis seperti di dashboard provider. Konfigurasi `OPENAI_*` menambahkan `/chat/completions` (atau `/models`), sedangkan `ANTHROPIC_*` memakai endpoint `/messages` secara langsung.

3. Jalankan aplikasi:

   ```powershell
   npm start
   ```

   Di Windows bisa juga lewat `chatbot.bat`.

4. Buka <http://localhost:3000>.

Mode pengembangan dengan restart otomatis:

```powershell
npm run dev
```

## Endpoint server

| Metode | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/health` | Cek status server. |
| GET | `/api/config` | Info base URL, model, dan status API key (tanpa membocorkan key). |
| GET | `/api/models` | Daftar model dari endpoint `/models` AI Provider. |
| POST | `/api/chat` | Proxy streaming ke AI Provider. |

## Fitur

- Streaming jawaban dari endpoint `/chat/completions`.
- Dukungan endpoint Anthropic `/messages` dengan format respons Anthropic.
- API key aman di backend proxy; base URL ditampilkan untuk diagnosis.
- Riwayat percakapan tersimpan lokal di browser (localStorage), dengan pencarian dan hapus per percakapan.
- Pilihan model, system prompt, temperature, dan batas token.
- Model vision terpisah: pesan bergambar otomatis dialihkan ke model vision.
- Lampiran gambar (tempel dari clipboard atau pilih file) dan lampiran berkas teks.
- Ekspor jawaban asisten ke `.docx` langsung di browser, tanpa dependency.
- Render Markdown lengkap: judul, daftar, tabel, blockquote, blok kode, dan rumus KaTeX.
- Tema terang/gelap, lightbox gambar, notifikasi toast, dan tata letak responsif.
- Stop generation, regenerate, copy pesan, dan tampilan mobile.

## Catatan keamanan

- Jangan commit file `.env`; file tersebut sudah masuk `.gitignore`.
- Untuk deployment publik, jalankan aplikasi di balik HTTPS dan tambahkan autentikasi pengguna sesuai kebutuhan.
- Base URL tampil di browser untuk membantu diagnosis, tetapi API key tidak pernah diekspos.

## Deployment

Repositori menyertakan `vercel.json` dan handler serverless di [api/index.js](api/index.js). Isi environment variables (`OPENAI_*` atau `ANTHROPIC_*`) di dashboard Vercel, lalu deploy seperti biasa.

## Pengujian

```powershell
npm test
```

Menjalankan tes server/proxy ([test/server.test.js](test/server.test.js)) dan generator `.docx` ([test/docx.test.js](test/docx.test.js)) memakai test runner bawaan Node.
