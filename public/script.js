

const joinSingleplayerBtn = document.getElementById("joinSingleplayer")
const joinMultiplayer = document.getElementById("joinMultiplayer")

const joinPopup = document.getElementById("joinPopup")
const joinError = document.getElementById("joinError")

const usernameInput = document.getElementById("usernameInput")
const roomIdInput = document.getElementById("roomInput")
const joinRoomBtn = document.getElementById("joinRoom")
const createRoomBtn = document.getElementById("createRoom")

const roomDatalist = document.getElementById("roomOptions");

recentRooms = []

function setRecentRoom(roomId) {
    try {
        let rooms = JSON.parse(localStorage.getItem("TuneBlast-RecentRooms")) || [];
        rooms = rooms.filter(room => room.roomId !== roomId);
        rooms.unshift({ roomId, date: Date.now() });

        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        rooms = rooms.filter(room => room.date >= oneDayAgo);

        localStorage.setItem("TuneBlast-RecentRooms", JSON.stringify(rooms));
    } catch (err) {
        console.error("Failed to save recent room:", err);
        localStorage.removeItem("TuneBlast-RecentRooms");
    }
}

try {
    const rooms = JSON.parse(localStorage.getItem("TuneBlast-RecentRooms")) || [];
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    recentRooms = rooms
        .filter(room => room.date >= oneDayAgo)
        .map(room => room.roomId);
} catch (err) {
    console.error("Failed to get recent rooms:", err);
    localStorage.removeItem("TuneBlast-RecentRooms");
}

roomDatalist.innerHTML = ""; // Clear previous options
recentRooms.forEach(option => {
    const item = document.createElement("option");
    item.value = option;
    roomDatalist.appendChild(item);
});


joinSingleplayerBtn.onclick = () => {
    window.location.href = "./play"
}

joinMultiplayer.onclick = () => {
    joinPopup.showModal()
}


function setSavedUsername(username) {
    localStorage.setItem("TuneBlast-Username", username)
}

function getSavedUsername() {
    return localStorage.getItem("TuneBlast-Username")
}

const savedUsername = getSavedUsername()
if (savedUsername) {
    usernameInput.value = savedUsername
}

function checkUsername(username) {
    if (username.trim().length === 0) {
        joinError.textContent = "Please enter a username."
        joinError.style.display = "block"
        return false
    }
    if (username.length > 20) {
        joinError.textContent = "Username must be 20 characters or less."
        joinError.style.display = "block"
        return false
    }
    if (username.length <= 2) {
        joinError.textContent = "Username must be at least 3 characters."
        joinError.style.display = "block"
        return false
    }

    if (/\s/.test(username)) {
        joinError.textContent = "Username cannot contain spaces."
        joinError.style.display = "block"
        return false
    }
    if (!/^[a-zA-Z0-9]+$/.test(username)) {
        joinError.textContent = "Username can only contain letters and numbers."
        joinError.style.display = "block"
        return false
    }

    const bannedUsernames = ["admin", "host", "server", "moderator", "administator"]
    // check if any part of username is these
    if (bannedUsernames.some(banned => username.toLowerCase().includes(banned)) || ["you", "me"].includes(username.toLowerCase().trim())) {
        joinError.textContent = "Username is not allowed."
        joinError.style.display = "block"
        return false
    }

    return true
}



roomIdInput.oninput = () => {
    let trimmed;
    if (roomIdInput.value.trim().includes("/room")) {
        trimmed = roomIdInput.value.trim().split("/room")[1]?.split("?")?.[1]?.trim()
    }
    roomIdInput.value = (trimmed || roomIdInput.value.trim()).toUpperCase()
}


joinRoomBtn.onclick = () => {
    if (!checkUsername(usernameInput.value.trim())) {
        return
    }
    setSavedUsername(usernameInput.value.trim())

    if (roomIdInput.value.trim().length !== 5) {
        joinError.textContent = "Room Not Found. Please enter a valid room ID, or create a new room."
        joinError.style.display = "block"
        return
    }

    setRecentRoom(roomIdInput.value.trim())
    window.location.href = `./room?${roomIdInput.value.trim()}`
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

createRoomBtn.onclick = async () => {
    createRoomBtn.disabled = true
    if (!checkUsername(usernameInput.value.trim())) {
        createRoomBtn.disabled = false
        return
    }
    setSavedUsername(usernameInput.value.trim())

    let { roomId } = await backendFetch("/api/v1/room/create")
    if (!roomId || roomId.length !== 5) {
        createRoomBtn.disabled = false
        joinError.textContent = "Failed to create room."
        joinError.style.display = "block"
        return
    }
    console.log("Created room:", roomId)
    setRecentRoom(roomId)
    window.location.href = `./room?${roomId}`

    createRoomBtn.disabled = false
}