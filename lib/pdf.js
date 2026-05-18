import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// PDF page dimensions (in points)
const PAGE_W = 623.622
const PAGE_H = 311.811

// White box coords (y from bottom)
const BOX_X0       = 200.858
const BOX_Y_BOTTOM = 52.442
const BOX_X1       = 422.764
const BOX_Y_TOP    = 83.272
const BOX_H        = BOX_Y_TOP - BOX_Y_BOTTOM  // ~30.83
const BOX_W        = BOX_X1 - BOX_X0

export async function generateVoucherPdf(amount, voucherCode) {
  const templatePath = path.join(__dirname, '..', 'assets', 'voucher-template.pdf')
  const templateBytes = fs.readFileSync(templatePath)

  const pdfDoc = await PDFDocument.load(templateBytes)
  const pages = pdfDoc.getPages()

  // page 0 = 500 Kč, page 1 = 1000 Kč
  const pageIndex = amount === 500 ? 0 : 1
  const page = pages[pageIndex]

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const helvetica     = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const gray  = rgb(0.6,  0.6,  0.6)
  const dark  = rgb(0.07, 0.07, 0.07)
  const white = rgb(1,    1,    1)

  // 1. White rectangle — cover original "Platí do" text
  page.drawRectangle({
    x:      BOX_X0,
    y:      BOX_Y_BOTTOM,
    width:  BOX_W,
    height: BOX_H,
    color:  white,
  })

  const textX = BOX_X0 + 8

  // 2. "Kód voucheru" label
  page.drawText('Kod voucheru', {
    x:     textX,
    y:     BOX_Y_BOTTOM + BOX_H - 11,
    size:  7.5,
    font:  helvetica,
    color: gray,
  })

  // 3. Code value (large bold)
  page.drawText(voucherCode, {
    x:     textX,
    y:     BOX_Y_BOTTOM + 5,
    size:  14,
    font:  helveticaBold,
    color: dark,
  })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}
