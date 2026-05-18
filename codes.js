// Generates unique voucher codes like LAB-A3X9-2025
export function generateVoucherCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I, O, 0, 1 (confusing)
  const year = new Date().getFullYear()
  let part = ''
  for (let i = 0; i < 4; i++) {
    part += chars[Math.floor(Math.random() * chars.length)]
  }
  return `LAB-${part}-${year}`
}
