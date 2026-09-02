const fs = require('fs');
const s = fs.readFileSync('backend/routes/design-requests.js', 'utf8');
const i = s.indexOf('}); } catch (err) { await client.query(\'ROLLBACK\'); console.error(\'[DesignRequests] create:\'');
console.log(s.slice(i, i + 200));
