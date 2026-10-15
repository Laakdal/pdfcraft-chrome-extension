// Writes small, valid PDFs for tests: N pages of Helvetica text, with a correct xref table.

/** A PDF with `pages` pages; each page shows `title` and its page number. `padding` adds bytes. */
export function makePdf({ pages = 2, title = 'PdfCraft test document', padding = 0 } = {}) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(null);
  const pageTree = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (let i = 1; i <= pages; i++) {
    const text = `BT /F1 28 Tf 72 720 Td (${escape(title)}) Tj 0 -40 Td /F1 18 Tf (Page ${i} of ${pages}) Tj ET`;
    const content = add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  if (padding > 0) {
    // An unreferenced stream object pads the file (for "large PDF" tests).
    add(`<< /Length ${padding} >>\nstream\n${'0'.repeat(padding)}\nendstream`);
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`;

  let out = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function escape(text) {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}
