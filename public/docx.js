/**
 * Generator .docx minimal tanpa dependency.
 * ponytail: ZIP "stored" (tanpa deflate) + 3 part wajib OOXML — cukup untuk dokumen teks;
 * upgrade: pakai lib zip bila perlu gambar/ukuran besar.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChatDocx = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  const encoder = new TextEncoder();

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function concat(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  function zipStore(files) {
    const local = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const crc = crc32(file.data);
      const header = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 0x21, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, file.data.length, true);
      view.setUint32(22, file.data.length, true);
      view.setUint16(26, nameBytes.length, true);
      header.set(nameBytes, 30);

      local.push(header, file.data);
      central.push({ nameBytes, crc, size: file.data.length, offset });
      offset += header.length + file.data.length;
    }

    const centralChunks = [];
    let centralSize = 0;
    for (const entry of central) {
      const record = new Uint8Array(46 + entry.nameBytes.length);
      const view = new DataView(record.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(12, 0x21, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.nameBytes.length, true);
      view.setUint32(42, entry.offset, true);
      record.set(entry.nameBytes, 46);
      centralChunks.push(record);
      centralSize += record.length;
    }

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, central.length, true);
    endView.setUint16(10, central.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);

    return concat([...local, ...centralChunks, end]);
  }

  function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]
    ));
  }

  const MONO = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>';

  function run(text, props = "") {
    const rpr = props ? `<w:rPr>${props}</w:rPr>` : "";
    return `<w:r>${rpr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  }

  const SUPERSCRIPT = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "n": "ⁿ", "x": "ˣ", "i": "ⁱ" };
  const SUBSCRIPT = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", "a": "ₐ", "e": "ₑ", "i": "ᵢ", "o": "ₒ", "x": "ₓ", "n": "ₙ" };

  function mapChars(text, table) {
    return String(text).split("").map((ch) => table[ch] ?? ch).join("");
  }

  // ponytail: konversi LaTeX seperlunya ke Unicode; upgrade: MathML/OMML bila rumus kompleks.
  function latexToText(tex) {
    let s = String(tex).trim().replace(/\\\\/g, "\\");
    s = s.replace(/\\(?:text|mathrm|operatorname|mathbf|mathit)\s*\{([^{}]*)\}/g, "$1");
    s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (match, a, b) =>
      (/^[\w.,]+$/.test(a) && /^[\w.,]+$/.test(b) ? `${a}/${b}` : `(${a})/(${b})`));
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (match, a) => (/^[\w.,]+$/.test(a) ? `√${a}` : `√(${a})`));
    s = s.replace(/\\%/g, "%").replace(/\\times/g, "×").replace(/\\div/g, "÷").replace(/\\cdot/g, "·");
    s = s.replace(/\\pm/g, "±").replace(/\\leq/g, "≤").replace(/\\geq/g, "≥").replace(/\\neq/g, "≠");
    s = s.replace(/\\pi/g, "π").replace(/\\infty/g, "∞").replace(/\\sum/g, "Σ").replace(/\\int/g, "∫");
    s = s.replace(/\\approx/g, "≈").replace(/\\equiv/g, "≡").replace(/\\alpha/g, "α").replace(/\\beta/g, "β");
    s = s.replace(/\\gamma/g, "γ").replace(/\\theta/g, "θ").replace(/\\lambda/g, "λ").replace(/\\mu/g, "µ");
    s = s.replace(/\\sigma/g, "σ").replace(/\\phi/g, "φ").replace(/\\omega/g, "ω").replace(/\\Delta/g, "Δ");
    s = s.replace(/\\left|\\right/g, "").replace(/\\[,;!]/g, " ").replace(/\\(quad|qquad)/g, " ");
    s = s.replace(/\\[a-zA-Z]+/g, " ");
    s = s.replace(/\^\s*\{([^{}]*)\}/g, (match, group) => mapChars(group, SUPERSCRIPT));
    s = s.replace(/_\s*\{([^{}]*)\}/g, (match, group) => mapChars(group, SUBSCRIPT));
    s = s.replace(/[{}]/g, "");
    s = s.replace(/\^([0-9]+)/g, (match, group) => mapChars(group, SUPERSCRIPT));
    s = s.replace(/_([0-9]+)/g, (match, group) => mapChars(group, SUBSCRIPT));
    return s.replace(/\s+/g, " ").trim();
  }

  const MATH_HINT = /\\(?:frac|sqrt|times|div|cdot|pm|mp|leq|le|geq|ge|neq|ne|approx|equiv|infty|pi|alpha|beta|gamma|theta|lambda|mu|sigma|phi|omega|Delta|Sigma|sum|int|left|right|quad|qquad|text|mathrm|operatorname|mathbf|mathit|%)|[\\^_]\{|[0-9A-Za-z)\]]\^[0-9(]/;

  // Hanya anggap $...$ sebagai rumus bila isinya memang matematis, agar harga "$5 dan $10" tidak diubah.
  function isMathSpan(content) {
    return /[\\{}^_=]|[+\-*/×÷]/.test(content) || !/\s/.test(content.trim());
  }

  const DISPLAY_MATH = /^(?:\$\$(.+?)\$\$|\\{1,2}\[([\s\S]+?)\\{1,2}\])$/;

  // Model sering menaruh \[ dan \] pada baris sendiri; satukan dulu agar terbaca sebagai satu rumus.
  function normalizeDisplayMath(markdown) {
    return String(markdown)
      .replace(/\\{1,2}\[[ \t]*\n+([\s\S]*?)\n+[ \t]*\\{1,2}\]/g, (match, body) => `\\[${body.replace(/\n+/g, " ").trim()}\\]`)
      .replace(/^[ \t]*\\{1,2}[\[\]][ \t]*$/gm, () => "");
  }

  // Buang penanda $...$ / $$...$$ / \(...\) / \[...\] agar LaTeX mentah tidak ikut tercetak.
  function stripMath(text) {
    return String(text)
      .replace(/\$\$([\s\S]+?)\$\$/g, (match, expr) => ` ${latexToText(expr)} `)
      .replace(/\\{1,2}\[([\s\S]+?)\\{1,2}\]/g, (match, expr) => ` ${latexToText(expr)} `)
      .replace(/\\{1,2}\(([\s\S]+?)\\{1,2}\)/g, (match, expr) => latexToText(expr))
      .replace(/\$([^$\n]+?)\$/g, (match, expr) => (isMathSpan(expr) ? latexToText(expr) : match));
  }

  // Konversi LaTeX di luar $...$ hanya bila ada petunjuk jelas, agar path seperti C:\Users tidak dirusak.
  function normalizeMath(text) {
    const stripped = stripMath(text);
    return MATH_HINT.test(stripped) ? latexToText(stripped) : stripped;
  }

  function inlineRuns(text, base = "") {
    const source = normalizeMath(text);
    const boldProps = base.includes("<w:b/>") ? base : `${base}<w:b/>`;
    const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;
    const runs = [];
    let last = 0;
    let match;
    while ((match = pattern.exec(source))) {
      if (match.index > last) runs.push(run(source.slice(last, match.index), base));
      if (match[2] !== undefined) runs.push(run(match[2], boldProps));
      else if (match[3] !== undefined) runs.push(run(match[3], `${base}${MONO}`));
      else runs.push(run(match[4], `${base}<w:i/>`));
      last = pattern.lastIndex;
    }
    if (last < source.length) runs.push(run(source.slice(last), base));
    return runs.join("");
  }

  const TABLE_WIDTH = 9638;
  const TABLE_BORDERS = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`)
    .join("");
  // Margin dalam sel agar teks tidak menempel ke garis tabel.
  const TABLE_CELL_MARGIN = '<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>';

  function isTableRow(line) {
    return line.length > 2 && line.startsWith("|") && line.endsWith("|");
  }

  function isSeparatorRow(line) {
    return /^\|[\s:|-]+\|$/.test(line);
  }

  function tableCellXml(text, header, width) {
    const runs = inlineRuns(text, header ? "<w:b/>" : "") || run("");
    const shade = header ? '<w:shd w:val="clear" w:fill="F3F4F6"/>' : "";
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr><w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>${runs}</w:p></w:tc>`;
  }

  function tableXml(rows) {
    const cols = Math.max(...rows.map((row) => row.length));
    const width = Math.floor(TABLE_WIDTH / cols);
    const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`;
    const body = rows
      .map((row, index) => `<w:tr>${Array.from({ length: cols }, (_, col) => tableCellXml(row[col] ?? "", index === 0, width)).join("")}</w:tr>`)
      .join("");
    return `<w:tbl><w:tblPr><w:tblW w:w="${TABLE_WIDTH}" w:type="dxa"/><w:tblBorders>${TABLE_BORDERS}</w:tblBorders>${TABLE_CELL_MARGIN}</w:tblPr>${grid}${body}</w:tbl><w:p/>`;
  }

  function paragraph(runs, props = "") {
    const ppr = props ? `<w:pPr>${props}</w:pPr>` : "";
    return `<w:p>${ppr}${runs}</w:p>`;
  }

  function codeParagraph(lines) {
    const inner = lines.map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`).join("<w:br/>");
    return `<w:p><w:pPr><w:shd w:val="clear" w:fill="F3F4F6"/></w:pPr><w:r><w:rPr>${MONO}</w:rPr>${inner}</w:r></w:p>`;
  }

  function markdownToBody(markdown) {
    const lines = normalizeDisplayMath(markdown).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let codeBuffer = null;
    let orderedIndex = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith("```")) {
        if (codeBuffer === null) codeBuffer = [];
        else {
          out.push(codeParagraph(codeBuffer));
          codeBuffer = null;
        }
        continue;
      }
      if (codeBuffer !== null) {
        codeBuffer.push(line);
        continue;
      }

      if (!trimmed) {
        orderedIndex = 0;
        continue;
      }

      const displayMath = trimmed.match(DISPLAY_MATH);
      if (displayMath) {
        out.push(paragraph(
          run(latexToText(displayMath[1] ?? displayMath[2]), "<w:i/>"),
          '<w:jc w:val="center"/><w:spacing w:before="120" w:after="120"/>'
        ));
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const size = { 1: 32, 2: 28, 3: 26, 4: 24, 5: 22, 6: 20 }[heading[1].length];
        out.push(paragraph(
          inlineRuns(heading[2], `<w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`),
          '<w:spacing w:before="240" w:after="120"/>'
        ));
        continue;
      }

      if (/^[-*+]\s+/.test(trimmed)) {
        out.push(paragraph(inlineRuns(`• ${trimmed.replace(/^[-*+]\s+/, "")}`), '<w:ind w:left="360"/>'));
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        orderedIndex += 1;
        out.push(paragraph(inlineRuns(`${orderedIndex}. ${trimmed.replace(/^\d+\.\s+/, "")}`), '<w:ind w:left="360"/>'));
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        out.push(paragraph(inlineRuns(trimmed.replace(/^>\s?/, "")), '<w:ind w:left="360"/>'));
        continue;
      }

      if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) continue;

      if (isTableRow(trimmed)) {
        const rows = [];
        while (i < lines.length && isTableRow(lines[i].trim())) {
          const row = lines[i].trim();
          if (!isSeparatorRow(row)) rows.push(row.slice(1, -1).split("|").map((cell) => cell.trim()));
          i += 1;
        }
        i -= 1;
        if (rows.length) out.push(tableXml(rows));
        continue;
      }

      out.push(paragraph(inlineRuns(trimmed)));
    }

    if (codeBuffer !== null) out.push(codeParagraph(codeBuffer));
    return out.join("");
  }

  const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

  const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  function buildDocumentXml(markdown) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${markdownToBody(markdown)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
  }

  function buildDocxBytes(markdown) {
    const part = (text) => encoder.encode(text);
    return zipStore([
      { name: "[Content_Types].xml", data: part(CONTENT_TYPES) },
      { name: "_rels/.rels", data: part(RELS) },
      { name: "word/document.xml", data: part(buildDocumentXml(markdown)) }
    ]);
  }

  function fileName(title) {
    const clean = String(title || "").replace(/[\\/:*?"<>|\n\r…]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
    return `${clean || "dokumen"}.docx`;
  }

  function download(markdown, title) {
    const blob = new Blob([buildDocxBytes(markdown)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(title);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { buildDocxBytes, buildDocumentXml, fileName, download, crc32 };
});
