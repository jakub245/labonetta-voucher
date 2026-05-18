// GoPay REST API helper
// Docs: https://doc.gopay.com

const GOPAY_API = process.env.GOPAY_SANDBOX === 'true'
  ? 'https://gw.sandbox.gopay.com/api'
  : 'https://gate.gopay.cz/api'

let _token = null
let _tokenExpires = 0

// Get OAuth2 access token (cached)
async function getToken() {
  if (_token && Date.now() < _tokenExpires) return _token

  const credentials = Buffer.from(
    `${process.env.GOPAY_CLIENT_ID}:${process.env.GOPAY_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch(`${GOPAY_API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: 'grant_type=client_credentials&scope=payment-all'
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GoPay auth failed: ${err}`)
  }

  const data = await res.json()
  _token = data.access_token
  _tokenExpires = Date.now() + (data.expires_in - 60) * 1000
  return _token
}

// Create a new payment
export async function createPayment({ amount, email, voucherCode, returnUrl, notifyUrl }) {
  const token = await getToken()

  const body = {
    payer: {
      contact: {
        email
      }
    },
    target: {
      type: 'ACCOUNT',
      goid: Number(process.env.GOPAY_GOID)
    },
    amount: amount * 100, // GoPay uses haléře
    currency: 'CZK',
    order_number: voucherCode,
    order_description: `Voucher Labonetta ${amount} Kč`,
    items: [
      {
        type: 'ITEM',
        name: `Voucher Labonetta ${amount} Kč`,
        amount: amount * 100,
        count: 1,
        vat_rate: 'RATE3' // 0% DPH pro vouchery
      }
    ],
    callback: {
      return_url: returnUrl,
      notification_url: notifyUrl
    },
    lang: 'CS'
  }

  const res = await fetch(`${GOPAY_API}/payments/payment`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GoPay createPayment failed: ${err}`)
  }

  return res.json() // { id, gw_url, ... }
}

// Get payment status
export async function getPaymentStatus(paymentId) {
  const token = await getToken()

  const res = await fetch(`${GOPAY_API}/payments/payment/${paymentId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GoPay getStatus failed: ${err}`)
  }

  return res.json() // { id, state, amount, ... }
}
