import fetch from "node-fetch";
import fs, { stat } from "fs";
import express from "express";
import expressWs from "express-ws";
import env from "dotenv";
env.config();

import { request } from 'undici';

// App Setup
const app = express();
const PORT = process.env.PORT || 3050;

// Middleware
app.use(express.static("public"));
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Cache-Control", req.path.startsWith("/api") ? "no-store" : "public, max-age=86400");

    next();
});
expressWs(app);

// Utility Functions
async function getAppleMusicData(songName, artistName) {
    const baseURL = "https://itunes.apple.com/search";
    const query = new URLSearchParams({
        term: `"${songName}" by ${artistName || ""}`,
        media: "music",
        entity: "musicTrack",
        country: "us",
        isStreamable: "true",
        limit: 10
    });

    let data;
    try {
        // console.log("opening fetch")
        const { body } = await request(`${baseURL}?${query}`, {
            method: 'GET'
        });
        data = await body.json(); // `undici` handles streaming better
    } catch (err) {
        console.error("Error fetching Apple Music data:", err);
        return false;
    }

    if (data.results.length > 0) {
        let filteredResults = data.results.filter(result => {
            if (result.previewUrl) {
                if (normalizeTrackName(result.trackName).includes(normalizeTrackName(songName)) || normalizeTrackName(songName).includes(normalizeTrackName(result.trackName))) {
                    return true;
                }
                return false;
            }
            return false;
        });
        // console.log("Got preview:", data.results[0].previewUrl);
        if (filteredResults.length > 0) {
            return filteredResults[0];
        } else {
            console.log("All music results filtered, none correct:", data.results, songName, artistName);
            return false;
        }
    }
    console.log("No preview available.");
    return false;
}

async function getRandomSong({ excludeList = [], genres = null } = {}) {
    // return {
    //     songId: "2tpWsVSb9UEmDRxAl1zhX1",
    //     songData: {
    //         previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview122/v4/c2/80/0c/c2800c2a-0b68-43c9-3701-7cb1ece6ef24/mzaf_9589312089850013533.plus.aac.p.m4a"
    //     }
    // }
    let randomRetries = 0;
    try {
        let songData = false;
        while ((!songData || !songData.previewUrl) && randomRetries < 200 && excludeList.length < songList.length) {
            if (randomRetries > 0) {
                console.log("Retrying to get random song...");
                await new Promise(resolve => setTimeout(resolve, randomRetries * 100));
            }
            const randomSong = songList[Math.floor(Math.random() * songList.length)];

            if (excludeList.includes(randomSong.songId)) continue;
            if (genres && !genres.includes(randomSong.songCategory)) continue;
            randomRetries++;

            songData = await getAppleMusicData(randomSong.songName, randomSong.songArtist);
            console.log(`Chose: ${randomSong.songName} by ${randomSong.songArtist}`);
            if (songData && songData.previewUrl) {
                return {
                    songId: randomSong.songId,
                    songData: { previewUrl: songData.previewUrl }
                };
            }

        }
        console.log("Failed to get random song.");
        return false;
    } catch (err) {
        console.error('Error reading song_choices.json:', err);
        return false;
    }
}


function normalizeTrackName(track, lookGood) {
    if (!lookGood) {
        track = track.split("-")[0]
        track = track.replace(/\s/g, '')
        track = track.replace(/\([^)]*\)/g, '')
        track = track.replace(/\[[^\]]*\]/g, '')

        track = track.replace(/[^a-zA-Z0-9]/g, '')
        track = track.toLowerCase()
        // also remove anything after a dash
    }
    return track.trim();
}

function randomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function checkUsername(username) {
    if (username.trim().length === 0) {
        return false
    }
    if (username.length > 20) {
        return false
    }
    if (username.length <= 2) {
        return false
    }

    if (!/^[a-zA-Z0-9]+$/.test(username)) {
        return false
    }

    const bannedUsernames = ["admin", "host", "server", "moderator", "administator"]
    // check if any part of username is these
    if (bannedUsernames.some(banned => username.toLowerCase().includes(banned))) {
        return false
    }

    return true
}

function checkSongMatch(songId, checkName, checkArtist) {
    const realSongInfo = songList.find(s => s.songId === songId);
    if (!realSongInfo) return false;
    const nameCorrect = normalizeTrackName(checkName).includes(normalizeTrackName(realSongInfo.songName));

    let artistCorrect = false;
    let realArtists = realSongInfo.songArtist.split(",");
    realArtists.forEach(realArtist => {
        if (normalizeTrackName(checkArtist).includes(normalizeTrackName(realArtist))) {
            artistCorrect = true;
        }
        let dashedArtists = realArtist.split("-");
        dashedArtists.forEach(realArtist => {
            if (normalizeTrackName(checkArtist).includes(normalizeTrackName(realArtist))) {
                artistCorrect = true;
            }
        });
    });
    return { nameCorrect, artistCorrect };
}

const songList = JSON.parse(fs.readFileSync('song_choices.json', 'utf8'));
const validGenres = ["Pop", "HipHop", "Classics", "Throwbacks"];

// --------------- Solo Game Routes ---------------
app.get("/api/v1/solo/randomsong", async (req, res) => {
    // get categories url param
    const { categories } = req.query;
    let parsedCategories = null;
    if (categories) {
        // parse json
        try {
            parsedCategories = JSON.parse(categories);

            if (!Array.isArray(parsedCategories)) {
                return res.status(400).send("Invalid categories format");
            }
            // check if all categories are in songList

            const invalidCategories = parsedCategories.filter(c => !validGenres.includes(c));
            if (invalidCategories.length > 0) {
                return res.status(400).send(`Invalid categories: ${invalidCategories.join(", ")}`);
            }
            // check if categories are empty
            if (parsedCategories.length === 0) {
                return res.status(400).send("No categories provided");
            }

        } catch (error) {
            return res.status(400).send("Invalid categories format");
        }
    }
    let { songId, songData } = await getRandomSong({ genres: parsedCategories });
    if (songData && songId) {
        res.send({ songData, songId });
    } else {
        res.status(500).send("Failed to fetch new song");
    }
});

app.get("/api/v1/solo/guess", async (req, res) => {
    // get song url param
    const { songName, songArtist, songId } = req.query;
    if (!songName) return res.status(400).send("No song provsongIded");
    if (!songId) return res.status(400).send("No id provided");

    const { nameCorrect, artistCorrect } = checkSongMatch(songId, songName, songArtist);
    res.send({ nameCorrect, artistCorrect });
});

app.get("/api/v1/solo/finish", async (req, res) => {
    // get song url param
    const { songId } = req.query;
    if (!songId) return res.status(400).send("No song id provided");

    let songData = songList.find(s => s.songId === songId);
    res.send({ songName: songData.songName, songArtist: songData.songArtist });
});


// --------------- "Room" Game Routes ---------------

// HTTP Endpoints:
// POST /api/v1/room/create
//   - Body: {roomId}
//   - Creates new room
//   - Returns room code

// WebSocket Endpoint: /api/v1/room/:roomId

// On connection:
// - Check if room exists and other errors

// WebSocket in events:
// - player_init: Listen for player init
// - update_status: Listen for player status update
// - update_idle: Listen for player idle status
// - player_ready: Listen for player ready to continue status
// - ping: Listen for ping from client
// - update_genres : Listen for genre update

// WebSocket out events:
// - update_timer: Broadcast  timer update
// - room_init: Broadcast room init with player list
// - ready_votes: Broadcast ready votes
// - player_idle: Broadcast when player idle status changes
// - error: Broadcast error message

// - update_genres: Broadcast genre update

// - player_joined: Broadcast when player joins
// - player_left: Broadcast when player leaves

// - round_start: Broadcast next round start
// - player_status: Broadcast when player makes guess or skip
// - round_end: Broadcast round results

// - game_start: Broadcast game start with first song
// - game_end: Broadcast final scores





let currentRooms = [
    {
        roomId: "AD3EF",
        roomPlayers: [
            {
                playerId: "A1B2C",
                playerName: "Bobby",
                playerStatus: null,
                playerScore: 0,
                playerWS: null,
            },
        ],
        roomRecentPlayers: [
            {
                playerId: "2B3C4A",
                playerName: "Jamie",
                playerStatus: "skip",
                playerSongId: "6AI3ezQ4o3HUoP6Dhudph3",
                playerScore: 50,
            },
        ],
        roomCreatedAt: '2025-02-15T02:33:20.102Z',
        roomCurrentSong: {
            songId: "6AI3ezQ4o3HUoP6Dhudph3",
            songData: {
                previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview122/v4/c2/80/0c/c2800c2a-0b68-43c9-3701-7cb1ece6ef24/mzaf_9589312089850013533.plus.aac.p.m4a"
            }
        },
        roomPreviousSongs: [
            "6AI3ezQ4o3HUoP6Dhudph3",
        ],
        roomRound: 0,
        roomReadyVotes: 0,
        roomTimeLeft: 27,
        roomSongGenres: ["Pop", "HipHop", "Classics", "Throwbacks"],
    }
]

app.get("/api/v1/room/create", async (req, res) => {
    // console.log("got req:");
    const roomId = randomCode();
    console.log("Created room:", roomId);
    const randomSong = await getRandomSong().catch(err => {
        console.error(err);
        return res.status(500).send("Failed To Create Room.");
    });
    currentRooms.push({
        roomId,
        roomSongGenres: ["Pop", "HipHop", "Classics", "Throwbacks"],
        roomPlayers: [],
        roomRecentPlayers: [],
        roomCreatedAt: new Date(),
        roomCurrentSong: randomSong,
        roomPreviousSongs: [],
        roomRound: 0,
        roomReadyVotes: 0,
        roomTimeLeft: 30
    });
    res.send({ roomId });

});


function broadcastToRoom(roomId, message, excludePlayerId = null) {
    // console.log("Broadcasting to room...", roomId, message);
    if (!roomId || !message) return console.log("No room ID or message provided to broadcast.");
    const room = currentRooms.find(r => r.roomId === roomId);
    if (!room) return;
    // console.log("Broadcast found:", room);

    room.roomPlayers.forEach(player => {
        if (excludePlayerId && player.playerId === excludePlayerId) return;
        if (player.playerWS && player.playerWS.readyState === 1) {
            player.playerWS.send(JSON.stringify(message));
        }
    });
}

// WebSocket Routes
app.ws("/api/v1/room/:roomId", (ws, req) => {
    function sendMessage(data) {
        ws?.send(JSON.stringify(data));
    }

    const { roomId } = req.params;
    const room = currentRooms.find(r => r.roomId === roomId);
    if (!room) {
        sendMessage({ event: "error", message: "Room not found." });
        ws.close();
        return;
    }

    // console.log("Connection started...");


    let playerId;
    let playerScore = 0;

    async function endRound(endType = "guessed") {
        // All players have guessed or skipped
        broadcastToRoom(roomId, { event: "round_end", endType });

        // Check if any players are correct
        let correctPlayers = room.roomPlayers.filter(p => p.playerStatus === "correct");
        if (correctPlayers.length > 0) {
            let correctPoints = Math.round(100 / correctPlayers.length);
            room.roomPlayers = room.roomPlayers.map(p => {
                if (p.playerStatus === "correct") {
                    p.playerScore += correctPoints;
                    if (p.playerId === playerId) {
                        playerScore = p.playerScore;
                    }
                    broadcastToRoom(roomId, { event: "player_status", playerId: p.playerId, playerScore: p.playerScore });
                }
                return p;
            });
        }

        room.roomRound++;
        if (room.roomRound >= 6 || correctPlayers.length > 0) {
            room.roomRound = 0;
            // Next Round
            let songInfo = songList.find(s => s.songId === room.roomCurrentSong.songId);
            setTimeout(() => {
                broadcastToRoom(roomId, { event: "game_end", correctPlayers: correctPlayers.map(p => ({ playerId: p.playerId, playerName: p.playerName })), songInfo: { songName: songInfo.songName, songArtist: songInfo.songArtist } });
            }, 200);

            clearInterval(room.roomTimer);
            room.roomTimer = null;
            room.roomTimeLeft = 30;
            broadcastToRoom(roomId, { event: "update_timer", roomTimeLeft: room.roomTimeLeft });

            room.roomReadyVotes = 0;

            room.roomPreviousSongs.push(room.roomCurrentSong.songId);
            // console.log("Previous songs:", room.roomPreviousSongs);
            let nextSong = await getRandomSong({ excludeList: room.roomPreviousSongs, genres: room.roomSongGenres });
            if (!nextSong) {
                broadcastToRoom(roomId, { event: "error", message: "Failed to get next song." });
                return;
            }
            room.roomCurrentSong = nextSong;
            room.roomPlayers = room.roomPlayers.map(p => {
                p.playerStatus = null;
                return p;
            });

        } else {
            setTimeout(() => {
                room.roomPlayers = room.roomPlayers.map(p => {
                    p.playerStatus = null;
                    return p;
                });

                // update time left
                room.roomTimeLeft = room.roomRound * 5 + 30;
                clearInterval(room.roomTimer);
                room.roomTimer = null;
                room.roomTimer = setInterval(() => {
                    room.roomTimeLeft--;
                    broadcastToRoom(roomId, { event: "update_timer", roomTimeLeft: room.roomTimeLeft });
                    if (room.roomTimeLeft <= 0) {
                        clearInterval(room.roomTimer);
                        endRound("timer");
                    }
                }, 1000);

                broadcastToRoom(roomId, { event: "round_start", roomRound: room.roomRound, roomTimeLeft: room.roomTimeLeft, songData: room.roomCurrentSong.songData });

            }, 500);
        }
    }

    ws.on("message", async (msg) => {
        // Event Handling
        let data
        try {
            data = JSON.parse(msg);
        } catch (e) {
            console.log("Error parsing ws message.")
            return sendMessage({ event: "error", message: "Invalid request body." });
        }
        if (!data.event) return sendMessage({ event: "error", message: "No event provided." });

        switch (data.event) {
            case "ping":
                sendMessage({ event: "pong", roomTimeLeft: room.roomTimeLeft });
                break;
            case "player_init":
                let playerName = data.playerName;
                if (!playerName) {
                    sendMessage({ event: "error", message: "No player name provided." });
                    ws.close();
                    break;
                }
                if (!checkUsername(playerName)) {
                    sendMessage({ event: "error", message: "Invalid player name." });
                    ws.close();
                    break;
                }
                let prevPlayerId = data.playerId;
                if (prevPlayerId) {

                    // Reconnect player
                    let recentPlayer = room.roomRecentPlayers.find(p => p.playerId === prevPlayerId)
                    if (recentPlayer && recentPlayer.playerName === playerName) {
                        playerId = prevPlayerId;
                        playerName = recentPlayer.playerName;
                        playerScore = recentPlayer.playerScore;
                        let calculatedStatus = recentPlayer.playerSongId === room.roomCurrentSong.songId ? recentPlayer.playerStatus : null;
                        room.roomPlayers.push({ playerId, playerName, playerWS: ws, playerStatus: null, playerStatus: calculatedStatus, playerScore: recentPlayer.playerScore });
                        room.roomRecentPlayers = room.roomRecentPlayers.filter(p => p.playerId !== playerId);
                        broadcastToRoom(roomId, { event: "player_joined", playerId, playerName, playerScore, playerStatus: recentPlayer.playerStatus }, playerId);
                        sendMessage({
                            event: "room_init",
                            playerId,
                            roomRound: room.roomRound,
                            roomTimeLeft: room.roomTimeLeft,
                            songData: room.roomCurrentSong.songData,
                            roomSongGenres: room.roomSongGenres,
                            roomPlayers: room.roomPlayers.map(
                                p => (
                                    {
                                        playerId: p.playerId,
                                        playerName: p.playerName,
                                        playerStatus: p.playerStatus,
                                        playerScore: p.playerScore
                                    }
                                )
                            )
                        });
                        console.log("Player reconnected to room:", roomId, "Player:", playerId, playerName);
                        break;
                    }
                }

                playerId = randomCode();
                room.roomPlayers.push({ playerId, playerName, playerWS: ws, playerStatus: null, playerScore: 0 });
                broadcastToRoom(roomId, { event: "player_joined", playerId, playerName }, playerId);
                // only send playerid and playername for each player

                sendMessage({
                    event: "room_init",
                    playerId,
                    roomRound: room.roomRound,
                    roomTimeLeft: room.roomTimeLeft,
                    songData: room.roomCurrentSong.songData,
                    roomSongGenres: room.roomSongGenres,
                    roomPlayers: room.roomPlayers.map(
                        p => (
                            {
                                playerId: p.playerId,
                                playerName: p.playerName,
                                playerStatus: p.playerStatus,
                                playerScore: p.playerScore,
                                playerIdle: p.playerIdle
                            }))
                });
                console.log("Player joined room:", roomId, "Player:", playerId, playerName);
                break;
            case "update_idle":
                let newIdle = data.playerIdle ?? false;
                broadcastToRoom(roomId, { event: "player_idle", playerId, playerIdle: newIdle });
                room.roomPlayers = room.roomPlayers.map(p => {
                    if (p.playerId === playerId) {
                        p.playerIdle = newIdle;
                    }
                    return p;
                });
                break;
            case "update_status":
                if (!room.roomTimer) {
                    room.roomTimer = setInterval(() => {
                        room.roomTimeLeft--;
                        broadcastToRoom(roomId, { event: "update_timer", roomTimeLeft: room.roomTimeLeft });
                        if (room.roomTimeLeft <= 0) {
                            clearInterval(room.roomTimer);
                            endRound("timer");
                        }
                    }, 1000);
                }

                if (room.roomPlayers.find(p => p.playerId === playerId).playerStatus != null) {
                    sendMessage({ event: "error", message: "Player has already guessed or skipped." });
                    break;
                }
                playerScore = room.roomPlayers.find(p => p.playerId === playerId).playerScore;
                if (data.status === "skip") {
                    broadcastToRoom(roomId, { event: "player_status", playerId, status: "skip", playerScore });
                    room.roomPlayers = room.roomPlayers.map(p => {
                        if (p.playerId === playerId) {
                            p.playerStatus = "skip";
                        }
                        return p;
                    });
                } else {
                    if (data.songName?.length < 2 || data.songArtist?.length < 2 || data.songName?.length > 100 || data.songArtist?.length > 100) {
                        broadcastToRoom(roomId, { event: "player_status", playerId, status: "incorrect", playerScore });
                        room.roomPlayers = room.roomPlayers.map(p => {
                            if (p.playerId === playerId) {
                                p.playerStatus = "incorrect";
                            }
                            return p;
                        });
                    } else {
                        const { nameCorrect, artistCorrect } = checkSongMatch(room.roomCurrentSong.songId, data.songName, data.songArtist);
                        let newStatus = nameCorrect && artistCorrect ? "correct" : nameCorrect || artistCorrect ? "close" : "incorrect";
                        broadcastToRoom(roomId, { event: "player_status", playerId, status: newStatus });
                        room.roomPlayers = room.roomPlayers.map(p => {
                            if (p.playerId === playerId) {
                                p.playerStatus = newStatus;
                            }
                            return p;
                        });
                    }
                }
                if (room.roomPlayers.every(p => p.playerStatus != null)) {
                    endRound();
                    // console.log("All players have guessed or skipped.");

                }
                break;
            case "player_ready":
                room.roomReadyVotes++;
                if (room.roomReadyVotes > room.roomPlayers.length / 2) {
                    room.roomReadyVotes = 0;
                    broadcastToRoom(roomId, { event: "game_start", roomTimeLeft: room.roomTimeLeft, songData: room.roomCurrentSong.songData });
                }
                broadcastToRoom(roomId, { event: "ready_votes", roomReadyVotes: room.roomReadyVotes });
                break
            case "update_genres":
                if (!data.songGenres || !Array.isArray(data.songGenres)) {
                    sendMessage({ event: "error", message: "Invalid genres." });
                    break;
                }
                if (data.songGenres.length > 4) {
                    sendMessage({ event: "error", message: "Too many genres." });
                    break;
                }
                if (data.songGenres.length < 1) {
                    sendMessage({ event: "error", message: "No genres." });
                    break;
                }
                if (data.songGenres.some(genre => !validGenres.includes(genre))) {
                    sendMessage({ event: "error", message: "Invalid genres." });
                    break;
                }

                room.roomSongGenres = data.songGenres;

                broadcastToRoom(roomId, { event: "update_genres", roomSongGenres: room.roomSongGenres });
                break;
            default:
                console.log("Unknown event:", data.event);
                sendMessage({ event: "error", message: "Unknown event." });
                break;
        };
    });

    ws.on("close", () => {

        let player = room.roomPlayers.find(p => p.playerId === playerId);
        if (!player) return;
        let { playerName, playerScore, playerStatus } = player;

        console.log("Player left room:", roomId, "Player:", playerId, playerName);

        room.roomRecentPlayers.push({ playerId, playerName, playerScore, playerStatus: playerStatus, playerSongId: room.roomCurrentSong.songId });
        room.roomPlayers = room.roomPlayers.filter(p => p.playerId !== playerId);

        broadcastToRoom(roomId, { event: "player_left", playerId });

        // recheck for all players have status
        if (room.roomPlayers.length && room.roomPlayers.every(p => p.playerStatus != null)) {
            endRound();
            // console.log("All players have guessed or skipped.");
        }

        if (room.roomReadyVotes > room.roomPlayers.length / 2) {
            room.roomReadyVotes = 0;
            broadcastToRoom(roomId, { event: "game_start", roomTimeLeft: room.roomTimeLeft, songData: room.roomCurrentSong.songData });
        } else {
            broadcastToRoom(roomId, { event: "ready_votes", roomReadyVotes: room.roomReadyVotes });
        }
    });
});



const SPOTIFY_CLIENT_ID = 'your_client_id';
const SPOTIFY_CLIENT_SECRET = 'your_client_secret';
let spotifyAccessToken = '';

// Function to get a new access token
async function getSpotifyAccessToken() {
    try {
        const response = await axios.post(
            'https://accounts.spotify.com/api/token',
            qs.stringify({
                grant_type: 'client_credentials',
                client_id: SPOTIFY_CLIENT_ID,
                client_secret: SPOTIFY_CLIENT_SECRET,
            }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            }
        );
        spotifyAccessToken = response.data.access_token;
    } catch (error) {
        console.error('Error getting Spotify access token:', error.response?.data || error.message);
        throw new Error('Failed to get Spotify access token');
    }
}

// Middleware to check and refresh token if needed
async function ensureSpotifyToken(req, res, next) {
    if (!spotifyAccessToken) {
        try {
            await getSpotifyAccessToken();
        } catch (err) {
            return res.status(500).json({ error: 'Failed to authenticate with Spotify' });
        }
    }
    next();
}

// Spotify search API route
app.get('/api/v1/spotify/search', ensureSpotifyToken, async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: 'Missing search query parameter' });
    }

    try {
        const response = await axios.get('https://api.spotify.com/v1/search', {
            headers: { Authorization: `Bearer ${spotifyAccessToken}` },
            params: { q: query, type: 'playlist', limit: 10 },
        });

        const playlists = response.data.playlists.items.map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
            image: playlist.images.length ? playlist.images[0].url : null,
            owner: playlist.owner.display_name,
            url: playlist.external_urls.spotify,
        }));

        res.json({ playlists });
    } catch (error) {
        console.error('Error fetching playlists from Spotify:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch playlists from Spotify' });
    }
});




// Start Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));