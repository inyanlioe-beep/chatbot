# Ruang AI — AI Provider Chat

Aplikasi chatbot web ringan yang menggunakan API OpenAI-compatible atau endpoint Bluepack Messages. API key hanya dibaca oleh server Node dan tidak pernah dikirim ke browser.

## Menjalankan aplikasi

Persyaratan: Node.js 18.17 atau lebih baru.

1. Salin file konfigurasi contoh:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Buka `.env`, kemudian isi konfigurasi AI Provider Anda:

   ```env
   AGENTROUTER_BASE_URL=https://agentrouter.org/v1
   AGENTROUTER_API_KEY=api_key_anda
   AGENTROUTER_MODEL=gpt-4o-mini
   ```

   Untuk Bluepack, isi konfigurasi alternatif berikut:

   ```env
   BLUEPACK_BASE_URL=https://ai.bluepack.my.id/messages
   BLUEPACK_API_KEY=api_key_bluepack_anda
   BLUEPACK_MODEL=claude-opus-5
   ```

   Jika `BLUEPACK_*` diisi, server mengirim format Anthropic Messages ke endpoint tersebut, termasuk header `Authorization: Bearer ...`. Respons JSON Bluepack akan ditampilkan tanpa blok `thinking` internal.

   Jika dashboard provider memberikan base URL yang berbeda, gunakan nilai persis dari dashboard. Untuk konfigurasi `AGENTROUTER_*`, server menambahkan `/chat/completions`; konfigurasi `BLUEPACK_*` menggunakan endpoint `/messages` secara langsung.

3. Jalankan aplikasi:

   ```powershell
   npm start
   ```

4. Buka <http://localhost:3000>.

Mode pengembangan dengan restart otomatis:

```powershell
npm run dev
```

## Fitur

- Streaming jawaban dari endpoint `/chat/completions`.
- Dukungan endpoint Bluepack `/messages` dengan format respons Anthropic.
- API key aman di backend proxy.
- Riwayat percakapan tersimpan lokal di browser.
- Pilihan model, system prompt, temperature, dan batas token.
- Memuat daftar model dari endpoint `/models` AI Provider.
- Stop generation, regenerate, copy pesan, pencarian, dan tampilan mobile.

## Catatan keamanan

- Jangan commit file `.env`; file tersebut sudah masuk `.gitignore`.
- Untuk deployment publik, jalankan aplikasi di balik HTTPS dan tambahkan autentikasi pengguna sesuai kebutuhan.
- Base URL tampil di browser untuk membantu diagnosis, tetapi API key tidak pernah diekspos.

## Pengujian

```powershell
npm test
```
