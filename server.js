

const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const cors = require('cors');
const bodyParser = require('body-parser');

require("dotenv").config();


const OpenAI = require ('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


const app = express();
app.use(cors());
app.use(bodyParser.json())

//const urlClientLocal = 'http://localhost:3000/'
//const urlClientOnline= 'https://spotiguess.com'
const urlClientOnline='https://658114a974c1ec000819e053--scintillating-cucurucho-f3d460.netlify.app/'

const urlClient = urlClientOnline

app.post("/refresh", (req, res) => {
    const refreshToken = req.body.refreshToken
    const spotifyApi = new SpotifyWebApi({
      redirectUri: urlClient,
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      refreshToken,
    })
  
    spotifyApi
      .refreshAccessToken()
      .then(data => {
        res.json({
          accessToken: data.body.access_token,
          expiresIn: data.body.expires_in,
        })
      })
      .catch(err => {
        console.log(err)
        res.sendStatus(400)
      })
  })
  
  app.post("/login", (req, res) => {
    const code = req.body.code
    const spotifyApi = new SpotifyWebApi({
      redirectUri: urlClient,
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
    })
  
    spotifyApi
      .authorizationCodeGrant(code)
      .then(data => {
        res.json({
          accessToken: data.body.access_token,
          refreshToken: data.body.refresh_token,
          expiresIn: data.body.expires_in,
        })
      })
      .catch(err => {
        console.log(err)
        res.sendStatus(400)
      })
  })

const spotifyApi = new SpotifyWebApi({
    clientId: '80256b057e324c5f952f3577ff843c29',
    clientSecret: process.env.CLIENT_SECRET
})

async function connectToSpotify() {
    try {
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
    } catch (err) {
        console.error('Erreur lors de la connexion à Spotify:', err);
    }
}

app.post('/generate', async (req, res) => {
    try {
        const userInput = req.body.preferences;

        // Connecter à Spotify
        await connectToSpotify();

        const gptResponse = await openai.chat.completions.create({

            model: "gpt-3.5-turbo",//gpt-4-1106-preview
            //response_format: { "type": "json_object" },
            messages: [{ 
                role: "user", 
                content: `Generate a 3 real songs playlist based on the following input: ${userInput}. Answer only with a JSON array, for each item return the song and the artist like this example {"playlist": ["Billie Jean - Michael Jackson", "One - U2"]}`
            }],
            
            temperature: 1,
            max_tokens: 400
        });

        console.log(gptResponse.choices[0].message.content)

        // Supposer que la réponse est une liste de chansons sous forme de chaîne de caractères
        const gptContent = JSON.parse(gptResponse.choices[0].message.content);

    // Accédez au tableau des chansons à l'intérieur de la clé 'playlist'
        const songs = gptContent.playlist;
        const songUris = [];

        for (let song of songs) {
            console.log(song)
            const searchResponse = await spotifyApi.searchTracks(song);
            if (searchResponse.body.tracks.items.length > 0) {
                const trackUri = searchResponse.body.tracks.items[0].uri;
                songUris.push(trackUri);
            }
        }

        res.json({ songUris: songUris });
    } catch (err) {
        console.error('Erreur lors de la génération de la playlist:', err);
        res.status(500).send('Erreur interne du serveur');
    }
});

app.listen(3001);

//app.listen(process.env.PORT);
