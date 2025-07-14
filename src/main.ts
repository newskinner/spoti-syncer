import * as SpottyDL from "spottydl";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import SpotifyWebAPI from "spotify-web-api-node";
import strings from "./strings";
import { Telegraf } from "telegraf";
import os from "os";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const config = {
  spotifyClientID: process.env.SPOTIFY_CLIENT_ID!,
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
  telegramBotKey: process.env.TG_BOT_KEY!,
  telegramSyncChannelID: process.env.TG_CHANNEL_ID!,
  globalSyncPeriodSec: parseInt(process.env.GLOBAL_SYNC_SEC || "60"),
  telegramAdminID: parseInt(process.env.TG_ADMIN_ID || "0"),
};

const spotifyApi = new SpotifyWebAPI({
  clientId: config.spotifyClientID,
  clientSecret: config.spotifyClientSecret,
  redirectUri: "http://127.0.0.1:8888/copyThisCode",
});

const bot = new Telegraf(config.telegramBotKey, { handlerTimeout: 9_000_000 });
const channelID = config.telegramSyncChannelID;
const dirPath: string = os.tmpdir();
const tokenPath = path.join(__dirname, "spotify-token");
const publishedPath: string = path.resolve(__dirname, "../published.txt");
const scopes = ["user-library-read", "playlist-read-private"];
let isRunning = true;

const delay = (sec: number) =>
  new Promise((resolve) => setTimeout(resolve, sec * 1000));

const getLikedSongs = async (): Promise<SpotifyApi.SavedTrackObject[]> => {
  const allTracks: SpotifyApi.SavedTrackObject[] = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    try {
      const response = await spotifyApi.getMySavedTracks({ limit, offset });
      allTracks.push(...response.body.items);
      if (!response.body.next) break;
      offset += limit;
    } catch {
      await delay(5);
    }
  }
  return allTracks.reverse();
};

const findNewSongs = (
  oldSongs: SpotifyApi.SavedTrackObject[],
  newSongs: SpotifyApi.SavedTrackObject[]
): SpotifyApi.SavedTrackObject[] => {
  const oldIds = new Set(oldSongs.map((item) => item.track.id));
  return newSongs.filter((item) => !oldIds.has(item.track.id));
};

let prevLiked: SpotifyApi.SavedTrackObject[] = [];

const downloadSong = async (
  song: SpotifyApi.SavedTrackObject
): Promise<boolean> => {
  try {
    const songUrl: string = song.track.external_urls.spotify;
    const songInfo = await SpottyDL.getTrack(songUrl);
    if (typeof songInfo === "string") return false;
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
    await SpottyDL.downloadTrack(songInfo, dirPath);
    return true;
  } catch {
    return false;
  }
};

const saveRefreshToken = (data: any) => {
  fs.writeFileSync(tokenPath, data.refresh_token, "utf-8");
};
const loadRefreshToken = (): string | null => {
  if (fs.existsSync(tokenPath)) {
    return fs.readFileSync(tokenPath, "utf-8");
  }
  return null;
};
const refreshAccessToken = async () => {
  const refreshToken = loadRefreshToken();
  if (!refreshToken) throw new Error("No refresh token found");
  spotifyApi.setRefreshToken(refreshToken);
  const data = await spotifyApi.refreshAccessToken();
  spotifyApi.setAccessToken(data.body.access_token);
};

const mainLoop = async () => {
  while (isRunning) {
    try {
      console.log("\nSetting up the token.");
      await refreshAccessToken();
      console.log("Fetching your liked songs.");
      const currentLiked = await getLikedSongs();
      const newSongs = findNewSongs(prevLiked, currentLiked);
      if (newSongs.length > 0 && prevLiked !== currentLiked) {
        fs.readFile(publishedPath, async (err, data) => {
          if (err) throw err;
          for (const song of newSongs) {
            if (data.includes(song.track.id)) {
              console.error("Skipping, this track already exists.");
              continue;
            }
            const meta = `${song.track.artists[0].name} - ${song.track.name} (${song.track.album.name})`;
            console.log(`Downloading ${meta}`);
            try {
              if (await downloadSong(song)) {
                await bot.telegram.sendAudio(channelID, {
                  source: path.join(dirPath, `${song.track.name}.mp3`),
                });
                fs.appendFile(
                  publishedPath,
                  `${song.track.id}\n`,
                  { encoding: "utf-8" },
                  () => {}
                );
                console.log(`${meta} has been published to the channel`);
                fs.unlink(
                  path.join(dirPath, `${song.track.name}.mp3`),
                  () => {}
                );
                console.log(`${meta} file has been unlinked (removed) locally`);
              }
            } catch (e) {
              console.error("Got an error when downloading:", e);
              continue;
            }
          }
        });
      }
      prevLiked = currentLiked;
      await delay(config.globalSyncPeriodSec);
    } catch {
      await delay(10);
    }
  }
};

bot.start(
  async (ctx) => await ctx.reply(strings.hello, { parse_mode: "HTML" })
);
bot.help(async (ctx) => await ctx.reply(strings.help, { parse_mode: "HTML" }));
bot.command("auth", async (ctx) => {
  if (ctx.chat.id !== config.telegramAdminID) return;
  const url = spotifyApi.createAuthorizeURL(scopes, "telegram_auth");
  await ctx.reply(
    `<a href="${url}">${url}</a>\nThen use:\n<code>/code YOUR_CODE</code>`,
    { parse_mode: "HTML" }
  );
});
bot.command("code", async (ctx) => {
  if (ctx.chat.id !== config.telegramAdminID) return;
  const parts = ctx.message.text.split(" ");
  if (parts.length !== 2) {
    await ctx.reply("Usage: /code YOUR_SPOTIFY_CODE");
    return;
  }
  const code = parts[1].trim();
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    spotifyApi.setAccessToken(data.body.access_token);
    spotifyApi.setRefreshToken(data.body.refresh_token);
    saveRefreshToken(data.body);
    await ctx.reply("Authorized. Sync starting...");
    await mainLoop();
  } catch (e) {
    console.error("Auth fail", e);
    await ctx.reply("Failed to authorize.");
  }
});

process.once("SIGINT", () => {
  isRunning = false;
  bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
  isRunning = false;
  bot.stop("SIGTERM");
});

bot.launch();
