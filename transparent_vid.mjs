import { spawn } from "child_process";
import fs from "fs";
import readline from "readline";

// Get list of .mp4 files
const files = fs.readdirSync(".").filter(file => file.endsWith(".mp4"));

if (files.length === 0) {
    console.log("No MP4 files found.");
    process.exit(1);
}

// Prompt user for file selection
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("Select a video:");
files.forEach((file, index) => console.log(`[${index + 1}] ${file}`));

rl.question("Enter the number: ", (num) => {
    const index = parseInt(num, 10) - 1;
    if (isNaN(index) || index < 0 || index >= files.length) {
        console.log("Invalid selection.");
        rl.close();
        return;
    }

    const inputVideo = files[index];
    const outputVideo = inputVideo.replace(".mp4", "_transparent.webm");

    console.log(`Processing: ${inputVideo} -> ${outputVideo}`);

    const ffmpegArgs = [
        "-i", inputVideo,
        "-vf", "colorkey=black:0.05:0.15",
        "-c:v", "prores_ks",
        "-profile:v", "3",  // ProRes 4444 (supports transparency)
        "-speed", "4",  // VP9 speed boost (0 = best quality, 4 = fast)
        outputVideo.replace(".webm", ".mov")
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    ffmpeg.stdout.on("data", data => console.log(data.toString()));
    ffmpeg.stderr.on("data", data => console.log(data.toString())); // FFmpeg logs here

    ffmpeg.on("close", (code) => {
        rl.close();
        if (code === 0) {
            console.log(`✅ Done! Video saved as ${outputVideo}`);
        } else {
            console.error(`❌ FFmpeg exited with error code ${code}`);
        }
    });
});