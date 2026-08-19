// PDF prescription template filler — generates filled CGM and pump prescriptions
// by overlaying patient data on the original branded PDF templates.
//
// Ported verbatim from dtc-mm-form-H7eG34s/server/src/pdf.js (ESM -> CommonJS is
// the only change). That repo generates the same documents at intake; this copy
// exists because the tracker builds them from the Medical Evaluation board,
// which is a different monday item than the one the intake form writes. Keep the
// two in sync: the templates are byte-identical and the coordinates are tuned to
// them, so a change to either template has to land in both repos.
//
// Uses pdf-lib (pure JS, zero native deps) so it runs on Railway without config.
// Each function returns a Uint8Array (the raw PDF bytes).

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// Cache loaded template bytes so we only read from disk once per process lifetime.
const _cache = {};
function loadTemplate(filename) {
  if (!_cache[filename]) {
    _cache[filename] = fs.readFileSync(path.join(TEMPLATES_DIR, filename));
  }
  return _cache[filename];
}

// Sanitize text for pdf-lib: strip control characters that WinAnsi can't encode.
// Newlines, tabs, and other C0 controls cause a hard crash in drawText().
function safe(str) {
  if (!str) return '';
  return String(str).replace(/[\x00-\x1f\x7f]/g, ' ').trim();
}

/**
 * Draw "Label: value", or "Label: ______" when the value is blank.
 *
 * The physician block is deliberately issued empty. This form goes to the
 * patient, who hands it to whoever actually writes the prescription — the
 * intake form only collects a free-text "Dr. Patel"-style answer, and printing
 * an unverified name and a missing NPI would make the document look complete
 * when it is not. A ruled line says "fill this in" without a word of copy.
 */
function drawLabelledField(page, { label, value, x, y, endX, size, font, fontBold, color }) {
  page.drawText(label, { x, y, size, font: fontBold, color });
  const vx = x + fontBold.widthOfTextAtSize(label, size);
  if (value) {
    page.drawText(value, { x: vx, y, size, font: fontBold, color });
    return;
  }
  page.drawLine({
    start: { x: vx, y: y - 3 },
    end: { x: Math.max(vx + 40, endX), y: y - 3 },
    thickness: 0.75,
    color: rgb(0.45, 0.45, 0.45),
  });
}

// Word-level wrapping for mixed bold/regular inline segments.
// Returns the final y position after drawing.
function drawWrappedParagraph(page, segments, { x, y, maxWidth, lineHeight, font, fontBold, size, color }) {
  let cx = x;
  let cy = y;
  for (const seg of segments) {
    const f = seg.bold ? fontBold : font;
    const c = seg.color || color;
    const words = seg.text.split(/( )/);
    for (const word of words) {
      if (word === '') continue;
      const w = f.widthOfTextAtSize(word, size);
      if (cx + w > x + maxWidth && cx > x) {
        cx = x;
        cy -= lineHeight;
      }
      page.drawText(word, { x: cx, y: cy, size, font: f, color: c });
      cx += w;
    }
  }
  return cy;
}

/**
 * Fill the CGM prescription template.
 * @param {{ patientName: string, dob: string, cgmType: string, doctorName: string, doctorNpi: string }} data
 * @returns {Promise<Uint8Array>} filled PDF bytes
 */
async function fillCgmPdf(data) {
  const patientName = safe(data.patientName);
  const dob = safe(data.dob);
  const cgmType = safe(data.cgmType);
  const doctorName = safe(data.doctorName);
  const doctorNpi = safe(data.doctorNpi);

  const basePdf = loadTemplate('cgm-template.pdf');
  const doc = await PDFDocument.load(basePdf);
  doc.setTitle(`Medically Modern - CGM Prescription - ${patientName}`);
  doc.setAuthor('Medically Modern');
  doc.setSubject(`CGM Prescription (${cgmType}) for ${patientName}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const page1 = pages[0], page2 = pages[1];
  const { height: h1 } = page1.getSize();
  const { height: h2 } = page2.getSize();
  const black = rgb(0, 0, 0), white = rgb(1, 1, 1);
  const tealDark = rgb(0.38, 0.60, 0.58);
  const gray = rgb(0.3, 0.3, 0.3);

  // === PAGE 1: cover paragraph with wrapping ===
  page1.drawRectangle({ x: 62, y: h1 - 445, width: 490, height: 100, color: white });
  drawWrappedParagraph(page1, [
    { text: 'Medically Modern ', bold: true, color: tealDark },
    { text: 'is working with ' },
    { text: patientName, bold: true },
    { text: ', date of birth ' },
    { text: dob, bold: true },
    { text: ', to provide a Continuous Glucose Monitor (' },
    { text: cgmType, bold: true },
    { text: ') through their medical insurance.' },
  ], { x: 72, y: h1 - 361, maxWidth: 468, lineHeight: 22, font, fontBold, size: 14, color: black });

  // === PAGE 2 ===
  // Patient info row
  page2.drawRectangle({ x: 72, y: h2 - 242, width: 470, height: 28, color: white });
  page2.drawText('Name: ', { x: 82, y: h2 - 232, size: 11, font: fontBold, color: black });
  page2.drawText(patientName, { x: 82 + fontBold.widthOfTextAtSize('Name: ', 11), y: h2 - 232, size: 11, font, color: black });
  page2.drawText('Date of Birth: ', { x: 350, y: h2 - 232, size: 11, font: fontBold, color: black });
  page2.drawText(dob, { x: 350 + fontBold.widthOfTextAtSize('Date of Birth: ', 11), y: h2 - 232, size: 11, font, color: black });

  // Device
  page2.drawRectangle({ x: 72, y: h2 - 340, width: 300, height: 18, color: white });
  page2.drawText('Device: ', { x: 78, y: h2 - 334, size: 11, font: fontBold, color: black });
  page2.drawText(cgmType, { x: 78 + fontBold.widthOfTextAtSize('Device: ', 11), y: h2 - 334, size: 11, font: fontBold, color: black });

  // Use + Dispense lines
  page2.drawRectangle({ x: 72, y: h2 - 370, width: 480, height: 28, color: white });
  page2.drawText(`Use ${cgmType} receiver/reader and sensors per manufacturer guidelines, in accordance with FDA indication for use.`, { x: 78, y: h2 - 353, size: 8, font, color: gray });
  page2.drawText('Dispense: Receiver/Reader Qty 1, Sensors Qty sufficient for 90-day supply per labeled wear duration.', { x: 78, y: h2 - 365, size: 8, font, color: gray });

  // Physician row
  page2.drawRectangle({ x: 72, y: h2 - 633, width: 470, height: 22, color: white });
  drawLabelledField(page2, { label: 'Physician Name: ', value: doctorName, x: 82, y: h2 - 626, endX: 390, size: 10, font, fontBold, color: black });
  drawLabelledField(page2, { label: 'Physician NPI #: ', value: doctorNpi, x: 400, y: h2 - 626, endX: 535, size: 10, font, fontBold, color: black });

  return doc.save();
}

/**
 * Fill the pump prescription template.
 * @param {{ patientName: string, dob: string, pumpType: string, doctorName: string, doctorNpi: string }} data
 * @returns {Promise<Uint8Array>} filled PDF bytes
 */
async function fillPumpPdf(data) {
  const patientName = safe(data.patientName);
  const dob = safe(data.dob);
  const pumpType = safe(data.pumpType);
  const doctorName = safe(data.doctorName);
  const doctorNpi = safe(data.doctorNpi);

  const basePdf = loadTemplate('pump-template.pdf');
  const doc = await PDFDocument.load(basePdf);
  doc.setTitle(`Medically Modern - Pump Prescription - ${patientName}`);
  doc.setAuthor('Medically Modern');
  doc.setSubject(`Pump Prescription (${pumpType}) for ${patientName}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const page1 = pages[0], page2 = pages[1];
  const { height: h1 } = page1.getSize();
  const { height: h2 } = page2.getSize();
  const black = rgb(0, 0, 0), white = rgb(1, 1, 1);
  const tealDark = rgb(0.38, 0.60, 0.58);

  // === PAGE 1 ===
  page1.drawRectangle({ x: 62, y: h1 - 305, width: 490, height: 62, color: white });
  drawWrappedParagraph(page1, [
    { text: 'Medically Modern ', bold: true, color: tealDark },
    { text: 'is working to get ' },
    { text: patientName, bold: true },
    { text: ', date of birth ' },
    { text: dob, bold: true },
    { text: ', an Insulin Pump (' },
    { text: pumpType, bold: true },
    { text: ').' },
  ], { x: 72, y: h1 - 257, maxWidth: 468, lineHeight: 18, font, fontBold, size: 12, color: black });

  // === PAGE 2 ===
  page2.drawRectangle({ x: 72, y: h2 - 216, width: 470, height: 28, color: white });
  page2.drawText('Name: ', { x: 82, y: h2 - 206, size: 11, font: fontBold, color: black });
  page2.drawText(patientName, { x: 82 + fontBold.widthOfTextAtSize('Name: ', 11), y: h2 - 206, size: 11, font, color: black });
  page2.drawText('Date of Birth: ', { x: 350, y: h2 - 206, size: 11, font: fontBold, color: black });
  page2.drawText(dob, { x: 350 + fontBold.widthOfTextAtSize('Date of Birth: ', 11), y: h2 - 206, size: 11, font, color: black });

  // 130pt, not 250. At 250 this rectangle reached x=322 and wiped the "Cannul"
  // off the template's own "Cannula/Tubing Length (optional)" label sitting
  // next to it. The widest device line we can draw is "Device: Insulin Pump",
  // which ends at x=189, so 72+130=202 clears it with room and stops well
  // short of the neighbouring text.
  page2.drawRectangle({ x: 72, y: h2 - 308, width: 130, height: 18, color: white });
  page2.drawText('Device: ', { x: 78, y: h2 - 302, size: 11, font: fontBold, color: black });
  page2.drawText(pumpType, { x: 78 + fontBold.widthOfTextAtSize('Device: ', 11), y: h2 - 302, size: 11, font: fontBold, color: black });

  page2.drawRectangle({ x: 72, y: h2 - 574, width: 470, height: 22, color: white });
  drawLabelledField(page2, { label: 'Physician Name: ', value: doctorName, x: 82, y: h2 - 567, endX: 390, size: 10, font, fontBold, color: black });
  drawLabelledField(page2, { label: 'Physician NPI #: ', value: doctorNpi, x: 400, y: h2 - 567, endX: 535, size: 10, font, fontBold, color: black });

  return doc.save();
}

module.exports = { fillCgmPdf, fillPumpPdf };
