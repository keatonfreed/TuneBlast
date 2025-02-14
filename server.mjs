import fetch from "node-fetch";
import fs from "fs";
import { exec } from "child_process";
import express from "express";
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
        const songData = JSON.parse(fs.readFileSync('song_choices.json', 'utf8'));
        let song = false;
        while (!song) {
            const randomSong = songData[Math.floor(Math.random() * songData.length)];
            console.log(`Chose: ${randomSong.name} by ${randomSong.artist}`);
            song = await getAppleMusicData(randomSong.name, randomSong.artist);
            if (song) {
                return {
                    songId: randomSong.id,
                    data: song
                };
            }
        }
    } catch (err) {
        console.error('Error reading song_choices.json:', err);
        return false;
    }
}

function playAudio(file) {
    const command = process.platform === "win32" ? `start ${file}`
        : process.platform === "darwin" ? `afplay ${file}`
            : `mpg123 ${file}`;

    exec(command, (err) => {
        if (err) console.error("Error playing audio:", err);
    });
}

// Routes
app.get("/api/v1/randomsong", async (req, res) => {
    let { songId, data } = await getRandomSong();
    data ? res.send({ previewUrl: data.previewUrl, songId: songId }) : res.status(500).send("Failed to get random song");
});

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

app.get("/api/v1/guess", async (req, res) => {
    // get song url param
    const { song, artist, id } = req.query;
    if (!song) return res.status(400).send("No song provided");
    if (!id) return res.status(400).send("No id provided");
    const songData = JSON.parse(fs.readFileSync('song_choices.json', 'utf8'));
    const songInfo = songData.find(s => s.id === id);
    if (!songInfo) return res.status(404).send("Song not found");
    const trackCorrect = normalizeTrackName(songInfo.name) === normalizeTrackName(song);
    const artistCorrect = normalizeTrackName(songInfo.artist) === normalizeTrackName(artist);
    const correct = trackCorrect && artistCorrect;
    res.send({ correct });
});

// Start Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));