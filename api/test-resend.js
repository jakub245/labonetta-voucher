export default async function handler(req, res) {
  const key = 're_hzrAKTct_HGuhYncQFFd2An3BEzJ1Kw7t'
  
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'noreply@labonetta.cz',
      to: 'studio@eliathos.cz',
      subject: 'Test Resend',
      html: '<p>Test</p>'
    })
  })

  const data = await response.json()
  return res.status(response.status).json(data)
}
