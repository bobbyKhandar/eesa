const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue, Filter } = require('firebase-admin/firestore');

const serviceAccount = require(process.env.private_key);

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();