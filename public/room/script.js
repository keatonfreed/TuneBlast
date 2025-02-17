// DOM Elements
const playBtn = document.getElementById("playBtn");
const guessBtn = document.getElementById("guessBtn");
const lines = document.querySelectorAll(".line");
const searchInput = document.getElementById("searchInput");
const searchPopup = document.getElementById("searchPopup");

const playerListEl = document.getElementById("playerList");
const inviteFriends = document.getElementById("inviteFriends");

const loadingPopup = document.getElementById("loadingPopup");
loadingPopup.showModal();

const usernamePopup = document.getElementById("usernamePopup");
const usernamePopupError = usernamePopup?.querySelector("#usernameError");

const roundDisplay = document.getElementById("roundDisplay");

const overlayVidoes = document.getElementById("overlayVideos");

const gameOverPopup = document.getElementById("gameOverPopup");


const roomCode = window.location.search.slice(1);
console.log("Room code:", roomCode);


// State Variables
let globalAudio;
let playing = false;
let restartOnNext = false;
let lastGuessLine;
let guessIndex = 0;
const maxTimes = [100, 1000, 2000, 3500, 9000, 30000];
let lastInputUpdate;
const suggestionLimit = 5;

let playerList = [];

let controlsDisabled = false;

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

function setSavedUsername(username) {
    localStorage.setItem("TuneBlast-Username", username)
}

function getSavedUsername() {
    return localStorage.getItem("TuneBlast-Username")
}

let roomSocket;
let playerId;

function playGlobalAudio() {
    if (!globalAudio) return;
    if (document.visibilityState === 'visible') {
        globalAudio.play();
    } else {
        window.addEventListener("focus", () => {
            globalAudio.play();
        }, { once: true });
    }
}

window.addEventListener("blur", () => {
    if (playing && globalAudio && !gameOverPopup.open) {
        stopPlaying();
    }
});

async function tryJoinRoom() {
    if (!roomCode) {
        document.getElementById("roomError").showModal();
        document.getElementById("roomErrorText").textContent = "Invalid Join Code.";
        console.error("No Room Code")
        return;
    }

    if (!getSavedUsername()) {
        usernamePopup.showModal();
        console.error("No Saved Username")
        return;
    }
    roomSocket = await backendWebsocket(`/api/v1/room/${roomCode}`);
    if (!roomSocket) {
        document.getElementById("roomError").showModal();
        document.getElementById("roomErrorText").textContent = "Could not connect to room.";
        console.error("Failed to join room");
        return;
    }

    let lastCorrect = false;

    roomSocket.send(JSON.stringify({ event: "player_init", playerName: getSavedUsername() }));
    roomSocket.onmessage = async (event) => {
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
                guessIndex = message.roomRound;
                roundDisplay.textContent = `Round ${guessIndex + 1}`;

                playerId = message.playerId;

                playerList = message.roomPlayers;
                updatePlayerList();

                inviteFriends.onclick = () => {
                    // copy join link to clipboard, then query seltor for .tooltip inside it and show for 3 seconds
                    navigator.clipboard.writeText(window.location.href).then(() => {
                        let tooltip = inviteFriends.querySelector(".tooltip");
                        tooltip.style.display = "block";
                        setTimeout(() => {
                            tooltip.style.display = "none";
                        }, 1500);
                    });
                }

                globalAudio = new Audio(message.songData.previewUrl);
                globalAudio.onloadeddata = setMarkers;
                globalAudio.onended = () => stopPlaying(true);

                updateControls();
                requestAnimationFrame(updateControls);

                setTimeout(() => loadingPopup.close(), 1000);
                break;
            case "player_joined":
                console.log("Player joined:", message.playerName);
                playerList.push({ playerId: message.playerId, playerName: message.playerName, playerScore: 0 });
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
                        lastCorrect = true;
                        let correctSound = new Audio("../correct.mp3");
                        correctSound.play();

                    } else if (message.status === "incorrect") {
                        if (lastGuessLine) {
                            lastGuessLine.classList.add("incorrect");
                        }
                        lastCorrect = false;
                        let incorrectSound = new Audio("../incorrect.mp3");
                        incorrectSound.play();
                    } else if (message.status === "skip") {
                        lastCorrect = false;
                    }
                }
                playerList = playerList.map(p => {
                    if (p.playerId === message.playerId) {
                        return { ...p, playerStatus: message.status || p.playerStatus, playerScore: message.playerScore ?? p.playerScore };
                    }
                    return p;
                });
                updatePlayerList();
                break;

            case "round_start":
                console.log("Round Start.");

                lastCorrect = false;

                playerList = playerList.map(p => {
                    return { ...p, playerStatus: null };
                });
                updatePlayerList();

                guessIndex = message.roomRound;
                roundDisplay.textContent = `Round ${guessIndex + 1}`;
                controlsDisabled = false;

                globalAudio.currentTime = 0;
                playGlobalAudio();
                playing = true;
                updatePlayBtn();
                break;

            case "game_end":

                overlayVidoes.style.opacity = 0.4;

                globalAudio.currentTime = 0;
                globalAudio.play();
                globalAudio.volume = 0;
                let fadeIn = setInterval(() => {
                    if (globalAudio.volume < 1) {
                        globalAudio.volume = Math.min(globalAudio.volume + 0.03, 1);
                    } else {
                        clearInterval(fadeIn);
                    }
                }, 20);

                controlsDisabled = true;

                gameOverPopup.querySelector("#gameOverMessage").textContent = lastCorrect ? "Correct!" : "Game Over!";
                let correctPlayersList = message.correctPlayers?.filter(p => (p.playerId !== playerId)).map(p => p.playerName);
                let subtitle = "No one guessed the song.";
                if (lastCorrect || correctPlayersList.length) {
                    subtitle = (lastCorrect ? "You" : "") + (lastCorrect && correctPlayersList.length ? ", " : "") + correctPlayersList.join(", ");
                    subtitle += ` guessed in ${guessIndex + 1} attempts.`;
                }
                gameOverPopup.querySelector("#gameOverSubtitle").textContent = subtitle;
                lastCorrect = false;

                let findSongBtn = gameOverPopup.querySelector("#gameOverFind");
                let playAgainBtn = gameOverPopup.querySelector("#gameOverNext");
                let playAgainCount = gameOverPopup.querySelector("#gameOverNextCount");

                gameOverPopup.showModal();
                let songInfo = message.songInfo;
                if (songInfo) {
                    gameOverPopup.querySelector("#gameOverSong").textContent = songInfo.songName + " by " + songInfo.songArtist;

                    findSongBtn.onclick = async () => {
                        let youtubeMusicSearchLink = `https://music.youtube.com/search?q=${encodeURIComponent(songInfo.songName + " by " + songInfo.songArtist)}`;
                        window.open(youtubeMusicSearchLink, "_blank");
                    }
                }

                globalAudio.onended = async () => {
                    globalAudio.currentTime = 0;
                    globalAudio.play();
                    globalAudio.volume = 0;
                    let fadeIn = setInterval(() => {
                        if (globalAudio.volume < 1) {
                            globalAudio.volume = Math.min(globalAudio.volume + 0.03, 1);
                        } else {
                            clearInterval(fadeIn);
                        }
                    }, 20);
                    // console.log("NExt")
                };
                let sentReady = false;
                playAgainCount.textContent = "0/" + (Math.floor(playerList.length / 2) + 1);
                playAgainBtn.disabled = false;
                playAgainBtn.onclick = () => {
                    if (!sentReady) {
                        roomSocket.send(JSON.stringify({ event: "player_ready" }));
                        sentReady = true;
                        playAgainBtn.disabled = true;
                    }
                }
                gameOverPopup.onclose = () => {
                    if (!sentReady) {
                        roomSocket.send(JSON.stringify({ event: "player_ready" }));
                        sentReady = true;
                    }
                }
                // await new Promise(resolve => {
                // });

                break;
            case "ready_votes":
                let playAgainCt = gameOverPopup.querySelector("#gameOverNextCount");
                playAgainCt.textContent = message.roomReadyVotes + "/" + (Math.floor(playerList.length / 2) + 1);
                break;
            case "game_start":
                console.log("Game Start.");

                overlayVidoes.style.opacity = 0;

                playerList = playerList.map(p => {
                    return { ...p, playerStatus: null };
                });
                updatePlayerList();



                gameOverPopup.close();
                loadingPopup.showModal();

                for (let line of lines) {
                    line.textContent = "";
                    line.classList.remove("correct", "incorrect", "skip");
                }

                searchInput.value = "";
                searchInput.focus();
                restartOnNext = false;

                await new Promise((resolve) => {
                    globalAudio.volume = 1;
                    let fadeOut = setInterval(() => {
                        // console.log(globalAudio.volume);
                        if (globalAudio.volume > 0.01) {
                            globalAudio.volume = Math.max(globalAudio.volume - 0.03, 0);
                        } else {
                            clearInterval(fadeOut);
                            globalAudio.pause();
                            resolve();
                        }
                    }, 20);
                });
                guessIndex = 0;
                roundDisplay.textContent = `Round ${guessIndex + 1}`;

                console.log("Playing next song.");
                globalAudio.pause();
                globalAudio = new Audio(message.songData.previewUrl);
                globalAudio.onloadeddata = setMarkers;
                globalAudio.onended = () => stopPlaying(true);

                controlsDisabled = false;

                setTimeout(() => {
                    loadingPopup.close();

                    setTimeout(() => {
                        globalAudio.currentTime = 0;
                        playGlobalAudio();
                        playing = true;
                        updatePlayBtn();
                    }, 500);
                }, 500);
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
    function addPlayerAvatar(player) {
        let playerAvatar = document.createElement("div");
        playerAvatar.className = "playerAvatar";
        let avatarImg = document.createElement("img");
        avatarImg.src = `https://api.dicebear.com/9.x/rings/svg?seed=${player.playerId}`;
        avatarImg.alt = "Avatar";
        let playerName = document.createElement("p");
        playerName.textContent = player.playerName;
        playerName.className = "playerName";
        let playerScore = document.createElement("p");
        playerScore.textContent = player.playerScore || 0;
        playerScore.className = "playerScore";
        playerAvatar.appendChild(avatarImg);
        playerAvatar.appendChild(playerName);
        playerAvatar.appendChild(playerScore);
        playerAvatar.classList.remove("correct", "incorrect", "skip");
        if (player.playerStatus) {
            if (player.playerStatus === "correct") {
                playerAvatar.classList.add("correct");
            } else if (player.playerStatus === "incorrect") {
                playerAvatar.classList.add("incorrect");
            } else if (player.playerStatus === "skip") {
                playerAvatar.classList.add("skip");
            }
        }
        playerListEl.appendChild(playerAvatar);
    }
    let myPlayer = playerList.find(p => p.playerId === playerId);
    addPlayerAvatar({ ...myPlayer, playerName: "You" });
    playerList.forEach(player => {
        if (player.playerId == playerId) {
            return;
        }
        addPlayerAvatar(player);
    });
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
    // indicates the marker going to max at
    document.querySelector(".progress .indicator").style.left = `${Math.min((maxListenTime / (globalAudio.duration * 1000)) * 100, 100)}%`;
    document.querySelector(".progress .indicator").textContent = Math.floor(maxListenTime * 10) / 10000 + "s";


    if (searchInput.value.trim().length !== 0) {
        guessBtn.classList.remove("guessSkip");
        guessBtn.textContent = "Guess";
    } else {
        guessBtn.classList.add("guessSkip");
        guessBtn.textContent = "Skip";
    }

    if (controlsDisabled) {
        // searchInput.disabled = true;
        guessBtn.disabled = true;
    } else {
        // searchInput.disabled = false;
        guessBtn.disabled = false;
    }
    requestAnimationFrame(updateControls);
}

function setMarkers() {
    document.querySelector(".progress .markers").innerHTML = maxTimes
        .map(time => `<div class="marker" style="left: ${Math.min((time / (globalAudio.duration * 1000)) * 100)}%"></div>`)
        .join("");
}

function updatePlayBtn() {
    if (globalAudio && playing) {
        playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>`;
    } else {
        playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    }
}


// Play / Pause Controls
function stopPlaying(endClip = false) {
    playing = false;
    updatePlayBtn();
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
        const maxListenTime = maxTimes[Math.min(guessIndex, maxTimes.length - 1)];
        // console.log("Restart? ", restartOnNext, globalAudio.currentTime >= (maxListenTime - 30) / 1000, globalAudio.currentTime, (maxListenTime - 30) / 1000);
        if (restartOnNext || globalAudio.currentTime >= (maxListenTime - 30) / 1000) {
            globalAudio.currentTime = 0;
            restartOnNext = false;
        }
        playing = true;
        updatePlayBtn();
        playGlobalAudio();
    }
};

// Song Search
async function searchSongs(query) {
    const apiKey = "78ef4f49d601a8f36462eb98f885b78a"; // Replace with your Last.fm API key
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(query)}&limit=${suggestionLimit}&api_key=${apiKey}&format=json`;

    try {
        const raw = await fetch(url);
        const parsed = await raw.json();
        return parsed.results?.trackmatches?.track?.map((t, i) => `${i + 1}. ${t.name.slice(0, 100)} - ${t.artist}`).join("\n") || "";
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
            result.textContent = line.replace(/^[0-9]+\. /, "");
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



// Guess Button
guessBtn.onclick = async () => {
    if (searchInput.value.trim().length === 0) {

        if (!roomSocket) return;
        roomSocket.send(JSON.stringify({ event: "update_status", status: "skip" }));

        if (lines[guessIndex]) {
            lines[guessIndex].textContent = "Skipped";
            lines[guessIndex].classList.add("skip");
        }
        // guessIndex++;
        // checkGameOver();
        restartOnNext = false;
        controlsDisabled = true;

        // globalAudio?.play();
        // playing = true;
        // updatePlayBtn();

        searchInput.value = "";
        searchInput.focus();
        return;
    }

    if (!roomSocket) return;
    roomSocket.send(JSON.stringify({ event: "update_status", songName: searchInput.value.trim().split("-")[0], songArtist: searchInput.value.split("-")[searchInput.value.split("-").length - 1].trim() }));
    if (lines[guessIndex]) {
        lines[guessIndex].textContent = searchInput.value;
    }
    lastGuessLine = lines[guessIndex];

    // guessIndex++;
    // checkGameOver();
    restartOnNext = false;

    controlsDisabled = true;

    // playing = true;
    // globalAudio?.play();
    // updatePlayBtn();

    searchInput.value = "";
    searchInput.focus();

};

function checkUsername(username) {
    if (username.trim().length === 0) {
        usernamePopupError.textContent = "Please enter a username."
        usernamePopupError.style.display = "block"
        return false
    }
    if (username.length > 20) {
        usernamePopupError.textContent = "Username must be 20 characters or less."
        usernamePopupError.style.display = "block"
        return false
    }
    if (username.length <= 2) {
        usernamePopupError.textContent = "Username must be at least 3 characters."
        usernamePopupError.style.display = "block"
        return false
    }

    if (!/^[a-zA-Z0-9]+$/.test(username)) {
        usernamePopupError.textContent = "Username can only contain letters and numbers."
        usernamePopupError.style.display = "block"
        return false
    }

    const bannedUsernames = ["admin", "host", "server", "moderator", "administator"]
    // check if any part of username is these
    if (bannedUsernames.some(banned => username.toLowerCase().includes(banned)) || ["you", "me"].includes(username.toLowerCase().trim())) {
        usernamePopupError.textContent = "Username is not allowed."
        usernamePopupError.style.display = "block"
        return false
    }

    return true
}

usernamePopup.querySelector("button").onclick = () => {
    const username = usernamePopup.querySelector("input").value.trim();
    if (!username || !checkUsername(username)) return;
    setSavedUsername(username);
    usernamePopup.close();
    tryJoinRoom();
}