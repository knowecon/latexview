export function pdfStringLiteral(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

export function makePdf(pageTexts) {
  const objects = [];
  const pageObjectIds = [];
  const fontObjectId = 3 + pageTexts.length * 2;

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '';

  pageTexts.forEach((text, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    pageObjectIds.push(pageObjectId);

    objects[pageObjectId] = [
      '<< /Type /Page',
      '/Parent 2 0 R',
      '/MediaBox [0 0 612 792]',
      `/Contents ${contentObjectId} 0 R`,
      `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >>`,
      '>>'
    ].join(' ');

    const stream = `BT /F1 28 Tf 72 720 Td (${pdfStringLiteral(text)}) Tj ET`;
    objects[contentObjectId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });

  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`;
  objects[fontObjectId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf);
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}
