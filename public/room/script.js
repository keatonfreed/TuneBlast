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

const timeDisplay = document.getElementById("timeDisplay");


const roomCodeEl = document.getElementById("roomCodeEl");
const roomCode = window.location.search.slice(1);
console.log("Room code:", roomCode);
roomCodeEl.textContent = "Room: " + roomCode;


const genreDisplay = document.getElementById("genreDisplay")
const genreSelector = document.getElementById("genreSelector");

const genreOptions = document.querySelectorAll("#genreSelector input[type='checkbox']");


let selectedGenres = ["Pop", "Classics", "HipHop", "Throwbacks"];

function updateGenreDisplay() {
    selectedGenres = selectedGenres.sort((a, b) => a.localeCompare(b));
    let genreText = selectedGenres.length <= 2
        ? selectedGenres.join(", ")
        : `${selectedGenres.slice(0, 2).join(", ")}, ${selectedGenres.length - 2} more...`;
    genreDisplay.querySelector("span").textContent = genreText;
    genreOptions.forEach(option => {
        if (selectedGenres.includes(option.getAttribute("data-genre"))) {
            option.checked = true;
        } else {
            option.checked = false;
        }
    });
}


genreDisplay.addEventListener("click", () => {
    // Get h2 position
    const rect = genreDisplay.getBoundingClientRect();

    // Position the dialog below h2
    genreSelector.style.left = `${rect.left + rect.width / 2}px`;
    genreSelector.style.top = `${rect.bottom + window.scrollY}px`;

    genreSelector.showModal();
    genreDisplay.classList.add("open")
});

// Close when clicking outside
genreSelector.addEventListener("click", (event) => {
    if (event.target === genreSelector) {
        genreSelector.close();
    }
});

genreSelector.addEventListener("close", () => {
    genreDisplay.classList.remove("open")
});



updateGenreDisplay();



const volumeSliderEl = document.getElementById("volumeSlider").querySelector("input[type='range']");

let winningVolAnim = false;
let maxVolume = 0.8;
function setSavedVolume(volume) {
    localStorage.setItem("TuneBlast-Volume", volume)
    maxVolume = volume;
}

function getSavedVolume() {
    return localStorage.getItem("TuneBlast-Volume") ?? 0.8
}

function updateVolumeSlider() {
    // globalAudio.volume = Number(maxVolume) / 100;
    volumeSliderEl.style.setProperty("--progress", maxVolume * 100 + "%");
    volumeSliderEl.value = maxVolume * 100;
}

volumeSliderEl.oninput = () => {
    setSavedVolume(Number(volumeSliderEl.value) / 100);
    updateVolumeSlider();
}

maxVolume = getSavedVolume();
updateVolumeSlider();


let savedPlayerId;

function setSavedPlayerId(roomId, playerId) {
    try {
        let playerMap = JSON.parse(localStorage.getItem("TuneBlast-PlayerId")) || {};
        playerMap[roomId] = playerId;
        localStorage.setItem("TuneBlast-PlayerId", JSON.stringify(playerMap));
    } catch (err) {
        console.error("Failed to save player ID:", err);
        localStorage.removeItem("TuneBlast-PlayerId");
    }
}

function getSavedPlayerId(roomId) {
    try {
        const playerMap = JSON.parse(localStorage.getItem("TuneBlast-PlayerId"));
        return playerMap ? playerMap[roomId] : {};
    } catch (err) {
        console.error("Failed to get player ID:", err);
        localStorage.removeItem("TuneBlast-PlayerId");
        return null;
    }
}


let timeLeft = 0

function updateTimeLeft() {
    timeDisplay.textContent = `${String(Math.floor(timeLeft / 60)).padStart(1, '0')}:${String(timeLeft % 60).padStart(2, '0')}`;
}
updateTimeLeft();


let roomPlayMode = "normal";

// State Variables
let globalAudio;
let playing = false;
let restartOnNext = false;
let lastGuessLine;
let guessIndex = 0;
// const maxTimes = [100, 1000, 2000, 3500, 9000, 30000];
const maxTimes = [100, 500, 1500, 3500, 9000, 30000];

let lastInputUpdate;
const suggestionLimit = 5;

let playerList = [];

let controlsDisabled = false;
let updateControlLoop = false;

let pingInterval;

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

let retryInterval;
let retrying = false;

function roomError(message, retry = false) {
    console.error("Room Error:", message);

    if (!retrying && retry && roomSocket) {
        console.log("Auto 1 Retry");

        setTimeout(() => {
            tryJoinRoom();
        }, 100);
        retrying = true;
        return
    };

    document.getElementById("roomError").showModal();
    document.getElementById("roomErrorText").textContent = message || "An error occurred.";

    if (retry && roomSocket) {
        document.getElementById("roomErrorLink").href = "";
        document.getElementById("roomErrorLink").textContent = "Retry";
        document.getElementById("roomErrorLink").onclick = () => {
            console.log("Manual Retry");
            clearTimeout(retryInterval);
            tryJoinRoom();
            document.getElementById("roomError").close();
            return false;
        }

        clearInterval(retryInterval);
        retryInterval = setInterval(() => {
            console.log("Retrying...");
            tryJoinRoom();
            document.getElementById("roomError").close();
        }, 250);

    } else {
        document.getElementById("roomErrorLink").href = "../";
        document.getElementById("roomErrorLink").textContent = "Home";
        document.getElementById("roomErrorLink").onclick = null;
        clearTimeout(retryInterval);
    }
}


window.addEventListener("blur", () => {
    if (playing && globalAudio && !gameOverPopup.open) {
        stopPlaying();
    }

    if (roomSocket && playerId) {
        roomSocket.send(JSON.stringify({ event: "update_idle", playerIdle: true }));
    }
});

window.addEventListener("focus", () => {
    if (roomSocket && playerId) {
        roomSocket.send(JSON.stringify({ event: "update_idle", playerIdle: false }));
    }
});

let playingTicking;

async function tryJoinRoom() {

    if (!roomCode) {
        roomError("Invalid Join Code.");
        return;
    }

    if (!getSavedUsername()) {
        usernamePopup.showModal();
        console.error("No Saved Username")
        return;
    }
    if (roomSocket) {
        roomSocket.close();
        roomSocket = null;
    }
    roomSocket = await backendWebsocket(`/api/v1/room/${roomCode}`);
    if (!roomSocket) {
        console.error("Failed to join room");
        roomError("Failed to join room.");
        return;
    }

    let lastCorrect = false;
    let lastGuessed = false;

    savedPlayerId = getSavedPlayerId(roomCode);

    roomSocket.send(JSON.stringify({ event: "player_init", playerName: getSavedUsername(), playerId: savedPlayerId }));
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
            case "pong":
                break;
            case "update_timer":
                timeLeft = Math.max(0, message.roomTimeLeft ?? timeLeft);
                updateTimeLeft();

                if (timeLeft <= 5) {
                    if (!playingTicking) {
                        playingTicking = new Audio("../timer_tick.mp3");
                        playingTicking.loop = false;
                        playingTicking.volume = 0.7;
                        playingTicking.play();
                    }
                }
                break;
            case "room_init":
                clearInterval(retryInterval)

                roomPlayMode = message.roomPlayMode || "normal";

                if (roomPlayMode === "duel") {

                }


                let thisPlayer = message.roomPlayers.find(p => p.playerId === message.playerId);

                timeLeft = message.roomTimeLeft ?? timeLeft;
                updateTimeLeft();

                pingInterval = setInterval(() => {
                    roomSocket.send(JSON.stringify({ event: "ping" }));
                }, 5000);

                guessIndex = message.roomRound;
                if (guessIndex > 0) {
                    for (let i = 0; i < guessIndex; i++) {
                        lines[i].textContent = "Skipped";
                        lines[i].classList.add("skip");
                    }
                }
                if (thisPlayer.playerStatus) {
                    if (thisPlayer.playerStatus === "correct") {
                        lines[guessIndex].classList.add("correct");
                        lines[guessIndex].textContent = "Correct!";
                    } else if (thisPlayer.playerStatus === "close") {
                        lines[guessIndex].classList.add("close");
                        lines[guessIndex].textContent = "Almost!";
                    } else if (thisPlayer.playerStatus === "incorrect") {
                        lines[guessIndex].textContent = "Incorrect!";
                        lines[guessIndex].classList.add("incorrect");
                    } else if (thisPlayer.playerStatus === "skip") {
                        lines[guessIndex].classList.add("skip");
                        lines[guessIndex].textContent = "Skipped";
                    }
                    controlsDisabled = true;
                } else {
                    controlsDisabled = false;
                }


                roundDisplay.textContent = `Round ${guessIndex + 1}`;

                playerId = message.playerId;
                setSavedPlayerId(roomCode, playerId);

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

                if (globalAudio) {
                    globalAudio.pause();
                    globalAudio = null;
                    playing = false;
                    updatePlayBtn();
                }

                if (globalAudio) {
                    globalAudio.pause();
                    globalAudio = null;
                    playing = false;
                    updatePlayBtn();
                }
                globalAudio = new Audio(message.songData.previewUrl);
                globalAudio.onloadeddata = setMarkers;
                globalAudio.onended = () => stopPlaying(true);

                if (!updateControlLoop) {
                    updateControls();
                    requestAnimationFrame(updateControls);
                }
                updateControlLoop = true

                selectedGenres = message.roomSongGenres || selectedGenres;
                updateGenreDisplay();

                genreOptions.forEach(option => {
                    option.onchange = () => {
                        if (option.checked) {
                            selectedGenres.push(option.getAttribute("data-genre"));
                            if (roomSocket) {
                                roomSocket.send(JSON.stringify({ event: "update_genres", songGenres: selectedGenres }));
                            }
                        } else {
                            if (selectedGenres.length >= 2) {
                                selectedGenres = selectedGenres.filter(genre => genre !== option.getAttribute("data-genre"));
                                if (roomSocket) {
                                    roomSocket.send(JSON.stringify({ event: "update_genres", songGenres: selectedGenres }));
                                }
                            } else {
                                option.checked = true;
                            }
                        }
                        updateGenreDisplay();
                    };
                });

                setTimeout(() => loadingPopup.close(), 1000);
                break;
            case "update_genres":
                console.log("Updated genres:", message.roomSongGenres);
                selectedGenres = message.roomSongGenres;
                updateGenreDisplay();
                break;
            case "player_joined":
                console.log("Player joined:", message.playerName);
                playerList.push({ playerId: message.playerId, playerName: message.playerName, playerScore: message.playerScore, playerStatus: message.playerStatus, playerIdle: message.playerIdle });
                updatePlayerList();
                break;
            case "player_left":
                console.log("Player left:", message.playerName);
                playerList = playerList.filter(p => p.playerId !== message.playerId);
                updatePlayerList();
                break;

            case "player_idle":
                console.log("Player idle:", message.playerId, message.playerIdle);
                playerList = playerList.map(p => {
                    if (p.playerId === message.playerId) {
                        return { ...p, playerIdle: message.playerIdle ?? p.playerIdle, playerScore: message.playerScore ?? p.playerScore };
                    }
                    return p;
                });
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
                        lastGuessed = true;
                        let correctSound = new Audio("../correct.mp3");
                        correctSound.play();
                    } else if (message.status === "close") {
                        if (lastGuessLine) {
                            lastGuessLine.classList.add("close");
                        }
                        lastCorrect = false;
                        lastGuessed = true;

                        let closeSound = new Audio("../incorrect.mp3");
                        closeSound.play();
                    } else if (message.status === "incorrect") {
                        if (lastGuessLine) {
                            lastGuessLine.classList.add("incorrect");
                        }
                        lastCorrect = false;
                        lastGuessed = true;

                        let incorrectSound = new Audio("../incorrect.mp3");
                        incorrectSound.play();
                    } else if (message.status === "skip") {
                        lastCorrect = false;
                        lastGuessed = true;
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
            case "round_end":
                if (lines[guessIndex] && !lastGuessed) {
                    lines[guessIndex].classList.add("skip");
                    lines[guessIndex].textContent = "Skipped";
                }
                timeLeft = 0;
                if (playingTicking) {
                    playingTicking.pause();
                    playingTicking = null;
                }
                if (message.endType === "timer") {
                    // player ../timer_done.mp3
                    let timerDone = new Audio("../timer_done.mp3");
                    timerDone.volume = maxVolume;
                    timerDone.play();
                }
                break;

            case "round_start":
                console.log("Round Start.");

                timeLeft = message.roomTimeLeft ?? timeLeft;
                updateTimeLeft();

                lastGuessed = false;
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

                overlayVidoes.querySelectorAll("video").forEach(video => {
                    video.play();
                });
                overlayVidoes.style.opacity = 0.4;

                globalAudio.currentTime = 0;
                globalAudio.play();
                winningVolAnim = true;
                globalAudio.volume = 0;
                let fadeIn = setInterval(() => {
                    if (globalAudio.volume < maxVolume) {
                        globalAudio.volume = Math.min(globalAudio.volume + 0.03, 1);
                    } else {
                        clearInterval(fadeIn);
                    }
                }, 20);


                controlsDisabled = true;

                gameOverPopup.querySelector("#gameOverMessage").textContent = lastCorrect ? "Correct!" : "Game Over!";
                let correctPlayersList = message.correctPlayers?.filter(p => (p.playerId !== playerId)).map(p => p.playerName);
                let subtitle = "No one guessed the song.";
                let players = [...correctPlayersList]; // Copy the list

                if (lastCorrect) players.unshift("You"); // Add "You" if lastCorrect

                if (players.length) {
                    let formattedList = players.length === 1
                        ? players[0]
                        : players.slice(0, -1).join(", ") + " and " + players.at(-1);

                    subtitle = `${formattedList} guessed in ${guessIndex + 1} attempts.`;
                }

                gameOverPopup.querySelector("#gameOverSubtitle").textContent = subtitle;
                lastCorrect = false;
                lastGuessed = false;

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
                        if (globalAudio.volume < maxVolume) {
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
                    line.classList.remove("correct", "close", "incorrect", "skip");
                }

                searchInput.value = "";
                searchInput.focus();
                searchPopup.classList.add("hidden");
                updateSearchPopup();
                restartOnNext = false;

                globalAudio.play();
                await new Promise((resolve) => {
                    globalAudio.volume = maxVolume;
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
                    setTimeout(() => {
                        clearInterval(fadeOut);
                        globalAudio.pause();
                        resolve();
                    }, 2000);
                });
                winningVolAnim = false;
                guessIndex = 0;
                roundDisplay.textContent = `Round ${guessIndex + 1}`;

                console.log("Playing next song.");
                if (globalAudio) {
                    globalAudio.pause();
                    globalAudio = null;
                    playing = false;
                    updatePlayBtn();
                }
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
                roomError(message.message);
                break;

        }
    }

    let testClosed = false;
    // setTimeout(() => {
    //     roomSocket.close();
    //     testClosed = true;
    // }, 5000);

    roomSocket.onclose = (event) => {
        console.warn("Room Socket Closed.");
        if (!event.wasClean || testClosed) {
            roomError("Reconnecting...", true);
        }
        clearInterval(pingInterval);
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
        avatarImg.className = "playerImg";

        //         let playerCrown = document.createElement("svg");

        //         playerCrown.setAttribute("viewBox", "0 0 200 150");
        //         playerCrown.setAttribute("width", "200");
        //         playerCrown.setAttribute("height", "150");
        //         playerCrown.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        //         playerAvatar.appendChild(playerCrown);
        //         playerCrown.innerHTML = `
        //   <!-- Crown shape with three spikes, rounded bottom corners, and a single outline -->
        //   <path d="
        //     M20,100 
        //     Q50,20 70,100 
        //     Q100,20 130,100 
        //     Q160,20 180,100 
        //     L180,120 
        //     Q180,130 170,135 
        //     L30,135 
        //     Q20,130 20,120 
        //     Z"
        //     fill="#FFD700" stroke="#B8860B" stroke-width="5" stroke-linejoin="round"/>
        // `;
        //         playerCrown.alt = "Avatar";
        //         playerCrown.className = "playerCrown";

        let playerName = document.createElement("p");
        playerName.textContent = player.playerName;
        playerName.className = "playerName";
        let playerScore = document.createElement("p");
        playerScore.textContent = player.playerScore || 0;
        playerScore.className = "playerScore";
        playerAvatar.appendChild(avatarImg);
        playerAvatar.appendChild(playerName);
        playerAvatar.appendChild(playerScore);
        playerAvatar.classList.remove("correct", "close", "incorrect", "skip", "idle");
        if (player.playerStatus) {
            if (player.playerStatus === "correct") {
                playerAvatar.classList.add("correct");
            } else if (player.playerStatus === "close") {
                playerAvatar.classList.add("close");
            } else if (player.playerStatus === "incorrect") {
                playerAvatar.classList.add("incorrect");
            } else if (player.playerStatus === "skip") {
                playerAvatar.classList.add("skip");
            }
        }
        console.log("Player idle:", player.playerIdle);
        if (player.playerIdle) {
            playerAvatar.classList.add("idle");
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

    if (!winningVolAnim && globalAudio) {
        globalAudio.volume = maxVolume;
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
        searchPopup.classList.add("hidden");
        updateSearchPopup();
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
    searchPopup.classList.add("hidden");

    updateSearchPopup();

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