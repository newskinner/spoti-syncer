# Spoti Syncer

This tool is intended for Telegram-Spotify linking thru your channel.

# The purpose

I've made it primarily for myself.

# How to use?

- You need to create your app via the Spotify Dashboard (devtools). Use https://developer.spotify.com/dashboard
- You need to create your own <i>.env</i> file in the root directory and set up the values. Example is in .env.example

- You can go to your bot and type <code>/auth</code> command
- Paste the code using <code>/code HERETHECODE</code>
- The program will immediately start synchronizing all the music it can find in "Liked Songs" playlist.
- If there's a trouble with network, the program will relaunch itself.

Type <code>npm install</code>, then <code>npm start</code> and press Enter.
