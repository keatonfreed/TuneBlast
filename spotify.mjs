import fs from 'fs';
import env from 'dotenv';

env.config();




const spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const spotifyPlaylists = [
    "5CcCaUYWYgrYebCC50SnEF", // SONGS WE ALL KNOW https://open.spotify.com/playlist/5CcCaUYWYgrYebCC50SnEF 
    "5ABHKGoOzxkaa28ttQV9sE", // Top 100 most streamed songs on Spotify https://open.spotify.com/playlist/5ABHKGoOzxkaa28ttQV9sE
    '6HxB2RkMDwlgCofTaByutM', // Most well known songs ever (562) https://open.spotify.com/playlist/6HxB2RkMDwlgCofTaByutM
    "1koyIdOfW4lxtr46r7Dwa8", // Top 100 most recognizable songs of all time https://open.spotify.com/playlist/1koyIdOfW4lxtr46r7Dwa8
    "1hfdy1hTBCWb36GMdB76Kc", // TuneBlast custom playlist https://open.spotify.com/playlist/1hfdy1hTBCWb36GMdB76Kc
    "4IyPv52FkSxwz1i4t9BSmI",  // Bad Romance https://open.spotify.com/playlist/4IyPv52FkSxwz1i4t9BSmI
    "7GjUYpEYbpQ6lMiGxLVCJQ", // Rap hits of all time https://open.spotify.com/playlist/7GjUYpEYbpQ6lMiGxLVCJQ
    "18EmXIwVHNGJPLuTvPKeBG", // Today's Rap Hits 2025 https://open.spotify.com/playlist/18EmXIwVHNGJPLuTvPKeBG
    "2rdwGXB4JeeS2DM7PO8pqL", // Old songs everyone knows https://open.spotify.com/playlist/2rdwGXB4JeeS2DM7PO8pqL
];

// "Classics": "Timeless classics: The really old, legendary songs. Think Frank Sinatra, Elvis, The Beatles, Nat King Cole. Songs that older people love but are still known. (Example: 'Fly Me to the Moon,' 'Jailhouse Rock,' 'Bohemian Rhapsody').",
// "Throwbacks": "Throwback hits: The ‘80s, ‘90s, early 2000s hits that EVERYONE knows. Not ancient, but not new. (Example: Michael Jackson, Britney Spears, Backstreet Boys, early Eminem, Outkast, Red Hot Chili Peppers).",
// "Pop": "Modern hits: Everything big from ~2010 onward that isn’t rap. Pop, mainstream rock, EDM, radio/chart-topping music. (Example: Taylor Swift, Dua Lipa, Ed Sheeran, The Weeknd).",
// "HipHop": "Rap/Hip Hop: All rap-focused music, old and new. No mix-ups with pop. (Example: Kanye, Drake, Kendrick Lamar, Jay-Z, Lil Wayne)."

const playlistCategoryMap = {
    "5CcCaUYWYgrYebCC50SnEF": "Pop",
    "5ABHKGoOzxkaa28ttQV9sE": "Pop",
    "6HxB2RkMDwlgCofTaByutM": "Throwbacks",
    "1koyIdOfW4lxtr46r7Dwa8": "Classics",
    "1hfdy1hTBCWb36GMdB76Kc": "Pop",
    "4IyPv52FkSxwz1i4t9BSmI": "Pop",
    "7GjUYpEYbpQ6lMiGxLVCJQ": "HipHop",
    "18EmXIwVHNGJPLuTvPKeBG": "HipHop",
    "2rdwGXB4JeeS2DM7PO8pqL": "Classics",
};
const songBlocklist = ["5e9TFTbltYBg2xThimr0rU"]



async function getAccessToken() {
    const authString = `${spotifyClientId}:${spotifyClientSecret}`;
    const authBase64 = Buffer.from(authString).toString('base64');

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authBase64}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    const data = await response.json();
    return data.access_token;
}

async function getPlaylistTracks(accessToken, playlistId) {
    let tracks = [];
    let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

    while (nextUrl) {
        const response = await fetch(nextUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const data = await response.json();
        tracks.push(...data.items.map((item, index) => {
            // if (index === 0) console.log(item.track);
            return {
                songName: normalizeTrackName(item.track.name, true),
                songArtist: item.track.artists.map(artist => artist.name).join(', '),
                songId: item.track.id,
                songCategory: playlistCategoryMap[playlistId]
            }
        }));

        nextUrl = data.next; // Handle pagination
    }
    console.log(tracks.length.toString() + ' Tracks fetched from Spotify');

    return tracks;
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


async function main() {
    // for (let i = 0; i < spotifyPlaylists.length; i++) {
    //     let playlist = spotifyPlaylists[i];
    //     console.log(`Playlist ${i + 1}/${spotifyPlaylists.length}: https://open.spotify.com/playlist/${playlist}`);
    // }

    try {
        const token = await getAccessToken();
        if (!token) {
            throw new Error('Failed to get access token');
        }
        let tracks = []

        for (const playlist of spotifyPlaylists) {
            let playlistResults = await getPlaylistTracks(token, playlist);
            playlistResults = playlistResults.filter(track => {
                return tracks.every(t => normalizeTrackName(t.songName) !== normalizeTrackName(track.songName));
            });
            tracks.push(...playlistResults);
        }

        tracks = tracks.filter(track => !songBlocklist.includes(track.songId));

        // Save as JSON
        fs.writeFileSync('spotify_tracks.json', JSON.stringify(tracks, null, 2));

        console.log(tracks.length.toString() + ' Tracks saved as JSON');
    } catch (error) {
        console.error('Error:', error.message);
    }
}

main();
