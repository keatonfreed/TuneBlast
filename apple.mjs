import fetch from "node-fetch"
import fs from "fs"
import { exec } from "child_process"

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
        const previewUrl = data.results[0].previewUrl;
        console.log("Downloading preview:", previewUrl);
        await downloadAndPlay(previewUrl);
    } else {
        console.log("No preview available.");
    }
}

async function downloadAndPlay(url) {
    const res = await fetch(url);
    const fileStream = fs.createWriteStream("preview.m4a");

    await new Promise((resolve, reject) => {
        res.body.pipe(fileStream);
        res.body.on("error", reject);
        fileStream.on("finish", resolve);
    });

    console.log("Download complete. Playing...");
    playAudio("preview.m4a");
}

function playAudio(file) {
    const command = process.platform === "win32" ? `start ${file}`  // Windows
        : process.platform === "darwin" ? `afplay ${file}` // macOS
            : `mpg123 ${file}`;  // Linux (requires mpg123)

    exec(command, (err) => {
        if (err) console.error("Error playing audio:", err);
    });
}

// Example: Fetch, download, and play "Blinding Lights"
getAppleMusicPreview("My Way", "Frank Sinatra Original");
