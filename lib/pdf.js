import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'

const BOX_X0       = 200.858
const BOX_Y_BOTTOM = 52.442
const BOX_X1       = 422.764
const BOX_Y_TOP    = 83.272
const BOX_H        = BOX_Y_TOP - BOX_Y_BOTTOM
const BOX_W        = BOX_X1 - BOX_X0

export async function generateVoucherPdf(amount, voucherCode) {
  const templatePath = path.join(process.cwd(), 'assets', 'voucher-template.pdf')
  const templateBytes = fs.readFileSync(templatePath)

  const templateDoc = await PDFDocument.load(templateBytes)

  // Create new single-page document with just the right page
  const pdfDoc = await PDFDocument.create()
  const pageIndex = amount === 500 ? 0 : 1
  const [copiedPage] = await pdfDoc.copyPages(templateDoc, [pageIndex])
  pdfDoc.addPage(copiedPage)

  const page = pdfDoc.getPages()[0]

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const helvetica     = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const gray  = rgb(0.6, 0.6, 0.6)
  const dark  = rgb(0.07, 0.07, 0.07)
  const white = rgb(1, 1, 1)

  page.drawRectangle({ x: BOX_X0, y: BOX_Y_BOTTOM, width: BOX_W, height: BOX_H, color: white })

  const textX = BOX_X0 + 8
  page.drawText('Kod voucheru', { x: textX, y: BOX_Y_BOTTOM + BOX_H - 11, size: 7.5, font: helvetica, color: gray })
  page.drawText(voucherCode, { x: textX, y: BOX_Y_BOTTOM + 5, size: 14, font: helveticaBold, color: dark })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}
