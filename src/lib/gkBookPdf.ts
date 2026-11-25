import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DigitalGKBook } from '../types/library';

function sanitizeWinAnsi(text: string): string {
  // Standard PDF Helvetica font uses WinAnsi encoding; replace unsupported non-Latin characters cleanly
  return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
}

function wrapLines(text: string, maxChars: number): string[] {
  const words = sanitizeWinAnsi(text).split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxChars) {
      current += ` ${w}`;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function downloadGKBookAsPdf(book: DigitalGKBook): Promise<void> {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  let y = 785;
  const marginX = 48;

  const ensureSpace = (needed: number) => {
    if (y - needed < 56) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = 790;
    }
  };

  // Cover Header Band (Stitch Navy #002046)
  page.drawRectangle({
    x: 0,
    y: 745,
    width: 595.28,
    height: 97,
    color: rgb(0, 0.125, 0.275), // #002046
  });
  page.drawText('GYAN ADDA LIBRARY · DIGITAL GK ARCHIVE', {
    x: marginX,
    y: 808,
    size: 10,
    font: fontBold,
    color: rgb(0.84, 0.89, 1), // #D6E3FF
  });
  page.drawText(sanitizeWinAnsi(book.title), {
    x: marginX,
    y: 782,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText(`Subject: ${sanitizeWinAnsi(book.subject)}`, {
    x: marginX,
    y: 760,
    size: 11,
    font: fontRegular,
    color: rgb(0.84, 0.89, 1),
  });

  y = 715;
  const descLines = wrapLines(book.description, 82);
  for (const line of descLines) {
    ensureSpace(18);
    page.drawText(line, { x: marginX, y, size: 11, font: fontRegular, color: rgb(0.27, 0.28, 0.31) });
    y -= 16;
  }
  y -= 12;

  for (let i = 0; i < book.chapters.length; i++) {
    const ch = book.chapters[i];
    ensureSpace(46);
    page.drawText(`Chapter ${i + 1}: ${sanitizeWinAnsi(ch.title)}`, {
      x: marginX,
      y,
      size: 14,
      font: fontBold,
      color: rgb(0, 0.125, 0.275),
    });
    y -= 20;

    for (const line of wrapLines(ch.summary, 84)) {
      ensureSpace(16);
      page.drawText(line, { x: marginX, y, size: 10, font: fontBold, color: rgb(0, 0.318, 0.835) });
      y -= 15;
    }
    y -= 6;

    for (const line of wrapLines(ch.contentText, 86)) {
      ensureSpace(16);
      page.drawText(line, { x: marginX, y, size: 10, font: fontRegular, color: rgb(0.043, 0.11, 0.188) });
      y -= 15;
    }
    y -= 8;

    if (ch.keyFacts && ch.keyFacts.length > 0) {
      ensureSpace(22);
      page.drawText('Key Exam Points:', {
        x: marginX,
        y,
        size: 10,
        font: fontBold,
        color: rgb(0, 0.125, 0.275),
      });
      y -= 15;
      for (const fact of ch.keyFacts) {
        const factLines = wrapLines(`• ${fact}`, 82);
        for (const fl of factLines) {
          ensureSpace(15);
          page.drawText(fl, { x: marginX + 8, y, size: 9.5, font: fontRegular, color: rgb(0.2, 0.2, 0.25) });
          y -= 14;
        }
      }
    }
    y -= 16;
  }

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${book.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-gyan-adda-library.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
