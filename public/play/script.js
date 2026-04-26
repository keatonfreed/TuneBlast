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
const genreDisplay = document.getElementById("genreDisplay");
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
    });
});

updateGenreDisplay();

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
const suggestionLimit = 5;
let songDurationSeconds = 30;
let isPreparingPlayback = false;
let nextSongPlayer = null;
let nextSongPlayerPromise = null;
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
    globalAudio = player.audio;
    previewHowl = player.howl;
    songDurationSeconds = player.durationSeconds || 30;
    resetPreviewState();
    updatePlayBtn();
    setMarkers();
    startControlsLoop();
}

async function fetchSongPlayer() {
    for (let i = 0; i < 5; i++) {
        const { songData, songId: id } = await backendFetch(`/api/v1/solo/randomsong?categories=${encodeURIComponent(JSON.stringify(selectedGenres || []))}`).catch(() => { });
        if (songData && songData.previewUrl && !playedSongs.includes(id)) {
            playedSongs.push(id);
            return createSongPlayer(songData.previewUrl, id);
        }
    }
    throw new Error("Failed to fetch song after 5 attempts.");
}

function preloadNextSong() {
    if (nextSongPlayer || nextSongPlayerPromise) return nextSongPlayerPromise;
    nextSongPlayerPromise = fetchSongPlayer()
        .then((player) => {
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
        .map(time => `<div class="marker" style="left: ${(time / (duration * 1000)) * 100}%"></div>`)
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

playBtn.onclick = () => {
    if (!globalAudio) return;
    if (playing) {
        stopPlaying();
    } else {
        startPlayback();
    }
};

async function searchSongs(query) {
    const apiKey = "78ef4f49d601a8f36462eb98f885b78a";
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

async function updateSearchPopup() {
    const query = searchInput.value.trim();
    if (!query) return searchPopup.classList.add("hidden");

    const songList = await searchSongs(query);
    if (songList) {
        searchPopup.innerHTML = "";
        songList.split("\n").forEach(line => {
            let result = document.createElement("button");
            result.className = "result";
            result.textContent = line.replace(/^[0-9]+\. /, "").slice(0, 100);
            result.onclick = () => {
                searchInput.value = result.textContent;
                searchPopup.classList.add("hidden");
            };
            searchPopup.appendChild(result);
        });
        searchPopup.classList.remove("hidden");
    }
}

searchInput.onkeyup = (e) => {
    clearTimeout(lastInputUpdate);
    if (e.key === "Escape") {
        searchPopup.classList.add("hidden");
        return;
    }
    lastInputUpdate = setTimeout(updateSearchPopup, 100);
};

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

    searchInput.value = "";
    updateSearchPopup();

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

guessBtn.onclick = async () => {
    if (searchInput.value.trim().length === 0) {
        const wasPlaying = playing;
        const unlockedPositionSeconds = getPreviewPosition();
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
        previewPositionSeconds = Math.min(unlockedPositionSeconds, getMaxListenSeconds());
        previewSegmentEnded = false;
        restartOnNext = false;
        updatePlayBtn();
        if (wasPlaying) {
            startPlayback();
        }

        searchInput.value = "";
        updateSearchPopup();
        return;
    }

    const response = await backendFetch(`/api/v1/solo/guess/?songName=${encodeURIComponent(searchInput.value)}&songArtist=${encodeURIComponent(searchInput.value.split("-")[searchInput.value.split("-").length - 1].trim())}&songId=${encodeURIComponent(songId)}`);
    if (lines[guessIndex]) {
        lines[guessIndex].textContent = searchInput.value;
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
            updateSearchPopup();
            lines[guessIndex]?.classList.add("correct");
            return;
        } else if (nameCorrect || artistCorrect) {
            const closeSound = new Audio("../incorrect.mp3");
            closeSound.play();
            closeSound.onended = () => {
                startPlayback();
            };
            lines[guessIndex]?.classList.add("close");
        } else {
            const incorrectSound = new Audio("../incorrect.mp3");
            incorrectSound.play();
            incorrectSound.onended = () => {
                startPlayback();
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
    searchInput.value = "";
    searchInput.focus();
    updateSearchPopup();
};
