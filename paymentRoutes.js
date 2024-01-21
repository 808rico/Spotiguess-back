// paymentRoutes.js
const express = require('express');
const router = express.Router();
require("dotenv").config();
const SpotifyWebApi = require('spotify-web-api-node');


const Mixpanel = require('mixpanel');
const mixpanel = Mixpanel.init('26a673ded09e692f1f1a58859b17001b');

const spotifyApi = new SpotifyWebApi({
  clientId: '80256b057e324c5f952f3577ff843c29',
  clientSecret: process.env.CLIENT_SECRET
})

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const { Pool } = require('pg');
let pool;

if (process.env.NODE_ENV === 'production') {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });
} else {
    // Environnement de développement
    pool = new Pool({
        user: 'postgres',
        host: 'localhost',
        database: 'blindtests',
        password: process.env.PASSWORD_DATABASE,
        port: 5432
    });
}


router.post('/create-checkout-session', async (req, res) => {
  try {

    const { priceId, accessToken, purchaseType } = req.body; // ou votre ID de prix hardcoded

    spotifyApi.setAccessToken(accessToken);


    // Récupérer les informations de l'utilisateur Spotify
    const userInfo = await spotifyApi.getMe();
    const userId = userInfo.body.id;
    


    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: priceId, // Utilisez l'ID du prix de votre produit ici
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.URL_CLIENT}?payment=success`,
      cancel_url: `${process.env.URL_CLIENT}?payment=cancel`,
      metadata: {
        userId: userId,
        purchaseType: purchaseType,
      }
    });

    res.json({ sessionId: session.id });


  } catch (error) {
    res.status(500).send(error.message);
  }
});


router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  
  const payload = req.body;
  const sig = req.headers['stripe-signature'];

  let event;

  try {
      event = stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
  }
  
  // Gérez l'événement de paiement réussi
  if (event.type === 'checkout.session.completed') {
    
    
      const session = event.data.object;

      // Ajoutez ici le code pour enregistrer les détails dans la base de données
      // Par exemple, session.customer pour l'ID client, etc.

      const userId = session.metadata.userId;
      const purchaseType = session.metadata.purchaseType;

      //const userId = 'aymericoco34'
      //const purchaseType = 'UNLIMITED_PASS'

      const currentDate = new Date();
      const expirationDate = new Date();
      if (purchaseType === '24HOURS') {
        expirationDate.setDate(expirationDate.getDate() + 1);
      }

      if (purchaseType === 'UNLIMITED_PASS') {
        expirationDate.setDate(expirationDate.getDate() + 10*365);
      }

      try {
        const query = 'INSERT INTO purchases (user_id, purchase_type, purchase_date, expiration_date) VALUES ($1, $2, $3, $4)';
        const values = [userId, purchaseType, currentDate, expirationDate];
        await pool.query(query, values);
    } catch (err) {
        console.error('Erreur lors de l\'insertion dans la base de données', err);
        res.status(500).send('Erreur serveur');
        return;
    }

  }

  // Réponse à Stripe pour confirmer la réception
  res.status(200).end();
});

module.exports = router;