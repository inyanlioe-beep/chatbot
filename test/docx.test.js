const assert = require("node:assert/strict");
const test = require("node:test");
const { buildDocxBytes, buildDocumentXml, fileName, crc32 } = require("../public/docx");

const decoder = new TextDecoder();

function readEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let offset = 0;

  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const expectedCrc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    const data = bytes.subarray(start, start + size);

    assert.equal(crc32(data), expectedCrc, `CRC tidak cocok untuk ${name}`);
    entries.push({ name, text: decoder.decode(data) });
    offset = start + size;
  }

  assert.equal(view.getUint32(offset, true), 0x02014b50, "central directory harus mengikuti entri terakhir");
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50, "end of central directory harus ada di akhir");
  return entries;
}

test("buildDocxBytes menghasilkan paket .docx yang utuh", () => {
  const bytes = buildDocxBytes("# Judul\n\nHalo **dunia** dari `chatbot`.\n\n- satu\n- dua\n\n```js\nconst a = 1;\n```");
  assert.equal(decoder.decode(bytes.subarray(0, 2)), "PK");

  const entries = readEntries(bytes);
  assert.deepEqual(entries.map((entry) => entry.name), ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
  assert.match(entries[2].text, /Judul/);
  assert.match(entries[2].text, /<w:b\/>/);
  assert.match(entries[2].text, /Consolas/);
  assert.match(entries[0].text, /wordprocessingml\.document\.main\+xml/);
});

test("markdown di-escape agar XML tetap valid", () => {
  const xml = buildDocumentXml("Halo <script> & 'tanda'");
  assert.match(xml, /&lt;script&gt; &amp; &apos;tanda&apos;/);
  assert.doesNotMatch(xml, /<script>/);
});

test("penanda markdown di dalam daftar tidak ikut tercetak", () => {
  const xml = buildDocumentXml("7. Tim Inti\n\n- **Product Lead:** Andi Pratama\n- *Marketing Lead:* Sinta Dewi");
  assert.doesNotMatch(xml, /\*\*/);
  assert.match(xml, /<w:b\/><\/w:rPr><w:t xml:space="preserve">Product Lead:<\/w:t>/);
  assert.match(xml, /<w:i\/><\/w:rPr><w:t xml:space="preserve">Marketing Lead:<\/w:t>/);
  assert.match(xml, /<w:t xml:space="preserve">• <\/w:t>/);
});

test("tabel markdown menjadi tabel Word asli", () => {
  const xml = buildDocumentXml("| No | Topik | Jawaban |\n|---|---|---|\n| 1 | **Aritmatika** | Rp39.000 |\n| 2 | Peluang | 1/2 |");
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /<w:tblBorders>/);
  assert.equal((xml.match(/<w:tr>/g) || []).length, 3, "1 header + 2 baris data");
  assert.equal((xml.match(/<w:tc>/g) || []).length, 9);
  assert.match(xml, /<w:shd w:val="clear" w:fill="F3F4F6"\/>/, "header tabel diberi latar");
  assert.doesNotMatch(xml, /\|/, "pipa markdown tidak ikut tercetak");
});

test("rumus LaTeX dikonversi, bukan dicetak mentah", () => {
  const xml = buildDocumentXml("$$5x - 8 = 2x + 13$$\n\n- U_{15} = 46\n- Luas = 15 \\times 9 = 135 cm^2\n- P(A) = \\frac{3}{6}\n- \\sqrt{49} = 7 dan \\pi \\approx 3,14");
  const text = (xml.match(/<w:t xml:space="preserve">[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
  assert.match(text, /5x - 8 = 2x \+ 13/);
  assert.match(text, /U₁₅ = 46/);
  assert.match(text, /15 × 9 = 135 cm²/);
  assert.match(text, /3\/6/);
  assert.match(text, /√49 = 7 dan π ≈ 3,14/);
  assert.doesNotMatch(text, /\$|\\times|\\frac|\\sqrt|\\pi/);
  assert.match(xml, /<w:jc w:val="center"\/>/, "rumus blok dibuat rata tengah");
});

test("delimiter \\( \\) dan \\[ \\] juga dikonversi", () => {
  const xml = buildDocumentXml("Nilai \\( x \\) dari \\( \\pi = \\frac{22}{7} \\)\n\n\\[ L = \\pi \\times r^2 \\]\n\n\\[ L = 616 \\text{ cm}^2 \\]");
  const text = (xml.match(/<w:t xml:space="preserve">[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
  assert.match(text, /Nilai x dari π = 22\/7/);
  assert.match(text, /L = π × r²/);
  assert.match(text, /L = 616 cm²/);
  assert.doesNotMatch(text, /\\\(|\\\)|\\\[|\\\]|\\text|\\pi|\\times/);
  assert.equal((xml.match(/<w:jc w:val="center"\/>/g) || []).length, 2, "dua rumus blok rata tengah");
});

test("delimiter dengan backslash ganda juga dikonversi", () => {
  const xml = buildDocumentXml("Berikut:\n\n\\\\[ 3x + 7 = 2x + 15 \\\\]\n\nJadi \\\\( x = 8 \\\\).");
  const text = (xml.match(/<w:t xml:space="preserve">[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
  assert.match(text, /3x \+ 7 = 2x \+ 15/);
  assert.match(text, /Jadi x = 8\./);
  assert.doesNotMatch(text, /\\\\?[\[\]()]/);
});

test("delimiter pada baris sendiri digabung menjadi satu rumus", () => {
  const xml = buildDocumentXml("Soal:\n\n\\[\n3x + 7 = 2x + 15\n\\]\n\nPembahasan:\n\n\\[\n20\\% \\times 250.000 = 50.000\n\\]\n\n\\[\nL = 616 \\text{ cm}^2\n\\]");
  const text = (xml.match(/<w:t xml:space="preserve">[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
  assert.match(text, /3x \+ 7 = 2x \+ 15/);
  assert.match(text, /20% × 250.000 = 50.000/);
  assert.match(text, /L = 616 cm²/);
  assert.doesNotMatch(text, /\\[\[\]()]|\\text|\\%|\\times/);
  assert.equal((xml.match(/<w:jc w:val="center"\/>/g) || []).length, 3, "tiga rumus blok rata tengah");
});

test("backslash ganda di dalam rumus tidak menyisakan sisa", () => {
  const xml = buildDocumentXml("\\\\[ L = 616 \\\\text{ cm}^2 \\\\]");
  const text = (xml.match(/<w:t xml:space="preserve">[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
  assert.equal(text.trim(), "L = 616 cm²");
});

test("dollar dan backslash biasa tidak salah diubah", () => {
  const xml = buildDocumentXml("Harga $5 dan $10 saja.\n\nPath Windows C:\\Users\\andi\\data\n\nRumus $5x - 8 = 2x + 13$ tetap dikonversi.");
  const text = (xml.match(/<w:t xml:space="preserve">[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
  assert.match(text, /Harga \$5 dan \$10 saja\./);
  assert.match(text, /C:\\Users\\andi\\data/);
  assert.match(text, /5x - 8 = 2x \+ 13 tetap dikonversi/);
});

test("fileName membersihkan judul menjadi nama file aman", () => {
  assert.equal(fileName('Laporan: "Q1"/2026'), "Laporan Q1 2026.docx");
  assert.equal(fileName(""), "dokumen.docx");
});
