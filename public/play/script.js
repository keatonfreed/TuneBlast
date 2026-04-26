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

const genreDisplay = document.getElementById("genreDisplay")
const genreSelector = document.getElementById("genreSelector");

const genreOptions = document.querySelectorAll("#genreSelector input[type='checkbox']");

function getSavedGenres() {
    const saved = localStorage.getItem("TuneBlast-SelectedGenres");
    return saved ? JSON.parse(saved) : ["Pop", "HipHop", "Classics", "Throwbacks"];
}

function setSavedGenres(genres) {
    localStorage.setItem("TuneBlast-SelectedGenres", JSON.stringify(genres));
    selectedGenres = genres;
}

let selectedGenres = getSavedGenres();

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

    setSavedGenres(selectedGenres);
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

genreOptions.forEach(option => {
    option.addEventListener("change", () => {
        if (option.checked) {
            selectedGenres.push(option.getAttribute("data-genre"));
        } else {
            if (selectedGenres.length >= 2) {
                selectedGenres = selectedGenres.filter(genre => genre !== option.getAttribute("data-genre"));

            } else {
                option.checked = true;
            }
        }
        updateGenreDisplay();
        preloadedSongPromise = null;
        prepareNextSong();
    });
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

// State Variables
let globalAudio, songId;
let playing = false;
let restartOnNext = false;
let guessIndex = 0;
// const maxTimes = [100, 1000, 2000, 3500, 9000, 30000];
const maxTimes = [100, 500, 1500, 3500, 9000, 30000];
let lastInputUpdate;
const suggestionLimit = 10;
const searchDebounceMs = 220;
const searchThrottleMs = 450;
let searchRequestId = 0;
let latestRenderedSearchRequestId = 0;
let activeSearchController;
let lastSearchStartedAt = 0;
let lastSearchQuery = "";
let searchPendingQuery = "";
let searchInFlight = false;
let queuedSearchQuery = "";
const searchCache = new Map();
let guessInFlight = false;
let preloadedSongPromise;
let updateControlLoop = false;


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
async function fetchRandomSongData() {
    const params = new URLSearchParams({
        categories: JSON.stringify(selectedGenres || []),
        exclude: JSON.stringify(playedSongs)
    });
    return backendFetch(`/api/v1/solo/randomsong?${params.toString()}`);
}

function waitForAudioReady(audio) {
    if (audio.readyState >= 2) return Promise.resolve();

    return new Promise(resolve => {
        const done = () => {
            audio.removeEventListener("loadeddata", done);
            audio.removeEventListener("canplaythrough", done);
            audio.removeEventListener("error", done);
            resolve();
        };
        audio.addEventListener("loadeddata", done, { once: true });
        audio.addEventListener("canplaythrough", done, { once: true });
        audio.addEventListener("error", done, { once: true });
    });
}

function prepareNextSong() {
    if (preloadedSongPromise) return preloadedSongPromise;

    preloadedSongPromise = (async () => {
        for (let i = 0; i < 5; i++) {
            const { songData, songId: id } = await fetchRandomSongData().catch(() => ({}));
            if (songData?.previewUrl && id && !playedSongs.includes(id)) {
                const audio = new Audio(songData.previewUrl);
                audio.preload = "auto";
                audio.load();
                await waitForAudioReady(audio);
                return { songData, songId: id, audio };
            }
        }
        return null;
    })();

    return preloadedSongPromise;
}

async function trySongFetch() {
    const preparedSong = await prepareNextSong();
    preloadedSongPromise = null;

    if (!preparedSong) {
        console.error("Failed to fetch song after 5 attempts.");
        loadingPopup.close();
        return;
    }

    playedSongs.push(preparedSong.songId);
    songId = preparedSong.songId;
    globalAudio = preparedSong.audio;
    globalAudio.onloadeddata = setMarkers;
    globalAudio.onended = () => stopPlaying(true);
    if (globalAudio.readyState >= 1) setMarkers();

    if (!updateControlLoop) {
        updateControlLoop = true;
        requestAnimationFrame(updateControls);
    }
    setTimeout(() => loadingPopup.close(), 500);
    prepareNextSong();
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
    const duration = Number.isFinite(globalAudio.duration) ? globalAudio.duration : 0;
    document.querySelector(".progress .bar").style.width = `${duration ? (globalAudio.currentTime / duration) * 100 : 0}%`;
    document.querySelector(".progress .indicator").style.left = `${duration ? Math.min((maxListenTime / (duration * 1000)) * 100, 100) : 0}%`;
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
    const duration = Number.isFinite(globalAudio.duration) ? globalAudio.duration : 0;
    document.querySelector(".progress .markers").innerHTML = maxTimes
        .map(time => `<div class="marker" style="left: ${duration ? Math.min((time / (duration * 1000)) * 100, 100) : 0}%"></div>`)
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
function normalizeSearchResult(value) {
    return value.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s-]/g, "").trim();
}

async function searchSongs(query, signal) {
    const cacheKey = query.toLowerCase();
    if (searchCache.has(cacheKey)) {
        return searchCache.get(cacheKey);
    }

    const apiKey = "78ef4f49d601a8f36462eb98f885b78a"; // Replace with your Last.fm API key
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(query)}&limit=${suggestionLimit}&api_key=${apiKey}&format=json`;

    try {
        const raw = await fetch(url, { signal });
        const parsed = await raw.json();
        const tracks = parsed.results?.trackmatches?.track || [];
        const seen = new Set();
        const results = tracks
            .map(t => `${String(t.name || "").slice(0, 100)} - ${String(t.artist || "").slice(0, 100)}`)
            .filter(result => {
                const key = normalizeSearchResult(result);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        searchCache.set(cacheKey, results);
        if (searchCache.size > 30) {
            searchCache.delete(searchCache.keys().next().value);
        }
        return results;
    } catch (error) {
        if (error.name === "AbortError") return [];
        console.error("Search error:", error);
        return [];
    }
}

async function updateSearchPopup(forcedQuery = searchInput.value.trim()) {
    const query = forcedQuery.trim();
    if (searchInFlight) {
        queuedSearchQuery = query;
        return;
    }

    const requestId = ++searchRequestId;
    if (!query) return searchPopup.classList.add("hidden");
    const cacheKey = query.toLowerCase();
    const cachedResults = searchCache.get(cacheKey);
    if (cachedResults) {
        latestRenderedSearchRequestId = requestId;
        renderSearchResults(cachedResults);
        lastSearchQuery = query;
        return;
    }
    if (query === lastSearchQuery && (searchPopup.childElementCount || searchPendingQuery === query)) return;

    lastSearchStartedAt = Date.now();
    lastSearchQuery = query;
    searchPendingQuery = query;
    searchInFlight = true;
    activeSearchController = new AbortController();
    const songList = await searchSongs(query, activeSearchController.signal);
    searchInFlight = false;
    if (searchPendingQuery === query) searchPendingQuery = "";
    if (requestId > latestRenderedSearchRequestId) {
        latestRenderedSearchRequestId = requestId;
        renderSearchResults(songList);
    }

    if (queuedSearchQuery && queuedSearchQuery !== query) {
        const nextQuery = queuedSearchQuery;
        queuedSearchQuery = "";
        updateSearchPopup(nextQuery);
    } else {
        queuedSearchQuery = "";
    }
}

function renderSearchResults(songList) {
    if (document.activeElement !== searchInput || !searchInput.value.trim()) return;

    searchPopup.innerHTML = "";
    searchPopup.scrollTop = 0;
    if (!songList.length) {
        searchPopup.classList.add("hidden");
        return;
    }
    songList.forEach(line => {
        let result = document.createElement("button");
        result.className = "result";
        result.textContent = line.slice(0, 120);
        result.onclick = () => {
            searchInput.value = result.textContent;
            searchPopup.classList.add("hidden");
        };
        searchPopup.appendChild(result);
    });
    searchPopup.classList.remove("hidden");
    searchPopup.scrollTop = 0;
}


searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        activeSearchController?.abort();
        searchInFlight = false;
        queuedSearchQuery = "";
        searchRequestId++;
        latestRenderedSearchRequestId = searchRequestId;
        searchPopup.classList.add("hidden");
    }
});

function scheduleSearchPopup() {
    clearTimeout(lastInputUpdate);
    if (!searchInput.value.trim()) {
        activeSearchController?.abort();
        searchInFlight = false;
        queuedSearchQuery = "";
        searchRequestId++;
        latestRenderedSearchRequestId = searchRequestId;
        lastSearchQuery = "";
        searchPendingQuery = "";
        searchPopup.classList.add("hidden");
        return;
    }

    const waitForThrottle = Math.max(0, searchThrottleMs - (Date.now() - lastSearchStartedAt));
    if (waitForThrottle === 0) {
        updateSearchPopup();
    }

    lastInputUpdate = setTimeout(updateSearchPopup, Math.max(searchDebounceMs, waitForThrottle));
}

searchInput.addEventListener("input", () => {
    scheduleSearchPopup();
});


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

    await trySongFetch();
    playing = false;
    updatePlayBtn();

    searchInput.value = "";
    searchInput.focus();
    updateSearchPopup();

    restartOnNext = false;

    guessInFlight = false;
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
    if (guessInFlight || !globalAudio) return;
    guessInFlight = true;
    let unlockWhenDone = true;

    try {
        const guessText = searchInput.value.trim();
        if (guessText.length === 0) {
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
            searchPopup.classList.add("hidden");
            unlockWhenDone = false;
            setTimeout(() => {
                guessInFlight = false;
            }, 120);
            return;
        }

        const guessedArtist = guessText.split("-").at(-1)?.trim() || guessText;
        const response = await backendFetch(`/api/v1/solo/guess/?songName=${encodeURIComponent(guessText)}&songArtist=${encodeURIComponent(guessedArtist)}&songId=${encodeURIComponent(songId)}`);
        if (lines[guessIndex]) {
            lines[guessIndex].textContent = guessText;
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
                searchPopup.classList.add("hidden");
                lines[guessIndex]?.classList.add("correct");
                unlockWhenDone = false;
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
        searchPopup.classList.add("hidden");
    } finally {
        if (unlockWhenDone) guessInFlight = false;
    }


};
