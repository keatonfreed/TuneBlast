// DOM Elements
const playBtn = document.getElementById("playBtn");
const guessBtn = document.getElementById("guessBtn");
const lines = document.querySelectorAll(".line");
const searchInput = document.getElementById("searchInput");
const searchPopup = document.getElementById("searchPopup");

const loadingPopup = document.getElementById("loadingPopup");
loadingPopup.showModal();

// State Variables
let globalAudio, songUrl;
let playing = false;
let restartOnNext = false;
let maxIndex = 0;
const maxTimes = [100, 1000, 2000, 3500, 9000, 35000];
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

// Get Random Song
async function trySongFetch() {
    for (let i = 0; i < 5 && !songUrl; i++) {
        const { previewUrl } = await backendFetch("/randomsong").catch(() => { });
        if (previewUrl) {
            songUrl = previewUrl;
            globalAudio = new Audio(songUrl);
            globalAudio.onloadeddata = setMarkers;
            globalAudio.onended = () => stopPlaying(true);
            updateProgressBar();
            setTimeout(() => loadingPopup.close(), 1000);
            requestAnimationFrame(updateProgressBar);
        }
    }
    if (!songUrl) {
        console.error("Failed to fetch song after 5 attempts.");
        loadingPopup.close();
    }
}
trySongFetch();

// Progress Bar & Markers
function updateProgressBar() {
    if (!globalAudio) return;
    const maxListenTime = maxTimes[Math.min(maxIndex, maxTimes.length - 1)];
    if (globalAudio.currentTime >= maxListenTime / 1000) {
        stopPlaying(true);
        globalAudio.currentTime = maxListenTime / 1000;
    }
    document.querySelector(".progress .bar").style.width = `${(globalAudio.currentTime / globalAudio.duration) * 100}%`;
    requestAnimationFrame(updateProgressBar);
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
        maxIndex++;
    }
}

playBtn.onclick = () => {
    if (!globalAudio) return;
    if (playing) {
        stopPlaying();
    } else {
        playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>`;
        if (restartOnNext) {
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

    if (searchInput.value.trim().length !== 0) {
        guessBtn.classList.remove("guessSkip");
        guessBtn.textContent = "Guess";
    } else {
        guessBtn.classList.add("guessSkip");
        guessBtn.textContent = "Skip";
    }
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
        searchInput.value = "";
        searchInput.focus();
        return;
    }

    const response = await backendFetch(`/api/v1/session/${sessionID}/?song=${encodeURIComponent(searchInput.value)}`);
    console.log("Guess response:", response);
    searchInput.value = "";
    searchInput.focus();
};
