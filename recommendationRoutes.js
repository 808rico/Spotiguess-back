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

function selectRandom(items, count, maxCount = items.length) {
    const shuffled = [...items].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, maxCount));
}

// Exemple de route à la racine
router.post('/ai-recommendations', async (req, res) => {

    // Function to shuffle an array
    const shuffleArray = array => array.sort(() => Math.random() - 0.5);


    try {

        console.log("AI recommendations")
        const accessToken = req.body.accessToken;

        // Définir le token d'accès Spotify
        spotifyApi.setAccessToken(accessToken);

        // Récupérer les informations utilisateur
        const userInfo = await spotifyApi.getMe();
        const username = userInfo.body.id;
        const email = userInfo.body.email;

        // Récupérer les artistes préférés de l'utilisateur
        const topArtistsData = await spotifyApi.getMyTopArtists({ limit: 10 });
        let topArtists = topArtistsData.body.items.map(artist => artist.name);
        topArtists = shuffleArray(topArtists);

        const topSongsData = await spotifyApi.getMyTopTracks({ limit: 10 });
        let topSongs = topSongsData.body.items.map(song => song.name);
        topSongs = shuffleArray(topSongs);

        console.log(topArtists.join(', '));



        // Construire le prompt avec les artistes préférés
        const prompt = `
            Here are the user's favorite artists: ${topArtists.join(', ')} and top songs: ${topSongs.join(', ')},
            Provide 4 specific and niched down playlist title and subtitle recommendations.
            
            Avoid mixing genres and provide a clear theme for each playlist.

            2 playlists should be based on the user's favorite artists and songs.
            2 playlists should be based on a genre and a timeperiod that the user could like based on their favorite artists and songs.

            Only answer in a JSON format. The JSON should include one list called playlist.
            Each item of the list has 2 properties: title and subtitle.
            Don't answer anything else except JSON.
        `;

        // Envoyer la requête à OpenAI
        const gptResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 400,
        });

        let rawContent = gptResponse.choices[0].message.content;

        // Supprimer les backticks et les balises de bloc de code
        rawContent = rawContent.replace(/```json|```/g, '').trim();

        const gptContent = JSON.parse(rawContent);


        // Tracker avec Mixpanel en production
        if (process.env.NODE_ENV === 'production') {
            mixpanel.track('AI-SUGGESTION', {
                distinct_id: username,
                email: email,
                suggestion: gptContent,
                topArtists: topArtists,
            });
        }

        // Retourner les suggestions de playlists
        res.json(gptContent);

    } catch (err) {
        console.error('Erreur lors de la génération de la playlist:', err);
        res.status(500).send('Internal server error');
    }
});

// Fonction pour sélectionner aléatoirement des éléments dans une liste


router.post('/playlist-recommendations', async (req, res) => {
    try {
        const accessToken = req.body.accessToken;
        spotifyApi.setAccessToken(accessToken);

        const userInfo = await spotifyApi.getMe();
        const username = userInfo.body.id;
        const email = userInfo.body.email;

        // Initialisez le tableau des artistes sélectionnés
        let selectedArtists = [];

        // Effectuez les requêtes pour récupérer les données de l'utilisateur
        const [topTracksData, topArtistsData, likedSongsData] = await Promise.all([
            spotifyApi.getMyTopTracks({ limit: 10 }),
            spotifyApi.getMyTopArtists({ limit: 10 }),
            spotifyApi.getMySavedTracks({ limit: 10 })
        ]);

        // Sélectionnez aléatoirement un top track et extrayez l'artiste
        const selectedTrack = selectRandom(topTracksData.body.items, 1)[0];
        selectedArtists.push(selectedTrack.artists[0].name);

        // Sélectionnez aléatoirement deux top artists
        const selectedTopArtists = selectRandom(topArtistsData.body.items, 2);
        selectedArtists.push(selectedTopArtists[0].name);
        selectedArtists.push(selectedTopArtists[1].name);
        // Sélectionnez aléatoirement un liked song et extrayez l'artiste
        const selectedLikedSong = selectRandom(likedSongsData.body.items, 1)[0];
        selectedArtists.push(selectedLikedSong.track.artists[0].name);


        console.log(selectedArtists)

        let playlistRecommendations = [];

        // 5. Pour chaque artiste sélectionné, recherchez des playlists
        for (const artist of selectedArtists) {
            console.log("boucle for")
            const playlists = await spotifyApi.searchPlaylists(artist);
            // 6. Filtrez et sélectionnez aléatoirement des playlists
            const selectedPlaylists = selectRandom(playlists.body.playlists.items, 1, 15);
            playlistRecommendations = playlistRecommendations.concat(selectedPlaylists);
        }

        // 7. Assurez-vous d'avoir 4 playlists, ajustez si nécessaire
        playlistRecommendations = playlistRecommendations.slice(0, 4);
        const playlistNames = playlistRecommendations.map(playlist => playlist.name).join(', ');



        if (process.env.NODE_ENV === 'production') {
            mixpanel.track('PLAYLIST-SUGGESTION', {
                distinct_id: username,
                email: email,
                suggestion: playlistNames,
            });
        }

        // Finalement, renvoyez la liste des recommandations
        res.json({ playlistRecommendations });

    } catch (err) {
        console.error('Erreur lors de la génération de la playlist:', err);
        res.status(500).send('Internal server error');
    }
});


router.post('/artist-recommendations', async (req, res) => {
    try {
        const accessToken = req.body.accessToken;
        spotifyApi.setAccessToken(accessToken);

        const userInfo = await spotifyApi.getMe();
        const username = userInfo.body.id;
        const email = userInfo.body.email;

        // Initialisez le tableau des artistes sélectionnés
        let artistRecommendations = [];

        // Effectuez les requêtes pour récupérer les données de l'utilisateur
        const [topTracksData, topArtistsData, likedSongsData] = await Promise.all([
            spotifyApi.getMyTopTracks({ limit: 10 }),
            spotifyApi.getMyTopArtists({ limit: 10 }),
            spotifyApi.getMySavedTracks({ limit: 10 })
        ]);

        // Sélectionnez aléatoirement un top track et extrayez l'artiste
        const selectedTrack = selectRandom(topTracksData.body.items, 1)[0];
        artistRecommendations.push(selectedTrack.artists[0]);

        // Sélectionnez aléatoirement deux top artists
        const selectedTopArtists = selectRandom(topArtistsData.body.items, 2);
        artistRecommendations.push(selectedTopArtists[0]);
        artistRecommendations.push(selectedTopArtists[1]);
        // Sélectionnez aléatoirement un liked song et extrayez l'artiste
        const selectedLikedSong = selectRandom(likedSongsData.body.items, 1)[0];
        artistRecommendations.push(selectedLikedSong.track.artists[0]);



        let finalArtistDetails = [];

        // Récupérez les détails complets pour chaque artiste recommandé
        for (const artist of artistRecommendations) {
            try {
                const artistDetails = await spotifyApi.getArtist(artist.uri.split(':')[2]);
                finalArtistDetails.push(artistDetails.body);
            } catch (error) {
                console.error(`Erreur lors de la récupération des détails de l'artiste ${artist.name}:`, error);
                // Gérer l'erreur comme vous le souhaitez, par exemple en continuant avec le prochain artiste
                continue;
            }
        }


        const artistNames = artistRecommendations.map(artist => artist.name).join(', ');



        if (process.env.NODE_ENV === 'production') {
            mixpanel.track('PLAYLIST-SUGGESTION', {
                distinct_id: username,
                email: email,
                suggestion: artistNames,
            });
        }

        // Finalement, renvoyez la liste des recommandations
        res.json({ artistRecommendations: finalArtistDetails });

    } catch (err) {
        console.error('Erreur lors de la génération des recommendations artiste:', err);
        res.status(500).send('Error while searching for playlist recommendations');
    }
});

module.exports = router;
