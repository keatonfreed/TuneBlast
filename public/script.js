

const joinSingleplayerBtn = document.getElementById("joinSingleplayer")
const joinMultiplayer = document.getElementById("joinMultiplayer")

const joinPopup = document.getElementById("joinPopup")

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