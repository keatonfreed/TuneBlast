// DOM Elements
const playBtn = document.getElementById("playBtn");
const guessBtn = document.getElementById("guessBtn");
const lines = document.querySelectorAll(".line");
const searchInput = document.getElementById("searchInput");
const searchPopup = document.getElementById("searchPopup");

const loadingPopup = document.getElementById("loadingPopup");
loadingPopup.showModal();

const gameOverPopup = document.getElementById("gameOverPopup");

const overlayVidoes = document.getElementById("overlayVideos");

// get TuneBlast

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

// State Variables
let globalAudio, songId;
let playing = false;
let restartOnNext = false;
let guessIndex = 0;
// const maxTimes = [100, 1000, 2000, 3500, 9000, 30000];
const maxTimes = [100, 500, 1500, 3500, 9000, 30000];
let lastInputUpdate;
const suggestionLimit = 5;


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

let playedSongs = [];

// Get Random Song
async function trySongFetch() {
    let songUrl;
    for (let i = 0; i < 5 && !songUrl; i++) {
        const { songData, songId: id } = await backendFetch("/api/v1/solo/randomsong").catch(() => { });
        if (songData && songData.previewUrl && !playedSongs.includes(id)) {
            songUrl = songData.previewUrl;
            playedSongs.push(id);
            songId = id;
            globalAudio = new Audio(songUrl);
            globalAudio.onloadeddata = setMarkers;
            globalAudio.onended = () => stopPlaying(true);
            updateControls();
            setTimeout(() => loadingPopup.close(), 500);
            requestAnimationFrame(updateControls);
        }
    }
    if (!songUrl) {
        console.error("Failed to fetch song after 5 attempts.");
        loadingPopup.close();
    }
}
trySongFetch();

// Progress Bar & Markers
function updateControls() {
    if (!globalAudio) return;
    const maxListenTime = maxTimes[Math.min(guessIndex, maxTimes.length - 1)];
    if (playing && globalAudio.currentTime >= maxListenTime / 1000) {
        stopPlaying(true);
        globalAudio.currentTime = maxListenTime / 1000;
    }
    document.querySelector(".progress .bar").style.width = `${(globalAudio.currentTime / globalAudio.duration) * 100}%`;
    document.querySelector(".progress .indicator").style.left = `${Math.min((maxListenTime / (globalAudio.duration * 1000)) * 100, 100)}%`;
    document.querySelector(".progress .indicator").textContent = Math.floor(maxListenTime * 10) / 10000 + "s";

    if (searchInput.value.trim().length !== 0) {
        guessBtn.classList.remove("guessSkip");
        guessBtn.textContent = "Guess";
    } else {
        guessBtn.classList.add("guessSkip");
        guessBtn.textContent = "Skip";
    }

    if (!winningVolAnim && globalAudio) {
        globalAudio.volume = maxVolume;
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
        if (restartOnNext || globalAudio.currentTime >= (maxListenTime - 30) / 1000) {
            globalAudio.currentTime = 0;
            restartOnNext = false;
        }
        playing = true;
        updatePlayBtn();
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


async function gameOver(win = false) {
    overlayVidoes.querySelectorAll("video").forEach(video => {
        video.play();
    });
    overlayVidoes.style.opacity = 0.2;

    globalAudio.currentTime = 0;
    globalAudio.play();
    globalAudio.volume = 0;
    winningVolAnim = true;
    let fadeIn = setInterval(() => {
        if (globalAudio.volume < maxVolume) {
            globalAudio.volume = Math.min(globalAudio.volume + 0.03, 1);
        } else {
            clearInterval(fadeIn);
        }
    }, 20);

    guessBtn.disabled = true;
    playBtn.disabled = true;

    gameOverPopup.querySelector("#gameOverMessage").textContent = win ? "Correct!" : "Game Over!";
    gameOverPopup.querySelector("#gameOverSubtitle").textContent = win ? `You guessed the song in ${guessIndex + 1} attempts.` : "You didn't guess the song.";

    let findSongBtn = gameOverPopup.querySelector("#gameOverFind");
    let playAgainBtn = gameOverPopup.querySelector("#gameOverNext");

    backendFetch(`/api/v1/solo/finish/?songId=${songId}`).catch((err) => {
        console.error("Failed to finish song:", err);
        gameOverPopup.showModal();
        gameOverPopup.querySelector("#gameOverSong").textContent = "There was an error.";


    }).then((answer) => {
        gameOverPopup.showModal();
        if (answer) {
            gameOverPopup.querySelector("#gameOverSong").textContent = answer.songName + " by " + answer.songArtist;

            findSongBtn.onclick = async () => {
                let youtubeMusicSearchLink = `https://music.youtube.com/search?q=${encodeURIComponent(answer.songName + " by " + answer.songArtist)}`;
                window.open(youtubeMusicSearchLink, "_blank");
            }
        }
    });


    globalAudio.onended = () => {
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
    };
    await new Promise(resolve => {
        playAgainBtn.onclick = async () => {
            resolve();
        }
        gameOverPopup.onclose = async () => {
            resolve();
        }
    });

    gameOverPopup.close();

    loadingPopup.showModal();
    overlayVidoes.style.opacity = 0;


    // playing = true;
    // updatePlayBtn();

    for (let line of lines) {
        line.textContent = "";
        line.classList.remove("correct", "close", "incorrect", "skip");
    }

    await new Promise((resolve) => {
        globalAudio.volume = maxVolume;
        let fadeOut = setInterval(() => {
            if (globalAudio.volume > 0.01) {
                globalAudio.volume = Math.max(globalAudio.volume - 0.03, 0);
            } else {
                clearInterval(fadeOut);
                globalAudio.pause();
                resolve();
            }
        }, 20);
    });
    winningVolAnim = false;

    guessIndex = 0;

    trySongFetch();

    searchInput.value = "";
    searchInput.focus();

    restartOnNext = false;

    guessBtn.disabled = false;
    playBtn.disabled = false;
}

function updatePlayBtn() {
    if (globalAudio && playing) {
        playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>`;
    } else {
        playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    }
}

window.addEventListener("blur", () => {
    if (playing && !gameOverPopup.open) {
        stopPlaying();
    }
});

// Guess Button
guessBtn.onclick = async () => {
    if (searchInput.value.trim().length === 0) {
        if (lines[guessIndex]) {
            lines[guessIndex].textContent = "Skipped";
            lines[guessIndex].classList.add("skip");
        }
        guessIndex++;
        if (guessIndex >= maxTimes.length) {
            gameOver();
            return;
        }
        restartOnNext = false;

        playing = true;
        updatePlayBtn();
        globalAudio?.play();

        searchInput.value = "";
        searchInput.focus();
        return;
    }

    const response = await backendFetch(`/api/v1/solo/guess/?songName=${encodeURIComponent(searchInput.value)}&songArtist=${encodeURIComponent(searchInput.value.split("-")[searchInput.value.split("-").length - 1].trim())}&songId=${encodeURIComponent(songId)}`);
    if (lines[guessIndex]) {
        lines[guessIndex].textContent = searchInput.value;
    }
    if (response) {
        let { nameCorrect, artistCorrect } = response;
        if (nameCorrect && artistCorrect) {
            globalAudio.pause();
            let correctSound = new Audio("../correct.mp3");

            correctSound.play();
            correctSound.onended = () => {
                gameOver(true);
            }
            searchInput.value = "";
            lines[guessIndex]?.classList.add("correct");
            return
        } else if (nameCorrect || artistCorrect) {
            let closeSound = new Audio("../incorrect.mp3");
            closeSound.play();
            closeSound.onended = () => {
                playing = true;
                updatePlayBtn();
                globalAudio?.play();
            }
            lines[guessIndex]?.classList.add("close");
        } else {
            let incorrectSound = new Audio("../incorrect.mp3");

            incorrectSound.play();
            incorrectSound.onended = () => {
                playing = true;
                updatePlayBtn();
                globalAudio?.play();
            }
            lines[guessIndex]?.classList.add("incorrect");
        }
    } else {
        console.error("Failed guess song request.");
    }
    guessIndex++;

    if (guessIndex >= maxTimes.length) {
        gameOver();
        return;
    }
    restartOnNext = false;

    searchInput.value = "";
    searchInput.focus();

};
