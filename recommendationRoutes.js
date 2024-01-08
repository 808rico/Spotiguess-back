// recommendationRoutes.js
const express = require('express');
const router = express.Router();
require("dotenv").config();
const SpotifyWebApi = require('spotify-web-api-node');

const OpenAI = require('openai');
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const Mixpanel = require('mixpanel');
const mixpanel = Mixpanel.init('26a673ded09e692f1f1a58859b17001b');

const spotifyApi = new SpotifyWebApi({
    clientId: '80256b057e324c5f952f3577ff843c29',
    clientSecret: process.env.CLIENT_SECRET
})



// Exemple de route à la racine
router.post('/ai-recommendations', async (req, res) => {

    try {


        const accessToken = req.body.accessToken;

        spotifyApi.setAccessToken(accessToken);

        const userInfo = await spotifyApi.getMe();
        const username = userInfo.body.id;
        const email = userInfo.body.email;


        const gptResponse = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            //model: 'gpt-4-1106-preview',
            //response_format: { "type": "json_object" },
            messages: [{
                role: "user",
                content: `provide 4 randomly selected specific and niched down  playlist title and subtitle, it can include specific artist, genre or period. Only answer in a JSON format,  The JSON should include one list called playlist. Each item of the list has 2 properties title and subtitle. Don't answer anything else except JSON.`
            }],

            temperature: 1,
            max_tokens: 400
        });

        const gptContent = JSON.parse(gptResponse.choices[0].message.content);



        if (process.env.NODE_ENV === 'production') {
            mixpanel.track('AI-SUGGESTION', {
                distinct_id: username,
                email: email,
                suggestion: gptContent,
            });
        }


        // Supposer que la réponse est une liste de chansons sous forme de chaîne de caractères
        // Retourner la réponse formatée
        res.json(gptContent);





    } catch (err) {
        console.error('Erreur lors de la génération de la playlist:', err);
        res.status(500).send('Internal server error', err);
    }
});



module.exports = router;
