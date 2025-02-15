import fetch from "node-fetch";
import fs, { stat } from "fs";
import express from "express";
import expressWs from "express-ws";
import env from "dotenv";
env.config();

// App Setup
const app = express();
const PORT = process.env.PORT || 3050;

// Middleware
app.use(express.static("public"));
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    next();
});
expressWs(app);

// Utility Functions
async function getAppleMusicData(songName, artistName) {
    const baseURL = "https://itunes.apple.com/search";
    const query = new URLSearchParams({
        term: `${songName} ${artistName || ""}`,
        media: "music",
        limit: 1
    });

    const response = await fetch(`${baseURL}?${query}`);
    const data = await response.json();

    if (data.results.length > 0 && data.results[0].previewUrl) {
        // console.log("Got preview:", data.results[0].previewUrl);
        return data.results[0];
    }
    console.log("No preview available.");
    return false;
}

async function getRandomSong() {
    try {
        let songData = false;
        while (!songData) {
            const randomSong = songList[Math.floor(Math.random() * songList.length)];
            songData = await getAppleMusicData(randomSong.songName, randomSong.songArtist);
            console.log(`Chose: ${randomSong.songName} by ${randomSong.songArtist}`);
            if (songData) {
                return {
                    songId: randomSong.songId,
                    songData: { previewUrl: songData.previewUrl }
                };
            }
        }
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

    let realArtists = realSongInfo.songArtist.split(",");
    let artistCorrect = false;
    realArtists.forEach(realArtist => {
        if (normalizeTrackName(checkArtist).includes(normalizeTrackName(realArtist))) {
            artistCorrect = true;
        }
    });
    return nameCorrect && artistCorrect;
}

const songList = JSON.parse(fs.readFileSync('song_choices.json', 'utf8'));

// --------------- Solo Game Routes ---------------
app.get("/api/v1/solo/randomsong", async (req, res) => {
    let { songId, songData } = await getRandomSong();
    if (songData && songId) {
        res.send({ songData, songId });
    } else {
        res.status(500).send("Failed to get random song");
    }
});

app.get("/api/v1/solo/guess", async (req, res) => {
    // get song url param
    const { songName, songArtist, songId } = req.query;
    if (!songName) return res.status(400).send("No song provsongIded");
    if (!songId) return res.status(400).send("No id provided");

    const correct = checkSongMatch(songId, songName, songArtist);
    res.send({ correct });
});


// --------------- "Room" Game Routes ---------------

// HTTP Endpoints:
// POST /api/v1/room/create
//   - Body: {roomId}
//   - Creates new room
//   - Returns room code

// WebSocket Endpoint: /api/v1/room/:roomId

// On connection:
// - Body: {playerName}
// - Add player to room
// - Broadcast player join

// WebSocket in events:
// - update_status: Listen for player guessing or skipping

// WebSocket out events:
// - player_joined: Broadcast when player joins
// - player_left: Broadcast when player leaves
// - game_start: Broadcast game start with first song
// - player_status: Broadcast when player makes guess or skip
// - round_end: Broadcast round results
// - game_end: Broadcast final scores



let currentRooms = [
    {
        roomId: "AD3EF",
        roomPlayers: [
            {
                playerId: "A1B2C",
                playerName: "Bobby",
                playerWS: null,
            },
        ],
        roomCreatedAt: '2025-02-15T02:33:20.102Z',
        roomCurrentSong: {
            songId: "6AI3ezQ4o3HUoP6Dhudph3",
            songData: {
                previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview122/v4/c2/80/0c/c2800c2a-0b68-43c9-3701-7cb1ece6ef24/mzaf_9589312089850013533.plus.aac.p.m4a"
            }
        },
    }
]

app.get("/api/v1/room/create", async (req, res) => {
    const roomId = randomCode();
    const randomSong = await getRandomSong().catch(err => {
        console.error(err);
        return res.status(500).send("Failed To Create Room.");
    });
    currentRooms.push({ roomId, roomPlayers: [], roomCreatedAt: new Date(), roomCurrentSong: randomSong });
    res.send({ roomId });
});


function broadcastToRoom(roomId, message, excludePlayerId = null) {
    console.log("Broadcasting to room...", roomId, message);
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

    console.log("Connection started...");

    let playerId;

    ws.on("message", (msg) => {
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
                playerId = randomCode();
                room.roomPlayers.push({ playerId, playerName, playerWS: ws });
                broadcastToRoom(roomId, { event: "player_joined", playerId, playerName }, playerId);
                // only send playerid and playername for each player
                sendMessage({ event: "room_init", playerId, songData: room.roomCurrentSong.songData, roomPlayers: room.roomPlayers.filter(p => (p.playerId !== playerId)).map(p => ({ playerId: p.playerId, playerName: p.playerName })) });
                console.log("Player joined:", playerName);
                break;
            case "update_status":
                if (data.status === "skip") {
                    broadcastToRoom(roomId, { event: "player_status", playerId, status: "skip" });
                    break;
                } else {
                    if (data.songName?.length < 2 || data.songArtist?.length < 2 || data.songName?.length > 100 || data.songArtist?.length > 100) {
                        broadcastToRoom(roomId, { event: "player_status", playerId, status: "incorrect" });
                        break;
                    }
                    const correct = checkSongMatch(room.roomCurrentSong.songId, data.songName, data.songArtist);
                    broadcastToRoom(roomId, { event: "player_status", playerId, status: correct ? "correct" : "incorrect" });
                }
                break;

            default:
                console.log("Unknown event:", data.event);
                sendMessage({ event: "error", message: "Unknown event." });
                break;
        };
    });

    ws.on("close", () => {
        console.log("Connection closed.");
        if (!playerId) return;
        room.roomPlayers = room.roomPlayers.filter(p => p.playerId !== playerId);
        broadcastToRoom(roomId, { event: "player_left", playerId });

    });


});

// app.get("/api/v1/room/:roomId/:playerId", async (req, res) => {
//     const { roomId, playerId } = req.params;
//     if (!roomId) return res.status(400).send("No room ID provided");
//     if (!playerId) return res.status(400).send("No player ID provided");

//     const room = currentRooms.find(r => r.roomId === roomId);
//     if (!room) return res.status(404).send("Room not found");

//     let player = room.players.find(p => p.playerId === playerId);
//     if (!player) return res.status(404).send("Player not found in this room.");

//     res.send(room);
// });



// Start Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));