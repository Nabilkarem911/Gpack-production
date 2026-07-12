const bcrypt = require('bcrypt');
console.log(bcrypt.hashSync('password', 10));
