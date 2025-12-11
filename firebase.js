const admin = require("firebase-admin");

let serviceAccount;
if (process.env.KEY_JSON) {
  serviceAccount = JSON.parse(process.env.KEY_JSON);
}
else {
  serviceAccount = require("./key.json");
}

// Inicialización
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}


const db = admin.firestore();

// 🚨 CORRECCIÓN CLAVE: EXPORTAR 'admin' junto con 'db'
module.exports = {
  db,
  admin // <-- ESTO ES LO QUE FALTABA
};