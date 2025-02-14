

const joinSingleplayerBtn = document.getElementById("joinSingleplayer")
const joinMultiplayer = document.getElementById("joinMultiplayer")

const joinPopup = document.getElementById("joinPopup")
const joinError = document.getElementById("joinError")

const usernameInput = document.getElementById("usernameInput")
const roomIdInput = document.getElementById("roomInput")
const joinRoomBtn = document.getElementById("joinRoom")
const createRoomBtn = document.getElementById("createRoom")



joinSingleplayerBtn.onclick = () => {
    window.location.href = "./play"
}

joinMultiplayer.onclick = () => {
    joinPopup.showModal()
}


function checkUsername() {
    if (usernameInput.value.trim().length === 0) {
        joinError.textContent = "Please enter a username."
        joinError.style.display = "block"
        return true
    }
    if (usernameInput.value.length > 20) {
        joinError.textContent = "Username must be 20 characters or less."
        joinError.style.display = "block"
        return true
    }
    if (usernameInput.value.length <= 2) {
        joinError.textContent = "Username must be at least 3 characters."
        joinError.style.display = "block"
        return true
    }

    if (!/^[a-zA-Z0-9]+$/.test(usernameInput.value)) {
        joinError.textContent = "Username can only contain letters and numbers."
        joinError.style.display = "block"
        return true
    }

    const bannedUsernames = ["admin", "host", "server", "moderator", "administator"]
    // check if any part of username is these
    if (bannedUsernames.some(banned => usernameInput.value.toLowerCase().includes(banned))) {
        joinError.textContent = "Username is not allowed."
        joinError.style.display = "block"
        return true
    }

    return false
}


joinRoomBtn.onclick = () => {
    if (checkUsername()) {
        return
    }
    if (roomIdInput.value.trim().length === 0) {
        joinError.textContent = "Please enter a room ID."
        joinError.style.display = "block"
        return
    }
}



createRoomBtn.onclick = () => {
    if (checkUsername()) {
        return
    }

    window.location.href = `./play?username=${usernameInput.value}`
}