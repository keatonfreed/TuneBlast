// DOM Elements
const playBtn = document.getElementById("playBtn");
const guessBtn = document.getElementById("guessBtn");
const lines = document.querySelectorAll(".line");
const searchInput = document.getElementById("searchInput");
const searchPopup = document.getElementById("searchPopup");

const playerListEl = document.getElementById("playerList");

const loadingPopup = document.getElementById("loadingPopup");
loadingPopup.showModal();


const roomCode = window.location.search.slice(1);
console.log("Room code:", roomCode);

// State Variables
let globalAudio, songId;
let playing = false;
let restartOnNext = false;
let lastGuessLine;
let guessIndex = 0;
const maxTimes = [100, 1000, 2000, 3500, 9000, 35000];
let lastInputUpdate;
const suggestionLimit = 5;

let playerList = [];

// Prevent media key controls
if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => { playBtn.click(); });
    navigator.mediaSession.setActionHandler("pause", () => { playBtn.click(); });
}

// Fetch Utility
async function backendFetch(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Network response was not ok");
        return await res.json();
    } catch (err) {
        console.error("Fetch error:", err);
        return {};
    }
}

// WebSocket Utility
async function backendWebsocket(url, body) {
    try {
        const ws = new WebSocket(url);

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
        };

        ws.onclose = (event) => {
            if (!event.wasClean) {
                console.warn('WebSocket connection lost. Code:', event.code);
            }
        };

        await new Promise((resolve, reject) => {
            ws.onopen = () => resolve();
            setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
        });

        return ws;
    } catch (err) {
        console.error('WebSocket connection failed:', err);
        return null;
    }
}

function getSavedUsername() {
    return localStorage.getItem("TuneBlast-Username")
}

let roomSocket;
let playerId;

async function tryJoinRoom() {
    if (!roomCode) {
        console.error("No Room Code")
        return;
    }

    if (!getSavedUsername()) {
        console.error("No Saved Username")
        return;
    }
    roomSocket = await backendWebsocket(`/api/v1/room/${roomCode}`);
    if (!roomSocket) {
        console.error("Failed to join room");
        return;
    }

    roomSocket.send(JSON.stringify({ event: "player_init", playerName: getSavedUsername() }));
    roomSocket.onmessage = (event) => {
        let message
        try {
            message = JSON.parse(event.data);
        } catch (error) {
            console.error("Failed to parse message:", error);
            return;
        }
        console.log("Message:", message);
        switch (message.event) {
            case "room_init":
                playerId = message.playerId;

                playerList = message.roomPlayers;
                updatePlayerList();

                songId = message.songId;

                globalAudio = new Audio(message.songData.previewUrl);
                globalAudio.onloadeddata = setMarkers;
                globalAudio.onended = () => stopPlaying(true);
                updateControls();
                requestAnimationFrame(updateControls);

                setTimeout(() => loadingPopup.close(), 1000);
                break;
            case "player_joined":
                console.log("Player joined:", message.playerName);
                playerList.push({ playerId: message.playerId, playerName: message.playerName });
                updatePlayerList();
                break;
            case "player_left":
                console.log("Player left:", message.playerName);
                playerList = playerList.filter(p => p.playerId !== message.playerId);
                updatePlayerList();
                break;

            case "player_status":
                console.log("Player status:", message.playerId, message.status);
                if (playerId && message.playerId === playerId) {
                    if (message.status === "correct") {
                        if (lastGuessLine) {
                            lastGuessLine.classList.add("correct");
                        }
                    } else if (message.status === "incorrect") {
                        if (lastGuessLine) {
                            lastGuessLine.classList.add("incorrect");
                        }
                    }
                }
                break;

            case "error":
                document.getElementById("roomError").showModal();
                document.getElementById("roomErrorText").textContent = message.message;
                break;

        }
    }

    roomSocket.onclose = (event) => {
        console.warn("Room Socket Closed.");
        if (!event.wasClean) {
            document.getElementById("roomError").showModal();
            document.getElementById("roomErrorText").textContent = "Connection Lost.";
        }
    }

}

tryJoinRoom();

function updatePlayerList() {
    playerListEl.innerHTML = ""
    playerList.forEach(player => {
        let playerAvatar = document.createElement("div");
        playerAvatar.className = "playerAvatar";
        let avatarImg = document.createElement("img");
        avatarImg.src = `https://api.dicebear.com/9.x/rings/svg?seed=${player.playerName}`;
        avatarImg.alt = "Avatar";
        let playerName = document.createElement("p");
        playerName.textContent = player.playerName;
        playerAvatar.appendChild(avatarImg);
        playerAvatar.appendChild(playerName);
        playerListEl.appendChild(playerAvatar);
    });
    if (playerList.length === 0) {
        playerListEl.innerHTML = "<p>No players in room.</p>"
    }
}

// Progress Bar & Markers
function updateControls() {
    if (!globalAudio) return;
    const maxListenTime = maxTimes[Math.min(guessIndex, maxTimes.length - 1)];
    if (playing && globalAudio.currentTime >= maxListenTime / 1000) {
        stopPlaying(true);
        globalAudio.currentTime = maxListenTime / 1000;
    }
    document.querySelector(".progress .bar").style.width = `${(globalAudio.currentTime / globalAudio.duration) * 100}%`;

    if (searchInput.value.trim().length !== 0) {
        guessBtn.classList.remove("guessSkip");
        guessBtn.textContent = "Guess";
    } else {
        guessBtn.classList.add("guessSkip");
        guessBtn.textContent = "Skip";
    }
    requestAnimationFrame(updateControls);
}

function setMarkers() {
    document.querySelector(".progress .markers").innerHTML = maxTimes
        .map(time => `<div class="marker" style="left: ${(time / (globalAudio.duration * 1000)) * 100}%"></div>`)
        .join("");
}

// Play / Pause Controls
function stopPlaying(endClip = false) {
    playing = false;
    playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    globalAudio?.pause();
    if (endClip) {
        restartOnNext = true;
    }
}

playBtn.onclick = () => {
    if (!globalAudio) return;
    if (playing) {
        stopPlaying();
    } else {
        playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>`;
        const maxListenTime = maxTimes[Math.min(guessIndex, maxTimes.length - 1)];
        if (restartOnNext || globalAudio.currentTime >= (maxListenTime / 1000) - 30) {
            globalAudio.currentTime = 0;
            restartOnNext = false;
        }
        playing = true;
        globalAudio.play();
    }
};

// Song Search
async function searchSongs(query) {
    const apiKey = "78ef4f49d601a8f36462eb98f885b78a"; // Replace with your Last.fm API key
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(query)}&limit=${suggestionLimit}&api_key=${apiKey}&format=json`;

    try {
        const raw = await fetch(url);
        const parsed = await raw.json();
        return parsed.results?.trackmatches?.track?.map((t, i) => `${i + 1}. ${t.name} - ${t.artist}`).join("\n") || "";
    } catch (error) {
        console.error("Search error:", error);
        return "";
    }
}

// Search Popup
async function updateSearchPopup() {
    const query = searchInput.value.trim();
    if (!query) return searchPopup.classList.add("hidden");

    const songList = await searchSongs(query);
    if (songList) {
        searchPopup.innerHTML = ""
        songList.split("\n").forEach(line => {
            let result = document.createElement("button");
            result.className = "result";
            result.textContent = line.replace(/^[0-9]+\. /, "").slice(0, 100);
            result.onclick = () => {
                searchInput.value = result.textContent;
                searchPopup.classList.add("hidden");
            };
            searchPopup.appendChild(result);
        })
        searchPopup.classList.remove("hidden");
    }
}


searchInput.onkeyup = (e) => {
    clearTimeout(lastInputUpdate);
    if (e.key === "Escape") {
        searchPopup.classList.add("hidden");
        return
    }
    lastInputUpdate = setTimeout(updateSearchPopup, 100);


};


// // Init Session
// let sessionID;
// (async () => {
//     const response = await backendFetch("/api/v1/session/");
//     console.log("Session response:", response);
//     sessionID = response.sessionID;
// })();


function checkGameOver() {
    if (guessIndex >= maxTimes.length) {
        globalAudio.currentTime = 0;
        globalAudio.play();
    }
}

// Guess Button
guessBtn.onclick = async () => {
    if (searchInput.value.trim().length === 0) {

        if (!roomSocket) return;
        roomSocket.send(JSON.stringify({ event: "update_status", status: "skip" }));

        if (lines[guessIndex]) {
            lines[guessIndex].textContent = "Skipped";
            lines[guessIndex].classList.add("skip");
        }
        guessIndex++;
        checkGameOver();
        restartOnNext = false;

        // globalAudio?.play();

        searchInput.value = "";
        searchInput.focus();
        return;
    }

    // const response = await backendFetch(`/api/v1/solo/guess/?songName=${encodeURIComponent(searchInput.value)}&songArtist=${searchInput.value.split("-")[searchInput.value.split("-").length - 1].trim()}&songId=${songId}`);
    if (!roomSocket) return;
    roomSocket.send(JSON.stringify({ event: "update_status", songName: searchInput.value.trim().split("-")[0], songArtist: searchInput.value.split("-")[searchInput.value.split("-").length - 1].trim() }));
    if (lines[guessIndex]) {
        lines[guessIndex].textContent = searchInput.value;
    }
    lastGuessLine = lines[guessIndex];

    guessIndex++;
    // checkGameOver();
    restartOnNext = false;
    // globalAudio?.play();

    searchInput.value = "";
    searchInput.focus();

};
