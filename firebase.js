const admin = require("firebase-admin");

let serviceAccount;
if (process.env.KEY_JSON) {
  serviceAccount = JSON.parse(process.env.KEY_JSON);
}
else {
  serviceAccount = require("./key.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
module.exports = { db };
