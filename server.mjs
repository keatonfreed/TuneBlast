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
async function getAppleMusicPreview(songName, artistName) {
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
        return data.results[0].previewUrl;
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
            song = await getAppleMusicPreview(randomSong.name, randomSong.artist);
        }
        return song;
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
app.get("/randomsong", async (req, res) => {
    let song = await getRandomSong();
    song ? res.send({ previewUrl: song }) : res.status(500).send("Failed to get random song");
});

// Start Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));