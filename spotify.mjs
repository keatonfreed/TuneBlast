import fs from 'fs';
import env from 'dotenv';
env.config();

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const playlists = ['6HxB2RkMDwlgCofTaByutM', "1koyIdOfW4lxtr46r7Dwa8", "1hfdy1hTBCWb36GMdB76Kc"];

async function getAccessToken() {
    const authString = `${clientId}:${clientSecret}`;
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
        tracks.push(...data.items.map(item => ({
            name: normalizeTrackName(item.track.name, true),
            artist: item.track.artists.map(artist => artist.name).join(', '),
            id: item.track.id
        })));

        nextUrl = data.next; // Handle pagination
    }

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
    try {
        const token = await getAccessToken();
        if (!token) {
            throw new Error('Failed to get access token');
        }
        let tracks = []

        for (const playlist of playlists) {
            let playlistResults = await getPlaylistTracks(token, playlist);
            playlistResults = playlistResults.filter(track => {
                return tracks.every(t => normalizeTrackName(t.name) !== normalizeTrackName(track.name));
            });
            tracks.push(...playlistResults);
        }

        // Save as JSON
        fs.writeFileSync('spotify_tracks.json', JSON.stringify(tracks, null, 2));

        console.log('Tracks saved as JSON');
    } catch (error) {
        console.error('Error:', error.message);
    }
}

main();
