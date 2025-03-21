
import OpenAI from "openai";
const openai = new OpenAI();

const savedCategories = JSON.parse(fs.readFileSync('saved_categories.json', 'utf8'));



const openaiApiKey = process.env.OPENAI_API_KEY;
openai.apiKey = openaiApiKey;

async function openaiRequest({
    prompt,
    model = "gpt-4o-mini",
    systemMessage = "You are a helpful assistant.",
    temperature = 0.7,
    maxTokens = 4096,
    retries = 3,
    retryDelay = 1000,
    responseSchema = null
} = {}) {
    if (!prompt) {
        throw new Error('Prompt is required');
    }

    if (typeof prompt !== 'string') {
        prompt = JSON.stringify(prompt);
    }

    let attempt = 0;
    while (attempt < retries) {
        try {
            const completion = await openai.chat.completions.create({
                model,
                messages: [
                    { role: "system", content: [{ type: "text", text: systemMessage }] },
                    { role: "user", content: [{ type: "text", text: prompt }] }
                ],
                temperature,
                max_tokens: maxTokens,
                ...(responseSchema ? { response_format: { type: "json_schema", json_schema: responseSchema } } : {})
            });

            const responseContent = completion.choices[0]?.message?.content;
            if (!responseContent) {
                throw new Error('Invalid response format from OpenAI');
            }

            // If structured JSON was requested, parse it
            return responseSchema ? JSON.parse(responseContent) : responseContent;
        } catch (error) {
            attempt++;
            if (attempt === retries) {
                throw new Error(`OpenAI request failed after ${retries} attempts: ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
}



async function categorizeTracks(tracks) {
    const responseSchema = {
        "name": "song_categorization",
        "schema": {
            "type": "object",
            "properties": {
                "songs": {
                    "type": "array",
                    "description": "A list of songs, each containing details about the song.",
                    "items": {
                        "type": "object",
                        "description": "Details of a single song, including its name, ID, and category.",
                        "properties": {
                            "songName": {
                                "type": "string",
                                "description": "The name of the song."
                            },
                            "songArtist": {
                                "type": "string",
                                "description": "The artist(s) of the song."
                            },
                            "songId": {
                                "type": "string",
                                "description": "A unique identifier for the song."
                            },
                            "songCategory": {
                                "type": "string",
                                "description": "The category of the song, which can be one of the specified genres.",
                                "enum": [
                                    "Classics",
                                    "Throwback",
                                    "Pop",
                                    "HipHop"
                                ]
                            }
                        },
                        "required": [
                            "songName",
                            "songArtist",
                            "songId",
                            "songCategory"
                        ],
                        "additionalProperties": false
                    }
                }
            },
            "required": [
                "songs"
            ],
            "additionalProperties": false
        },
        "strict": true
    }

    // tracks = [
    //     {
    //         songName: "Stairway to Heaven",
    //         songArtist: "Led Zeppelin",
    //         songId: "5CQ30WqJwcep0pYcV4AMNc"
    //     },
    //     {
    //         songName: "Shake It Off",
    //         songArtist: "Taylor Swift",
    //         songId: "0cqRj7pUJDkTCEsJkx8snD"
    //     },
    //     {
    //         songName: "Hey Jude",
    //         songArtist: "The Beatles",
    //         songId: "0aym2LBJBk9DAYuHHutrIl"
    //     },
    //     {
    //         songName: "Lose Yourself",
    //         songArtist: "Eminem",
    //         songId: "5Z7n2k6d8WZ2m1Xk4Y3o9h"
    //     },
    //     {
    //         songName: "Billie Jean",
    //         songArtist: "Michael Jackson",
    //         songId: "4cQ0x1l6r6hJt5zj8v4j2H"
    //     }
    // ]

    let splitTracks = [];
    let currentBatch = [];

    let categorizedTracks = [];
    for (let i = 0; i < tracks.length; i++) {
        if (savedCategories[tracks[i].songId]) {
            categorizedTracks.push({
                songName: tracks[i].songName,
                songArtist: tracks[i].songArtist,
                songId: tracks[i].songId,
                songCategory: savedCategories[tracks[i].songId]
            });
        } else {
            currentBatch.push(tracks[i]);
        }
        if (currentBatch.length === 50 || i === tracks.length - 1) {

            splitTracks.push(currentBatch);
            currentBatch = [];
        }
    }
    for (let i = 0; i < splitTracks.length; i++) {
        console.log(`Categorizing ${splitTracks[i].length} songs, in batch ${i + 1} of ${splitTracks.length}`);
        let response = await openaiRequest({
            prompt: splitTracks[i],
            retries: 2,
            systemMessage: `
You are an expert in music classification. Given a list of song titles, your task is to assign each song to one of the following categories:
        
categories = {
    "Classics": "Timeless classics: The really old, legendary songs. Think Frank Sinatra, Elvis, The Beatles, Nat King Cole. Songs that older people love but are still known. (Example: 'Fly Me to the Moon,' 'Jailhouse Rock,' 'Bohemian Rhapsody').",
    "Throwback": "Throwback hits: The ‘80s, ‘90s, early 2000s hits that EVERYONE knows. Not ancient, but not new. (Example: Michael Jackson, Britney Spears, Backstreet Boys, early Eminem, Outkast, Red Hot Chili Peppers).",
    "Pop": "Modern hits: Everything big from ~2010 onward that isn’t rap. Pop, mainstream rock, EDM, radio/chart-topping music. (Example: Taylor Swift, Dua Lipa, Ed Sheeran, The Weeknd).",
    "HipHop": "Rap/Hip Hop: All rap-focused music, old and new. No mix-ups with pop. (Example: Kanye, Drake, Kendrick Lamar, Jay-Z, Lil Wayne)."
};

Example input format:
[
    { "songName": "Fly Me to the Moon", "songArtist": "Frank Sinatra", "songId": "92shasy3bdhaj28" },
    { "songName": "Billie Jean", "songArtist": "Michael Jackson", "songId": "ksjajsnh2837sok" },
    { "songName": "Blinding Lights", "songArtist": "The Weeknd", "songId": "msdkshansjvg274" },
    { "songName": "God's Plan", "songArtist": "Drake", "songId": "27ncuhakc6272ad" }
]

For each song, return only the song name, song artist, song id and its corresponding best fit category as a JSON object. Example output format:

[
    { "songName": "Fly Me to the Moon", "songArtist":"Frank Sinatra","songId": "92shasy3bdhaj28", "songCategory": "Classics" },
    { "songName": "Billie Jean", "songArtist":"Micheal Jackson","songId": "ksjajsnh2837sok", "songCategory": "Throwback" },
    { "songName": "Blinding Lights", "songArtist":"The Weeknd","songId": "msdkshansjvg274", "songCategory": "Pop" },
    { "songName": "God's Plan", "songArtist":"Drake","songId": "27ncuhakc6272ad", "songCategory": "HipHop" }
]

If a song is difficult to classify, make the best possible guess based on artist and release year. Do not include any explanations—just return the JSON response.

In general super old songs that some people wont know should be in Classics, but if they are super famous and most people(even young) should know them, they can be in Throwback. If a song is super new, it should be in Pop. If a song is rap, it should be in HipHop. If a song is a mix of genres, put it in the genre that is most prominent. If you are unsure, make your best guess.

It is ok to have almost all songs in one category, or very litte/none in some category. The only rule is they need to very much fit the category they are in. 
`, responseSchema: responseSchema
        });

        if (!response.songs) {
            throw new Error('Invalid response format from OpenAI');
        }
        categorizedTracks.push(...response.songs);
    }
    return categorizedTracks;
}

// let categorizedTracks = await categorizeTracks(tracks);
// for (let i = 0; i < categorizedTracks.length; i++) {
//     savedCategories[categorizedTracks[i].songId] = categorizedTracks[i].songCategory;
// }

let categorizedTracks = tracks;
// console.log(categorizedTracks);
// save saved categories
fs.writeFileSync('saved_categories.json', JSON.stringify(savedCategories, null, 2));