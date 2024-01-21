const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const cors = require('cors');
const bodyParser = require('body-parser');
const recommendationRoutes = require('./recommendationRoutes');
const paymentRoutes = require('./paymentRoutes');

require("dotenv").config();

const OpenAI = require('openai');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const Mixpanel = require('mixpanel');
const mixpanel = Mixpanel.init('26a673ded09e692f1f1a58859b17001b');



const app = express();
app.use(cors({ origin: true }));

app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') { // Remplacez '/webhook-route' par le chemin exact de votre webhook
      next();
  } else {
      bodyParser.json()(req, res, next);
  }
});


app.use(recommendationRoutes);
app.use(paymentRoutes);

//const urlClientLocal = 'http://localhost:3000/'
//const urlClientOnline = 'https://app.spotiguess.com/'
//const urlClientOnline='http://localhost:3000/'
//const urlClientOnline='https://scintillating-cucurucho-f3d460.netlify.app'

const urlClient = process.env.URL_CLIENT

const spotifyApi = new SpotifyWebApi({
  clientId: '80256b057e324c5f952f3577ff843c29',
  clientSecret: process.env.CLIENT_SECRET
})

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
  console.log('login')
  console.log(urlClient)
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

async function canUserPlay(username) {
  const currentDate = new Date();
  console.log('can user play', username)
  
  // Vérifier si l'utilisateur a un pass valide
  const checkPass = await pool.query(
    'SELECT COUNT(*) FROM purchases WHERE user_id = $1 AND expiration_date > $2',
    [username, currentDate]
  );

  console.log(checkPass.rows[0])
  const hasValidPass = parseInt(checkPass.rows[0].count) > 0;

  if (hasValidPass) {
    return true; // L'utilisateur peut jouer car il a un pass valide
  }

  // Vérifier le quota de blindtests
  const oneDayAgo = new Date();
  oneDayAgo.setHours(oneDayAgo.getHours() - 24);
  const checkQuota = await pool.query(
    'SELECT COUNT(*) FROM blindtests WHERE user_id = $1 AND test_time > $2',
    [username, oneDayAgo]
  );
  const testCount = parseInt(checkQuota.rows[0].count);

  return testCount < 5; // L'utilisateur peut jouer si le quota n'est pas dépassé
}



app.post('/ai-generated', async (req, res) => {
  try {
    const userInput = req.body.preferences;
    const spotifyAccessToken = req.body.spotifyAccessToken;

    spotifyApi.setAccessToken(spotifyAccessToken);
    // Récupérer les informations de l'utilisateur Spotify
    const userInfo = await spotifyApi.getMe();
    const username = userInfo.body.id;
    const email = userInfo.body.email;

    
    const canPlay = await canUserPlay(username);

    if (!canPlay) {
      return res.status(400).send('Quizz quota exceeded');
    }



    const gptResponse = await openai.chat.completions.create({
      //model: "gpt-3.5-turbo",
      model: 'gpt-4-1106-preview',
      response_format: { "type": "json_object" },
      messages: [{
        role: "user",
        content: `Generate a 10 real songs playlist based on the following input: ${userInput}. Answer only with a JSON array, for each item return the song and the artist like this example {"playlist": ["Billie Jean - Michael Jackson", "One - U2"]}`
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
    const songNames = [];

    for (let song of songs) {

      const searchResponse = await spotifyApi.searchTracks(song);
      if (searchResponse.body.tracks.items.length > 0) {
        const trackUri = searchResponse.body.tracks.items[0].uri;
        songUris.push(trackUri);
        console.log(searchResponse.body.tracks.items[0].name)
        songNames.push(searchResponse.body.tracks.items[0].name)
      }
    }

    console.log('username',username)

    await pool.query(
      'INSERT INTO blindtests (user_id) VALUES ($1)',
      [username]
    );


    if (process.env.NODE_ENV === 'production') {
      mixpanel.track('AI-GENERATED', {
        distinct_id: username,
        email: email,
        prompt: userInput,
        response: gptContent,
        tracklist: songNames,
      });
    }

    res.json({ songUris: songUris });

  } catch (err) {
    console.error('Erreur lors de la génération de la playlist:', err);
    res.status(500).send('Erreur interne du serveur');
  }
});



app.post('/liked-songs', async (req, res) => {
  const accessToken = req.body.accessToken;

  try {
    spotifyApi.setAccessToken(accessToken);

    // Récupérer les informations de l'utilisateur Spotify
    const userInfo = await spotifyApi.getMe();
    const username = userInfo.body.id;
    const email = userInfo.body.email;


    const canPlay = await canUserPlay(username);

    if (!canPlay) {
      return res.status(400).send('Quizz quota exceeded');
    }

    // Obtenir le nombre total de chansons sauvegardées
    const data = await spotifyApi.getMySavedTracks({ limit: 1 });
    const totalTracks = data.body.total;

    // Générer 20 indices aléatoires et récupérer les chansons
    const randomSongPromises = [];
    for (let i = 0; i < 20; i++) {
      const randomSongNumber = Math.floor(Math.random() * totalTracks);
      randomSongPromises.push(
        spotifyApi.getMySavedTracks({ limit: 1, offset: randomSongNumber })
      );
    }

    // Attendre que toutes les promesses se résolvent
    const songResults = await Promise.all(randomSongPromises);
    //console.log(songResults)
    const randomSongs = songResults.map(result => result.body.items[0].track);
    //console.log(randomSongs)

    await pool.query(
      'INSERT INTO blindtests (user_id) VALUES ($1)',
      [username]
    );

    // Suivi Mixpanel
    if (process.env.NODE_ENV === 'production') {
      mixpanel.track('LIKED SONGS', {
        distinct_id: username,
        email: email,
        // Autres propriétés si nécessaire
      });
    }

    res.json(randomSongs);

  } catch (err) {
    console.error("Error in /liked-songs:", err);
    res.status(500).send('Erreur interne du serveur');
  }
});



app.post('/playlist', async (req, res) => {


  try {
    const accessToken = req.body.accessToken;
    const playlistId = req.body.playlistId;

    spotifyApi.setAccessToken(accessToken);

    // Récupérer les informations de l'utilisateur Spotify
    const userInfo = await spotifyApi.getMe();
    const username = userInfo.body.id;
    const email = userInfo.body.email;

    const canPlay = await canUserPlay(username);

    if (!canPlay) {
      return res.status(400).send('Quizz quota exceeded');
    }


    const playlistData = await spotifyApi.getPlaylist(playlistId);
    const playlistName = playlistData.body.name;

    const { body: { total } } = await spotifyApi.getPlaylistTracks(playlistId, { limit: 1 });
    let allTracks = [];
    for (let offset = 0; offset < total; offset += 50) {
      const { body: { items } } = await spotifyApi.getPlaylistTracks(playlistId, { limit: 50, offset });
      allTracks = [...allTracks, ...items];
    }

    // Mélanger les pistes et sélectionner les 20 premières URIs
    const shuffledTracks = allTracks.sort(() => 0.5 - Math.random());
    const selectedTracks = shuffledTracks.slice(0, 20).map(track => track.track.uri);

    await pool.query(
      'INSERT INTO blindtests (user_id) VALUES ($1)',
      [username]
    );

    // Suivi Mixpanel
    if (process.env.NODE_ENV === 'production') {
      mixpanel.track('PLAYLIST', {
        distinct_id: username,
        email: email,
        playlistName: playlistName,
        // Autres propriétés si nécessaire
      });
    }

    res.json(selectedTracks);

  } catch (err) {
    console.error("Error in /liked-songs:", err);
    res.status(500).send('Erreur interne du serveur');
  }
});


app.post('/artist', async (req, res) => {


  try {
    const accessToken = req.body.accessToken;
    const artistId = req.body.artistId;

    spotifyApi.setAccessToken(accessToken);

    // Récupérer les informations de l'utilisateur Spotify
    const userInfo = await spotifyApi.getMe();
    const username = userInfo.body.id;
    const email = userInfo.body.email;

    const canPlay = await canUserPlay(username);

    if (!canPlay) {
      return res.status(400).send('Quizz quota exceeded or no valid pass');
    }
    
    const artistData = await spotifyApi.getArtist(artistId);
    const artistName = artistData.body.name;

    const albumsData = await spotifyApi.getArtistAlbums(artistId);
    const albums = albumsData.body.items;

    // Prepare to gather track data
    let trackUris = [];
    let albumTracksPromises = [];

    // Get tracks from each album
    albums.forEach(album => {
      albumTracksPromises.push(spotifyApi.getAlbumTracks(album.id));
    });

    const albumsTracksData = await Promise.all(albumTracksPromises);

    // Flatten the array of track data
    let allTracks = [];
    albumsTracksData.forEach(albumTracks => {
      allTracks.push(...albumTracks.body.items);
    });

    // Random selection of 15 songs
    while (trackUris.length < 15 && allTracks.length > 0) {
      let randomIndex = Math.floor(Math.random() * allTracks.length);
      trackUris.push(allTracks[randomIndex].uri);
      allTracks.splice(randomIndex, 1); // Remove the selected track
    }


    await pool.query(
      'INSERT INTO blindtests (user_id) VALUES ($1)',
      [username]
    );

    // Suivi Mixpanel
    if (process.env.NODE_ENV === 'production') {
      mixpanel.track('ARTIST', {
        distinct_id: username,
        email: email,
        artistName: artistName,
        // Autres propriétés si nécessaire
      });
    }
    res.json(trackUris);

  } catch (err) {
    console.error("Error in /liked-songs:", err);
    res.status(500).send('Erreur interne du serveur');
  }
});

const PORT = process.env.PORT || 3001; // Utilisation de la variable d'environnement PORT de Heroku ou, par défaut, du port 3000
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

