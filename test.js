const https = require('https');

https.get('https://brooklinema.portal.civicclerk.com/api/events', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => { console.log(res.statusCode, data.substring(0, 500)); });
});
