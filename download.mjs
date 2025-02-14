import fetch from 'node-fetch';
import fs from 'fs';
import { JSDOM } from "jsdom"

async function getPopularSongs() {
    const url = 'https://en.wikipedia.org/wiki/Rolling_Stone%27s_500_Greatest_Songs_of_All_Time';
    let allSongs = [];

    try {
        const response = await fetch(url);
        const text = await response.text();
        allSongs = extractSongsFromHTML(text);
    } catch (error) {
        console.error(`Failed to fetch from ${url}:`, error);
    }

    saveToFile(allSongs);
    return allSongs;
}

function extractSongsFromHTML(html) {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const rows = document.querySelectorAll("table.wikitable tbody tr");
    let songs = [];

    rows.forEach(row => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 3) {
            const artist = cells[1].textContent.trim();
            const title = cells[2].textContent.trim().replace(/"/g, '');
            songs.push({ artist, title });
        }
    });
    return songs;
}
function saveToFile(songs) {
    fs.writeFileSync('popular_songs.json', JSON.stringify(songs, null, 2));
    console.log('Saved song list to popular_songs.json');
}

// Run the function to get the list
getPopularSongs().then(songs => console.log(`Fetched ${songs.length} songs.`));
