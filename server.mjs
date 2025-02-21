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
    res.header("Cache-Control", req.path.startsWith("/api") ? "no-store" : "public, max-age=86400");

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

async function getRandomSong(excludeList = []) {
    try {
        let songData = false;
        while (!songData || !songData.previewUrl) {
            const randomSong = songList[Math.floor(Math.random() * songList.length)];
            if (excludeList.includes(randomSong.songId)) continue;
            songData = await getAppleMusicData(randomSong.songName, randomSong.songArtist);
            console.log(`Chose: ${randomSong.songName} by ${randomSong.songArtist}`);
            if (songData && songData.previewUrl) {
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

    let artistCorrect = false;
    let realArtists = realSongInfo.songArtist.split(",");
    realArtists.forEach(realArtist => {
        if (normalizeTrackName(checkArtist).includes(normalizeTrackName(realArtist))) {
            artistCorrect = true;
        }
    });
    let dashedArtists = realSongInfo.songArtist.split("-");
    dashedArtists.forEach(realArtist => {
        if (normalizeTrackName(checkArtist).includes(normalizeTrackName(realArtist))) {
            artistCorrect = true;
        }
    });
    return { nameCorrect, artistCorrect };
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
// - Body: {playerName}
// - Add player to room
// - Broadcast player join

// WebSocket in events:
// - update_status: Listen for player guessing or skipping

// WebSocket out events:
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
        roomReadyVotes: 0
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
    currentRooms.push({ roomId, roomPlayers: [], roomRecentPlayers: [], roomCreatedAt: new Date(), roomCurrentSong: randomSong, roomPreviousSongs: [], roomRound: 0 });
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

    async function endRound() {
        // All players have guessed or skipped
        broadcastToRoom(roomId, { event: "round_end" });

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
            room.roomReadyVotes = 0;

            room.roomPreviousSongs.push(room.roomCurrentSong.songId);
            // console.log("Previous songs:", room.roomPreviousSongs);
            let nextSong = await getRandomSong(room.roomPreviousSongs);
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
                broadcastToRoom(roomId, { event: "round_start", roomRound: room.roomRound, songData: room.roomCurrentSong.songData });
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
                        room.roomPlayers.push({ playerId, playerName, playerWS: ws, playerStatus: null, playerScore: recentPlayer.playerScore });
                        room.roomRecentPlayers = room.roomRecentPlayers.filter(p => p.playerId !== playerId);
                        broadcastToRoom(roomId, { event: "player_joined", playerId, playerName, playerScore }, playerId);
                        sendMessage({ event: "room_init", playerId, roomRound: room.roomRound, songData: room.roomCurrentSong.songData, roomPlayers: room.roomPlayers.map(p => ({ playerId: p.playerId, playerName: p.playerName, playerStatus: p.playerStatus, playerScore: p.playerScore })) });
                        console.log("Player reconnected to room:", roomId, "Player:", playerName);
                        break;
                    }
                }

                playerId = randomCode();
                room.roomPlayers.push({ playerId, playerName, playerWS: ws, playerStatus: null, playerScore: 0 });
                broadcastToRoom(roomId, { event: "player_joined", playerId, playerName }, playerId);
                // only send playerid and playername for each player

                sendMessage({ event: "room_init", playerId, roomRound: room.roomRound, songData: room.roomCurrentSong.songData, roomPlayers: room.roomPlayers.map(p => ({ playerId: p.playerId, playerName: p.playerName, playerStatus: p.playerStatus, playerScore: p.playerScore })) });
                console.log("Player joined room:", roomId, "Player:", playerName);
                break;
            case "update_status":
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
                    broadcastToRoom(roomId, { event: "game_start", songData: room.roomCurrentSong.songData });
                }
                broadcastToRoom(roomId, { event: "ready_votes", roomReadyVotes: room.roomReadyVotes });
                break
            default:
                console.log("Unknown event:", data.event);
                sendMessage({ event: "error", message: "Unknown event." });
                break;
        };
    });

    ws.on("close", () => {
        console.log("Connection closed.", playerId);

        let player = room.roomPlayers.find(p => p.playerId === playerId);
        if (!player) return;
        let { playerName, playerScore } = player;
        room.roomRecentPlayers.push({ playerId, playerName, playerScore });
        room.roomPlayers = room.roomPlayers.filter(p => p.playerId !== playerId);

        broadcastToRoom(roomId, { event: "player_left", playerId });

        // recheck for all players have status
        if (room.roomPlayers.every(p => p.playerStatus != null)) {
            endRound();
            // console.log("All players have guessed or skipped.");
        }

        if (room.roomReadyVotes > room.roomPlayers.length / 2) {
            room.roomReadyVotes = 0;
            broadcastToRoom(roomId, { event: "game_start", songData: room.roomCurrentSong.songData });
        } else {
            broadcastToRoom(roomId, { event: "ready_votes", roomReadyVotes: room.roomReadyVotes });
        }
    });


});


// Start Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));