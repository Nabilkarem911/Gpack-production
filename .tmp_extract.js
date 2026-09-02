const fs = require('fs');
const s = fs.readFileSync('frontend/js/views/public-design-request.js', 'utf8');
const i = s.indexOf('async function startDesigner()');
console.log(s.slice(i - 200, i + 100));
