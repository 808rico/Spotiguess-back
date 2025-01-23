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

const { Pool } = require('pg');
let pool;

pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});


router.post('/settings/game-mode', async (req, res) => {
    try {

        const { accessToken, gameType } = req.body; // ou votre ID de prix hardcoded
        console.log('gameType:', gameType);
        spotifyApi.setAccessToken(accessToken);


        // Récupérer les informations de l'utilisateur Spotify
        const userInfo = await spotifyApi.getMe();
        const userId = userInfo.body.id;
        const email = userInfo.body.email;

        if (process.env.NODE_ENV === 'production') {
            mixpanel.track('SWITCH GAME MODE', {
                distinct_id: userId,
                email: email,
                gameType: gameType,
            });
        }

        // Vérifier si l'user_id existe déjà
        const result = await pool.query(
            'SELECT 1 FROM settings WHERE user_id = $1',
            [userId]
        );

        if (result.rowCount > 0) {
            // Mettre à jour le game_type si l'user_id existe
            await pool.query(
                'UPDATE settings SET game_type = $2 WHERE user_id = $1',
                [userId, gameType]
            );
        } else {
            // Insérer un nouvel enregistrement si l'user_id n'existe pas
            await pool.query(
                'INSERT INTO settings (user_id, game_type) VALUES ($1, $2)',
                [userId, gameType]
            );
        }
        res.json({ success: true });


    } catch (err) {
        console.error('Error updating game mode', err);
        res.status(500).send('Error updating game mode');
        return;
    }

});


router.get('/settings/game-mode', async (req, res) => {
    try {
        const accessToken = req.query.accessToken;
        spotifyApi.setAccessToken(accessToken);

        // Récupérer les informations de l'utilisateur Spotify
        const userInfo = await spotifyApi.getMe();
        const userId = userInfo.body.id;

        // Récupérer le game_type de l'utilisateur
        const result = await pool.query(
            'SELECT game_type FROM settings WHERE user_id = $1',
            [userId]
        );

        if (result.rowCount > 0) {
            res.json({ gameType: result.rows[0].game_type });
        } else {
            res.json({ gameType: 'manual' });
        }

    } catch (err) {
        console.error('Error getting game mode', err);
        res.status(500).send('Error getting game mode');
        return;
    }
});



module.exports = router;