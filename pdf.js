import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import os from 'os'

const execFileAsync = promisify(execFile)

// Generates a voucher PDF for the given amount and code
// Returns a Buffer with the PDF content
export async function generateVoucherPdf(amount, voucherCode) {
  const templatePath = path.join(process.cwd(), 'assets', 'voucher-template.pdf')
  const pageIndex = amount === 500 ? 0 : 1
  const outPath = path.join(os.tmpdir(), `voucher-${voucherCode}.pdf`)

  const script = `
import sys
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
import io

PAGE_W = 623.622
PAGE_H = 311.811
BOX_X0 = 200.858
BOX_Y_BOTTOM = 52.442
BOX_X1 = 422.764
BOX_Y_TOP = 83.272
BOX_H = BOX_Y_TOP - BOX_Y_BOTTOM
BOX_W = BOX_X1 - BOX_X0

template_path = sys.argv[1]
page_index = int(sys.argv[2])
voucher_code = sys.argv[3]
out_path = sys.argv[4]

overlay_buffer = io.BytesIO()
c = canvas.Canvas(overlay_buffer, pagesize=(PAGE_W, PAGE_H))

# White rect to cover original "Platí do" text
c.setFillColor(white)
c.rect(BOX_X0, BOX_Y_BOTTOM, BOX_W, BOX_H, fill=1, stroke=0)

text_x = BOX_X0 + 8

# Label
c.setFont("Helvetica", 7.5)
c.setFillColor(HexColor("#999999"))
c.drawString(text_x, BOX_Y_BOTTOM + BOX_H - 11, "Kód voucheru")

# Big code
c.setFont("Helvetica-Bold", 14)
c.setFillColor(HexColor("#111111"))
c.drawString(text_x, BOX_Y_BOTTOM + 5, voucher_code)

c.save()
overlay_buffer.seek(0)

reader = PdfReader(template_path)
overlay_reader = PdfReader(overlay_buffer)
writer = PdfWriter()
page = reader.pages[page_index]
page.merge_page(overlay_reader.pages[0])
writer.add_page(page)

with open(out_path, "wb") as f:
    writer.write(f)

print("OK")
`

  // Write temp Python script
  const scriptPath = path.join(os.tmpdir(), `gen-voucher-${Date.now()}.py`)
  fs.writeFileSync(scriptPath, script)

  try {
    await execFileAsync('python3', [
      scriptPath,
      templatePath,
      String(pageIndex),
      voucherCode,
      outPath
    ])

    const pdfBuffer = fs.readFileSync(outPath)
    return pdfBuffer
  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(scriptPath) } catch {}
    try { fs.unlinkSync(outPath) } catch {}
  }
}
