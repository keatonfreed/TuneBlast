// DOM Elements
const playBtn = document.getElementById("playBtn");
const guessBtn = document.getElementById("guessBtn");
const lines = document.querySelectorAll(".line");
const searchInput = document.getElementById("searchInput");
const searchPopup = document.getElementById("searchPopup");
const shouldRefocusSearchInput = !window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;

const loadingPopup = document.getElementById("loadingPopup");
loadingPopup.showModal();

const gameOverPopup = document.getElementById("gameOverPopup");
const overlayVidoes = document.getElementById("overlayVideos");
const genreDisplay = document.getElementById("genreDisplay");
const genreSelector = document.getElementById("genreSelector");
const genreOptions = document.querySelectorAll("#genreSelector input[type='checkbox']");
const soloSettingsBtn = document.getElementById("soloSettingsBtn");
const soloSettingsPopup = document.getElementById("soloSettingsPopup");
const soloAutoplayUnlockedCheckbox = document.getElementById("soloAutoplayUnlocked");
const soloKeepCurrentPlaybackKey = "TuneBlast-SoloKeepCurrentPlayback";

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
    const genreText = selectedGenres.length <= 2
        ? selectedGenres.join(", ")
        : `${selectedGenres.slice(0, 2).join(", ")}, ${selectedGenres.length - 2} more...`;
    genreDisplay.querySelector("span").textContent = genreText;
    genreOptions.forEach(option => {
        option.checked = selectedGenres.includes(option.getAttribute("data-genre"));
    });

    setSavedGenres(selectedGenres);
}

genreDisplay.addEventListener("click", () => {
    const rect = genreDisplay.getBoundingClientRect();
    genreSelector.style.left = `${rect.left + rect.width / 2}px`;
    genreSelector.style.top = `${rect.bottom + window.scrollY}px`;
    genreSelector.showModal();
    genreDisplay.classList.add("open");
});

genreSelector.addEventListener("click", (event) => {
    if (event.target === genreSelector) {
        genreSelector.close();
    }
});

genreSelector.addEventListener("close", () => {
    genreDisplay.classList.remove("open");
});

genreOptions.forEach(option => {
    option.addEventListener("change", () => {
        if (option.checked) {
            selectedGenres.push(option.getAttribute("data-genre"));
        } else if (selectedGenres.length >= 2) {
            selectedGenres = selectedGenres.filter(genre => genre !== option.getAttribute("data-genre"));
        } else {
            option.checked = true;
        }
        updateGenreDisplay();
        songFetchGeneration++;
        discardSongPlayer(nextSongPlayer);
        nextSongPlayer = null;
        nextSongPlayerPromise = null;
        preloadNextSong();
    });
});

updateGenreDisplay();

function shouldAutoplayUnlockedClip() {
    return localStorage.getItem(soloKeepCurrentPlaybackKey) !== "true";
}

function setKeepCurrentPlayback(enabled) {
    localStorage.setItem(soloKeepCurrentPlaybackKey, enabled ? "true" : "false");
    soloAutoplayUnlockedCheckbox.checked = enabled;
}

soloAutoplayUnlockedCheckbox.checked = !shouldAutoplayUnlockedClip();

soloSettingsBtn.addEventListener("click", () => {
    soloSettingsPopup.showModal();
});

soloSettingsPopup.addEventListener("click", (event) => {
    if (event.target === soloSettingsPopup) {
        soloSettingsPopup.close();
    }
});

soloAutoplayUnlockedCheckbox.addEventListener("change", () => {
    setKeepCurrentPlayback(soloAutoplayUnlockedCheckbox.checked);
});

const volumeSliderEl = document.getElementById("volumeSlider").querySelector("input[type='range']");

let winningVolAnim = false;
let maxVolume = 0.8;

function setSavedVolume(volume) {
    localStorage.setItem("TuneBlast-Volume", volume);
    maxVolume = volume;
}

function getSavedVolume() {
    return localStorage.getItem("TuneBlast-Volume") ?? 0.8;
}

function updateVolumeSlider() {
    volumeSliderEl.style.setProperty("--progress", maxVolume * 100 + "%");
    volumeSliderEl.value = maxVolume * 100;
}

volumeSliderEl.oninput = () => {
    setSavedVolume(Number(volumeSliderEl.value) / 100);
    if (previewHowl) {
        previewHowl.volume(maxVolume);
    }
    updateVolumeSlider();
};

maxVolume = getSavedVolume();
updateVolumeSlider();

// State Variables
let globalAudio, songId, songPreviewUrl;
let previewHowl;
let previewMonitorFrame;
let previewSoundId = null;
let previewRequestId = 0;
let previewPositionSeconds = 0;
let previewSegmentEnded = false;
let playing = false;
let restartOnNext = false;
let guessIndex = 0;
const maxTimes = [100, 500, 1500, 3500, 9000, 30000];
const previewSprites = Object.fromEntries(maxTimes.map(time => [`clip-${time}`, [0, time]]));
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
let songDurationSeconds = 30;
let isPreparingPlayback = false;
let nextSongPlayer = null;
let nextSongPlayerPromise = null;
let songFetchGeneration = 0;
let controlsLoopStarted = false;
const shouldShowGameOverVideo = !window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;

if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => { playBtn.click(); });
    navigator.mediaSession.setActionHandler("pause", () => { playBtn.click(); });
}

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

function getMaxListenSeconds() {
    return maxTimes[Math.min(guessIndex, maxTimes.length - 1)] / 1000;
}

function clearPreviewPlaybackTimers() {
    cancelAnimationFrame(previewMonitorFrame);
    previewMonitorFrame = undefined;
}

function getPreviewPosition() {
    const maxListenSeconds = getMaxListenSeconds();
    if (playing && previewHowl && previewSoundId != null) {
        return Math.min(Math.max(Number(previewHowl.seek(previewSoundId)) || 0, 0), maxListenSeconds);
    }
    return Math.min(Math.max(previewPositionSeconds, 0), maxListenSeconds);
}

function stopPreviewPlayback({ resetPosition = false, endClip = false } = {}) {
    clearPreviewPlaybackTimers();
    if (endClip) {
        previewPositionSeconds = getMaxListenSeconds();
        previewSegmentEnded = true;
    } else if (!resetPosition) {
        previewPositionSeconds = getPreviewPosition();
    }

    if (!previewHowl) return;
    if (previewSoundId != null) {
        previewHowl.stop(previewSoundId);
    } else {
        previewHowl.stop();
    }
    previewSoundId = null;

    if (resetPosition) {
        previewPositionSeconds = 0;
        previewSegmentEnded = false;
        restartOnNext = false;
    }
}

function syncPreviewProgress() {
    if (!playing || !previewHowl) return;
    previewMonitorFrame = requestAnimationFrame(syncPreviewProgress);
}

function startPreviewProgressMonitor(soundId, requestId) {
    clearPreviewPlaybackTimers();
    if (requestId !== previewRequestId || soundId !== previewSoundId) return;
    previewMonitorFrame = requestAnimationFrame(syncPreviewProgress);
}

function getPreviewSpriteName() {
    const maxListenTime = maxTimes[Math.min(guessIndex, maxTimes.length - 1)];
    return `clip-${maxListenTime}`;
}

function resetPreviewState() {
    previewPositionSeconds = 0;
    previewSegmentEnded = false;
    restartOnNext = false;
    previewSoundId = null;
}

function handlePreviewEnded(soundId) {
    if (soundId !== previewSoundId) return;
    clearPreviewPlaybackTimers();
    previewPositionSeconds = getMaxListenSeconds();
    previewSegmentEnded = true;
    previewSoundId = null;
    playing = false;
    restartOnNext = true;
    updatePlayBtn();
    globalAudio?.pause();
}

function unloadPreviewHowl() {
    stopPreviewPlayback({ resetPosition: true });
    if (previewHowl) {
        previewHowl.unload();
        previewHowl = undefined;
    }
}

function discardSongPlayer(player) {
    player?.audio?.pause();
    player?.howl?.unload();
}

function createSongPlayer(songUrl, id) {
    const player = { songUrl, id, durationSeconds: 30 };
    const audio = new Audio(songUrl);
    audio.preload = "auto";
    audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
            player.durationSeconds = audio.duration;
        }
        if (globalAudio === audio) {
            songDurationSeconds = player.durationSeconds;
            setMarkers();
        }
    };
    audio.onended = () => stopPlaying(true);

    const howl = new Howl({
        src: [songUrl],
        format: ["aac", "mp3", "m4a"],
        preload: true,
        html5: false,
        sprite: previewSprites,
        volume: maxVolume,
        onload: () => {
            const duration = howl.duration();
            if (Number.isFinite(duration) && duration > 0) {
                player.durationSeconds = duration;
            }
            if (previewHowl === howl) {
                songDurationSeconds = player.durationSeconds;
                setMarkers();
            }
        },
        onloaderror: (_, error) => {
            console.error("Preview audio failed to load:", error);
        },
        onplayerror: (_, error) => {
            console.error("Preview audio failed to play:", error);
            stopPlaying();
        },
        onend: (soundId) => {
            handlePreviewEnded(soundId);
        }
    });

    player.audio = audio;
    player.howl = howl;
    audio.load();
    return player;
}

function activateSongPlayer(player) {
    unloadPreviewHowl();
    songPreviewUrl = player.songUrl;
    songId = player.id;
    playedSongs.push(player.id);
    globalAudio = player.audio;
    previewHowl = player.howl;
    songDurationSeconds = player.durationSeconds || 30;
    resetPreviewState();
    updatePlayBtn();
    setMarkers();
    startControlsLoop();
}

async function fetchSongPlayer() {
    const attemptedSongIds = [];

    for (let i = 0; i < 5; i++) {
        const params = new URLSearchParams({
            categories: JSON.stringify(selectedGenres || []),
            exclude: JSON.stringify([...playedSongs, ...attemptedSongIds])
        });
        const { songData, songId: id } = await backendFetch(`/api/v1/solo/randomsong?${params.toString()}`).catch(() => { });
        if (songData && songData.previewUrl && !playedSongs.includes(id)) {
            return createSongPlayer(songData.previewUrl, id);
        }
        if (id) attemptedSongIds.push(id);
    }
    throw new Error("Failed to fetch song after 5 attempts.");
}

function preloadNextSong() {
    if (nextSongPlayer || nextSongPlayerPromise) return nextSongPlayerPromise;
    const generation = songFetchGeneration;
    nextSongPlayerPromise = fetchSongPlayer()
        .then((player) => {
            if (generation !== songFetchGeneration) {
                discardSongPlayer(player);
                return null;
            }
            nextSongPlayer = player;
            return player;
        })
        .catch((error) => {
            console.error("Failed to preload next song:", error);
            return null;
        })
        .finally(() => {
            nextSongPlayerPromise = null;
        });
    return nextSongPlayerPromise;
}

async function trySongFetch({ closeDelay = 500 } = {}) {
    try {
        const player = nextSongPlayer || await nextSongPlayerPromise || await fetchSongPlayer();
        nextSongPlayer = null;
        activateSongPlayer(player);
        if (closeDelay > 0) {
            setTimeout(() => loadingPopup.close(), closeDelay);
        } else {
            loadingPopup.close();
        }
        preloadNextSong();
    } catch (error) {
        console.error(error);
        loadingPopup.close();
    }
}
trySongFetch();

function startControlsLoop() {
    if (controlsLoopStarted) return;
    controlsLoopStarted = true;
    updateControls();
}

function updateControls() {
    if (!globalAudio) return;
    const maxListenTime = maxTimes[Math.min(guessIndex, maxTimes.length - 1)];
    const progressTime = getPreviewPosition();
    const duration = songDurationSeconds || globalAudio.duration || 30;

    document.querySelector(".progress .bar").style.width = `${(progressTime / duration) * 100}%`;
    document.querySelector(".progress .indicator").style.left = `${Math.min((maxListenTime / (duration * 1000)) * 100, 100)}%`;
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
    const duration = songDurationSeconds || globalAudio?.duration;
    if (!duration) return;

    document.querySelector(".progress .markers").innerHTML = maxTimes
        .map(time => `<div class="marker" style="left: ${duration ? Math.min((time / (duration * 1000)) * 100, 100) : 0}%"></div>`)
        .join("");
}

async function startPlayback() {
    if (!songPreviewUrl || !previewHowl || isPreparingPlayback) return;

    const maxListenSeconds = getMaxListenSeconds();
    if (previewSegmentEnded || restartOnNext || previewPositionSeconds >= maxListenSeconds) {
        previewPositionSeconds = 0;
        previewSegmentEnded = false;
        restartOnNext = false;
    }

    isPreparingPlayback = true;
    previewRequestId += 1;
    const requestId = previewRequestId;
    const startAtSeconds = previewPositionSeconds;

    try {
        stopPreviewPlayback({ resetPosition: false });
        previewPositionSeconds = startAtSeconds;
        previewHowl.volume(maxVolume);

        if (Howler.ctx?.state === "suspended") {
            await Howler.ctx.resume();
        }

        const soundId = previewHowl.play(getPreviewSpriteName());
        if (soundId == null) {
            throw new Error("Preview audio did not start");
        }

        previewSoundId = soundId;
        if (startAtSeconds > 0) {
            previewHowl.seek(startAtSeconds, soundId);
        }
        playing = true;
        updatePlayBtn();
        previewHowl.once("play", () => {
            if (requestId !== previewRequestId || soundId !== previewSoundId) return;
            startPreviewProgressMonitor(soundId, requestId);
        }, soundId);
    } catch (error) {
        stopPreviewPlayback();
        playing = false;
        updatePlayBtn();
        console.error("Audio play failed:", error);
    } finally {
        isPreparingPlayback = false;
    }
}

function stopPlaying(endClip = false) {
    isPreparingPlayback = false;
    stopPreviewPlayback({ endClip });
    playing = false;
    updatePlayBtn();
    globalAudio?.pause();
    if (endClip) {
        restartOnNext = true;
    }
}

function restartUnlockedClip() {
    resetPreviewState();
    updatePlayBtn();
    startPlayback();
}

playBtn.onclick = () => {
    if (!globalAudio) return;
    if (playing) {
        stopPlaying();
    } else {
        startPlayback();
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

async function gameOver(win = false) {
    stopPreviewPlayback();
    playing = false;
    updatePlayBtn();

    if (shouldShowGameOverVideo) {
        overlayVidoes.querySelectorAll("video").forEach(video => {
            video.play();
        });
        overlayVidoes.style.opacity = 0.2;
    }

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

    const findSongBtn = gameOverPopup.querySelector("#gameOverFind");
    const playAgainBtn = gameOverPopup.querySelector("#gameOverNext");

    backendFetch(`/api/v1/solo/finish/?songId=${songId}`).catch((err) => {
        console.error("Failed to finish song:", err);
        gameOverPopup.showModal();
        gameOverPopup.querySelector("#gameOverSong").textContent = "There was an error.";
    }).then((answer) => {
        gameOverPopup.showModal();
        if (answer) {
            gameOverPopup.querySelector("#gameOverSong").textContent = answer.songName + " by " + answer.songArtist;
            findSongBtn.onclick = async () => {
                const youtubeMusicSearchLink = `https://music.youtube.com/search?q=${encodeURIComponent(answer.songName + " by " + answer.songArtist)}`;
                window.open(youtubeMusicSearchLink, "_blank");
            };
        }
    });

    globalAudio.onended = () => {
        globalAudio.currentTime = 0;
        globalAudio.play();
        globalAudio.volume = 0;
        let loopFadeIn = setInterval(() => {
            if (globalAudio.volume < maxVolume) {
                globalAudio.volume = Math.min(globalAudio.volume + 0.03, 1);
            } else {
                clearInterval(loopFadeIn);
            }
        }, 20);
    };

    await new Promise(resolve => {
        let resolved = false;
        const continueToNextSong = () => {
            if (resolved) return;
            resolved = true;
            clearInterval(fadeIn);
            globalAudio.pause();
            globalAudio.onended = null;
            resolve();
        };
        playAgainBtn.onclick = continueToNextSong;
        gameOverPopup.onclose = continueToNextSong;
    });

    gameOverPopup.onclose = null;
    if (gameOverPopup.open) {
        gameOverPopup.close();
    }

    loadingPopup.showModal();
    overlayVidoes.style.opacity = 0;
    overlayVidoes.querySelectorAll("video").forEach(video => {
        video.pause();
        video.currentTime = 0;
    });

    for (let line of lines) {
        line.textContent = "";
        line.classList.remove("correct", "close", "incorrect", "skip");
    }

    globalAudio.pause();
    globalAudio.volume = maxVolume;
    winningVolAnim = false;

    guessIndex = 0;
    await trySongFetch({ closeDelay: 0 });
    playing = false;
    updatePlayBtn();

    searchInput.value = "";
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

guessBtn.onclick = async () => {
    if (guessInFlight || !globalAudio) return;
    guessInFlight = true;
    let unlockWhenDone = true;
    const wasPlayingBeforeGuess = playing;

    try {
        const guessText = searchInput.value.trim();
        if (guessText.length === 0) {
            const wasPlaying = playing;
            const unlockedPositionSeconds = getPreviewPosition();
            const autoplayUnlockedClip = shouldAutoplayUnlockedClip();
            stopPreviewPlayback();
            playing = false;

            if (lines[guessIndex]) {
                lines[guessIndex].textContent = "Skipped";
                lines[guessIndex].classList.add("skip");
            }
            guessIndex++;
            if (guessIndex >= maxTimes.length) {
                gameOver();
                return;
            }

            if (autoplayUnlockedClip) {
                restartUnlockedClip();
            } else {
                previewPositionSeconds = Math.min(unlockedPositionSeconds, getMaxListenSeconds());
                previewSegmentEnded = false;
                restartOnNext = false;
                updatePlayBtn();
                if (wasPlaying) {
                    startPlayback();
                }
            }

            searchInput.value = "";
            if (shouldRefocusSearchInput) {
                searchInput.focus();
            } else {
                searchInput.blur();
            }
            searchPopup.classList.add("hidden");
            unlockWhenDone = false;
            setTimeout(() => {
                guessInFlight = false;
            }, 120);
            return;
        }

        const guessedArtist = guessText.split("-").at(-1)?.trim() || guessText;
        const response = await backendFetch(`/api/v1/solo/guess/?songName=${encodeURIComponent(guessText)}&songArtist=${encodeURIComponent(guessedArtist)}&songId=${encodeURIComponent(songId)}`);
        const autoplayUnlockedClip = shouldAutoplayUnlockedClip();
        let missFeedbackSound;
        if (lines[guessIndex]) {
            lines[guessIndex].textContent = guessText;
        }
        if (response) {
            let { nameCorrect, artistCorrect } = response;
            if (nameCorrect && artistCorrect) {
                stopPreviewPlayback();
                playing = false;
                updatePlayBtn();
                globalAudio.pause();
                const correctSound = new Audio("../correct.mp3");

                correctSound.play();
                correctSound.onended = () => {
                    gameOver(true);
                };
                searchInput.value = "";
                searchPopup.classList.add("hidden");
                lines[guessIndex]?.classList.add("correct");
                unlockWhenDone = false;
                return;
            } else if (nameCorrect || artistCorrect) {
                const closeSound = new Audio("../incorrect.mp3");
                missFeedbackSound = closeSound;
                if (autoplayUnlockedClip) {
                    stopPreviewPlayback();
                    playing = false;
                    updatePlayBtn();
                }
                closeSound.play();
                closeSound.onended = () => {
                    if (autoplayUnlockedClip) {
                        restartUnlockedClip();
                    } else if (wasPlayingBeforeGuess) {
                        startPlayback();
                    }
                };
                lines[guessIndex]?.classList.add("close");
            } else {
                const incorrectSound = new Audio("../incorrect.mp3");
                missFeedbackSound = incorrectSound;
                if (autoplayUnlockedClip) {
                    stopPreviewPlayback();
                    playing = false;
                    updatePlayBtn();
                }

                incorrectSound.play();
                incorrectSound.onended = () => {
                    if (autoplayUnlockedClip) {
                        restartUnlockedClip();
                    } else if (wasPlayingBeforeGuess) {
                        startPlayback();
                    }
                };
                lines[guessIndex]?.classList.add("incorrect");
            }
        } else {
            console.error("Failed guess song request.");
        }

        const unlockedPositionSeconds = getPreviewPosition();
        guessIndex++;

        if (guessIndex >= maxTimes.length) {
            gameOver();
            return;
        }
        previewPositionSeconds = Math.min(unlockedPositionSeconds, getMaxListenSeconds());
        previewSegmentEnded = false;
        restartOnNext = false;
        if (autoplayUnlockedClip && !missFeedbackSound && response) {
            restartUnlockedClip();
        }

        searchInput.value = "";
        if (shouldRefocusSearchInput) {
            searchInput.focus();
        } else {
            searchInput.blur();
        }
        searchPopup.classList.add("hidden");
    } finally {
        if (unlockWhenDone) guessInFlight = false;
    }


};
