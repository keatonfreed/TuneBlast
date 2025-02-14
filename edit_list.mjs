import express from "express";
import fs from "fs";

const app = express();
const PORT = 3000;
const FILE = "song_choices.json";

app.use(express.static("editor"));
app.use(express.json());

// Get song list
app.get("/songs", (req, res) => {
    fs.readFile(FILE, "utf8", (err, data) => {
        if (err) return res.status(500).json({ error: "Failed to load songs" });
        res.json(JSON.parse(data));
    });
});

// Delete a song
app.post("/delete", (req, res) => {
    const { name, artist } = req.body;
    fs.readFile(FILE, "utf8", (err, data) => {
        if (err) return res.status(500).json({ error: "Failed to read file" });

        let songs = JSON.parse(data);
        songs = songs.filter((song) => song.name !== name || song.artist !== artist);

        fs.writeFile(FILE, JSON.stringify(songs, null, 2), "utf8", (err) => {
            if (err) return res.status(500).json({ error: "Failed to save file" });
            res.json({ success: true });
        });
    });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
