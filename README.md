# Tavvy

**English** · [한국어](README.ko.md)

A tiny companion that lives in your SillyTavern chat room.
A little stand-in for your character moves into the chat and grows closer to you the more time you spend together.

> Still growing. What works right now is listed under "What it does" below.

## Install

1. In SillyTavern, open **Extensions → Install extension**.
2. Paste this address and install:
   ```
   https://github.com/Near7707/Tavvy
   ```
3. In the extension settings, expand **Tavvy** and press **Open Tavvy**, or press **Pet info** in the ✨ wand menu left of the input box.

## Getting started

1. Open the chat your pet will live in.
2. In the Tavvy window, press **New pet**, pick a name, a look and a personality, then press **Create**.
   Choose a starter pet or one of **My uploaded looks**. To use your own picture, choose **Upload new → Choose picture**.
   Uploaded pictures stay in "My uploaded looks", so next time you can just pick them.
3. **Tap** the 🛏️ button that appears on screen to wake your pet. Tap again and it waves and goes back to bed.
4. **Drag** the 🛏️ button to move it. Phone and PC positions are remembered separately.
5. **Drag a pet** to pick it up and it dangles; let go and it falls. If there's a message on the way, it lands on top of it.
   If a pet ever gets stuck while held, tap it once.

## Language

Tavvy speaks Korean and English. It uses Korean when SillyTavern's or your browser's language is Korean, and English otherwise.
You can pick it yourself at the top of ⚙ Settings (**언어 · Language**); the change applies after you reload the page.
Text you write yourself (pet names, lines, notes) is never translated. In English the starter pets are called Mochi · Barley · Button, and AI-written lines come out in English.

## What it does (0.11.20)

- **Making a pet**: three starter pets (Mochi · Barley · Button) or one picture of your own (PNG · JPG). A plain one-color background, like white, is removed automatically (**Remove background**, with a strength slider in the preview). **Crop by hand** lets you cut just the character out of a bigger picture.
- **Five base personalities**: Sweet · Prim · Easygoing · Grumpy · Aloof. Walking, dozing, greetings, eating and how it reacts to you all differ by personality. When it reacts to you, it looks at you for a moment first and holds the reaction a little; at most once every 30 seconds (0.11.7).
- **Free tuning (Actions tab)**: the personality is only a starting point; change anything per pet. Changes save right away.
  - **Frequency** for each everyday behavior (Climb the screen · Fly · Dash · Portal · Climb messages · Doze · Humming · Looking around · Sit · Pretending to read · Sudden runs · Peekaboo · Roll · Reacting to you · Spacing out) and each learned one: **Off / Rarely / Normal / Often**. Normal follows the personality, Rarely is about half, Often about double.
  - **Walking speed**: Slow / Normal / Fast.
  - **How it treats you** (off at first):
    - **Tagging along**: tap the screen and it walks over there.
    - **…where did you go?**: leave SillyTavern for over 5 minutes and it comes to the middle and stares at you.
    - **Staring while you type**: when you start typing it comes next to the input box and watches.
  - **Reaction style**: When woken · When patted · Reacting to you · When eating · Landing · bumping · When you send · When put to bed. Pick which personality it reacts like at each moment, and mix freely (e.g. 💢 like Grumpy when patted, ♥ like Sweet when it looks at you).
  - **Reset** puts everything back to the base personality.
- **Home room**: a pet lives in the chat it was made in and only shows up there. In other rooms it's put to bed automatically.
  - **Bring to this room**: open the room you want, find the pet under "Pets in other rooms" and move it. Records, closeness and waiting food come along. If you rename a chat, its pet follows by itself. A chat made with **Import chat** (a copy of the old one) is not followed (0.11.5) — move or copy the pet there if you want. Known limit: a chat imported into a different character may still be taken for a rename.
  - **Copy into this room**: makes one more of that pet here. Look, personality, lines and anniversaries are copied; turn on "Copy records and closeness too" to copy its history as well.
- **Pet files and PNG cards** (Style tab → **Export**, and **Import** on the first screen):
  - **Pet file** (.json): a full backup with pictures and records. Importing it adds a new pet to the current room.
  - **PNG card**: a single picture that carries only the look and action pictures (no name, lines or records). Importing it adds it to "My uploaded looks".
  - Room info is never included. Messengers and photo apps may strip the data inside a card, so send it as a file.
- **The bed button**: tap = wake / sleep, drag = move.
- **Life on the floor** (above the input box): breathing, walking, dozing, dangling when held, falling when dropped.
  - Playing alone: humming, looking around, pretending to read (walking slowly along a message, looking down), sudden runs, peekaboo at the edge of the screen, rolling. All of these use the pictures it already has. Add a **Sit** picture and it sometimes sits down to rest.
  - **Climb the screen**: now and then it turns its back and climbs up the screen, pull by pull, then drops off, climbs back down, or lands on a message. It never naps on the screen. Turn it off with **Roam around the screen** in ⚙ Settings.
  - **Fly · Dash · Portal**: choose per pet how it gets around on the screen (Actions tab). **Climb**, **Fly** (floats in soft curves, leaning the way it goes), **Dash** (darts, stops, darts again, leaving afterimages) or **Portal** (0.11.3: a swirling door opens on the floor, it walks in (0.11.9: walks right through it — gone past the door's middle with a soft edge, the door lights up a little (0.11.11) and the pet wobbles a little), and comes out of another door somewhere else — on the floor, on top of a message, or up in the air and drops down; the door is a glowing blue ring, dark inside; off at first). After a trip it waits for the **Rest between screen trips** (1 / 3 / 5 / 10 min) before going up again.
  - Once it dozes off it sleeps a good while; sending or receiving messages doesn't wake it (a tap does).
- **The whole chat is a stage**: the tops of message bubbles are ledges (in line-style chats, the borders between messages).
  - **Windows on the same screen** (0.11.17): a panel sharing the chat column — another extension's panel above the input box, a small floating window over the chat — is a ledge too. Pets climb onto its top edge, walk, sit and doze there, and fall when it closes. Windows that hide most of the chat (menus laid over it) are skipped, and so are windows pinned beside the chat on PC (outside the column pets live in).
  - It hops up onto messages, walks along them, pauses at the edge and jumps off.
  - It scrolls with the message it's standing on; if the message leaves the screen, it disappears too and drops back in from the top a moment later.
- **Waiting for replies**: while a reply is being written it sometimes climbs onto it and waits with a "?". Every 7–12 seconds or so it takes a few steps, hums, or dozes if it takes long, and once in a while hops; otherwise it just waits. When a long reply arrives it climbs up to look.
- **Spacing out (loading)** (Actions tab): now and then it stops and a small loading wheel spins over its head for 3–10 seconds. It happens about three times as often while the AI is writing.
- **With two or more pets** (each one Off / Rarely / Normal / Often in the Actions tab; all just for show, nobody's records change):
  - **Bumping**: pets walking into each other sometimes bump and react by personality. **Going over to talk**: it walks over to another pet to chat.
  - **Good night**: when a nearby pet starts dozing, its neighbor says something (or reacts by personality if the "When another pet dozes" line is empty).
  - **Napping together**: it snuggles up next to a dozing pet and dozes too.
  - **Chase game**: one pet taps another and runs off; the other chases it or just reacts.
  - **Racing there first**: when a long reply arrives, pets on the floor race toward it. The winner goes "!", the loser reacts by personality.
  - **Sharing food**: a pet that's done eating goes over to one that's still eating and gets a pretend bite.
- **Seeing off your messages**: when you send a message it sometimes looks over and reacts by personality.
- **Food (eating the chat)**: while the extension is on, new messages (new replies, your messages, messages added by commands) become food. Regenerations, swipes, continues and first messages don't count.
  - Awake pets eat the sparkles flying out of messages right away (yours and theirs are different colors). Dozing pets save them for later.
  - While asleep, food piles up in the bowl and the count shows on the bed. Wake it and it eats it all at once: snack / meal / big bowl (nap after) / feast (nap → dance → full).
  - Eat over 100 in a day or finish a feast and it's full: it pats its tummy ♪ and rolls around. It resets at 6 a.m.
- **Daily backups**: once a day your pet data is backed up to SillyTavern's user files folder (last 7 kept); restore one in ⚙ Settings → **Backups**.
- **Closeness**: grows with messages eaten together and pats. Acquaintance ♡ → Friend ♥ → Close friend ♥♥ → Best friend ♥♥♥ → Always yours ♥♥♥♥.
  - The closer you are, the more it waits for and watches replies, climbs onto messages and reacts to you.
  - **Tap** a pet to pat it. Pats count toward closeness once a day. Prim and Grumpy pets 💢 at rapid taps, but closeness never goes down.
  - When closeness goes up it dances in colorful ✦ with "Closer now!".
- **Reunions**: woken up, it looks around, spots you ("!") and greets you by personality. After a long time apart the greeting is longer; very close pets may even tear up. After 3+ days away, it has a word for you by the bed.
- **The Tavvy window**: pet list, journal, new pets and settings in one place. Open it from **Pet info** in the wand menu or **Open Tavvy** in the extension settings.
  - Each pet has **Journal** (days together, days chatted, messages exchanged, tokens eaten, biggest meal day, progress to the next stage, milestones) / **Actions** / **Style** (name, what it calls you, base personality, size, look, which way the picture faces, squishiness, sounds, export, say goodbye) / **Art** / **Lines** / **Presents**.
  - Window color: **Follow theme / Cream · pink / Clean white / Night sky**.
  - On phones, tapping a text field opens a small input box at the top of the screen so the keyboard doesn't push the window around.
- **Art tab** (your own pictures per action):
  - Fill slots under "Common actions" (Basic · Walk · Held · Dance · Doze · Cry) and the folded groups (More movement / Reactions / Rest · eat / Special moments). Empty slots use the basic picture + movement instead.
  - Up to 8 pictures per action play in turn. Speed per action: Slow / Normal / Fast (walking changes per step, eating per bite). Each action can face its own way, so front and side pictures can be mixed.
  - Pick one picture to **Crop · split** it in the preview: crop one part, or split a sprite sheet into several pictures (**Find automatically** or **Grid**).
  - **Add from a sheet**: split one sheet and choose an action for each picture (or a whole row at once).
  - **Example for making pictures with an AI** (0.11.7, folded box at the bottom of the Pictures tab): an example to paste into a picture AI, with a **Copy** button. Write the look inside [ ]. Since 0.11.14 it is two sheets of 6 (3 × 2) — fewer pictures per sheet come out bigger. Tavvy itself never calls an AI.
    ```
    Sprite sheet of one small chibi character: [describe your character here].
    Same character in every frame, full body, same size and scale.
    3 columns x 2 rows grid, clear empty space between frames,
    plain white background, no text, no numbers.
    Row 1: standing (front), walking (side view) x2
    Row 2: sleeping, sitting, eating
    ```
    ```
    Another sprite sheet of the same character as the first sheet: [describe your character here].
    Same look, same size and scale as the first sheet, full body.
    3 columns x 2 rows grid, clear empty space between frames,
    plain white background, no text, no numbers.
    Row 1: happy, angry, surprised
    Row 2: curious, looking up, waving
    ```
    - For sheet 2, ask in the same chat as sheet 1 or attach the sheet 1 picture so the look matches. Need other actions? Change the Row lines and make more sheets.
    - Space between pictures helps auto-find; otherwise split by 3 × 2. Walking looks best from the side; use a one-colour background.
  - **Match height** scales pictures so the character's height matches the basic picture; you can fine-tune with a slider, now or later.
  - **Tap tap** (Reactions): shown while it hops after a click or tap.
  - Pictures you add are saved with the uploaded look, so new pets made with that look get them too (for starter looks, only this pet).
- **Lines tab**:
  - When woken / When put to bed / When patted / After a meal / Playing alone / Waiting for a reply / When a reply is late / Growing closer / Reunion after a while / When a reply arrives / When you send / Talking to another pet / When another pet talks to it / When another pet dozes. Write one line per row; one is picked each time and said in a bubble above the pet (up to 40 characters; `{{user}}` becomes what it calls you — set per pet in the Style tab, 0.11.14; empty = your SillyTavern name, `{{pet}}` the other pet's name).
  - **Noticing what you do** (0.11.17): Writing and erasing (more than 20 characters erased within 3 s, or writing over a minute without sending) / Sending a very long message (over 500 characters) / Swiping / Regenerating / Editing a message / Deleting a message / Reading old messages (scrolled up more than three screens) / Opening a menu (Character list, World Info, AI settings, Connections, Persona, Background, Formatting — it says one of that menu's lines or one of the common "Opening a menu" lines; `{{menu}}` becomes the menu's name; the Extensions menu isn't noticed) / Back from another chat (woken within 10 minutes of leaving; longer → the usual hello). These boxes come with **default lines for each personality**: an empty box uses them (shown in grey), and lines you write replace them. One pet speaks at a time, and the same thing isn't remarked on again within a minute. It can't see other programs or browser tabs — only what happens in SillyTavern.
  - The tab is folded into groups, one open at a time, each showing how many boxes are written: Everyday / Messages (writing → sending → waiting → replies → afterwards) / Looking around (+ Per menu) / With other pets (+ talks) / Special moments.
  - How often it talks: Off / Sometimes (default) / Often. Moments without default lines stay quiet until you write some.
  - **Fill empty slots with AI**: runs once, only when pressed, sending just the pet's name and personality. Choose the connection in ⚙ Settings → "Connection used for AI lines" (SillyTavern Connection Manager profiles).
- **Places together** (Journal tab): each room it lives in gets an entry automatically: the character's name (or group name), the dates, and the messages it ate there. Edit, remove, or add earlier places by hand. Not included in pet files or PNG cards (they contain room names).
- **Pets talking to each other** (two or more pets in a room):
  - When two pets meet on the same ledge, or after a bump, they trade lines: "Talking to another pet" from one, "When another pet talks to it" from the other.
  - **Talks with other pets** (bottom of the Lines tab, one box per roommate): write `Name: line` per row, with a blank line between talks (up to 4 lines per talk, 30 talks per pair). **Make 10 more with AI** adds more, only when pressed.
- **Anniversaries** (Lines tab): the day you met (yearly, can be turned off), plus My birthday / Character's birthday / Anniversary. On the day, "Something to say!" appears by the bed; wake it and it dances in ✦ and says its message. Missed it? Within 7 days it says "A bit late, but…".
- **Presents tab**:
  - **Give a present**: pick a picture (PNG · JPG) and it becomes that pet's present (up to 6 per pet). **Give now** closes the window and hands it over; **Save for later** keeps it and lets you pick the next one.
  - A ribboned box drops in when you close the window (or when you wake the pet). The pet taps it open and greets the present by personality.
  - From then on it sometimes takes presents out to **look at, roll around, toss and catch, show off, hold out to you, or sleep with**. Set how often in the Actions tab. On messages it only rolls them when there's plenty of room, and stops before the edge.
  - **Favorite present**: press ♡ on a present to make it the favorite (only one). It's picked more often and is the one it hugs to sleep.
  - Each present has a size, name, notes (just for you), **Take it out**, **Edit picture**, and **Remove**.
- **Unlocks as you grow closer** (announced when the stage goes up):
  - ♥ Friend: peeks at the input box when you type / watches your hand or cursor.
  - ♥♥ Close friend: the bed wiggles while food piles up / likes climbing onto your messages.
  - ♥♥♥ Best friend: fusses for a second at bedtime / dozes on your last message when you're idle, waking when you type.
  - ♥♥♥♥ Always yours: softer reactions / Sweet pets hold out a clover to wish you luck.
- **Settings (⚙)**: language, window color, wake pets automatically when entering a room, stage (whole chat / floor only), line borders as ledges, food count on the bed, closeness display, wake button position, backups.
- **Sounds** (⚙ Settings, off by default): **Reply arrival alert** and **Pet sounds** turn on separately.
  - **Sound style** (0.11.19, ⚙ Settings → Sounds): **Crisp** (default, the sounds so far) / **Soft** (round tones that fade in and out slowly, with a little echo). Switches pet sounds (pop, wake, sleep, cheer, boop, mumble, heart Glint and Tink) and reply sounds (Ding-dong, Bell, Tap tap, Marimba, Arrival, Music box, Flute, Xylophone) together. The rest (Boing, Boing-up, Pop, Letter bell, Twinkle, Wind chime) and your own files stay as they are. Soft sounds ring a little longer (up to about 2 s), and other sounds are skipped meanwhile.
  - Pet sounds: heart (each pet picks Pop, Glint, Tink or Boing-up since 0.11.16 — Style tab → Sounds → Heart sound), wake, sleep, cheer, boop (bumping), mumble (pets chatting). Each pet picks its chat voice, Mumble or Boing (0.11.15, Style tab → Sounds → Voice; Mumble at first; its own sound file still comes first).
  - Reply arrival alert: plays when a new reply, regeneration, swipe or continue finishes (in rooms with a pet, even while it sleeps). The checked sounds out of 12 take turns; preview with ▶, and add up to 10 of your own sound files.
  - Sounds are generated in code, need no files, with separate volumes for pet sounds and the reply sound (0.11.8). The 12 built-in reply sounds are level-matched (0.11.13: Xylophone and Wind chime replace Whistle and Boop; everything is 3.3× louder than before — use the sliders if it’s too much). Under Reply volume, one line tells whether the last reply sound played or why it was skipped. No sounds on other tabs; on phones they start after your first tap (after another app or the screen going off, the first tap makes the sound fresh — 0.11.10; if it is still silent, press a ▶ try-out button once). iPhones in silent mode stay silent.
  - **My sound**: in the Style tab, upload a sound file per pet (mp3 · wav · ogg · m4a, up to 5 s since 0.11.18, 3 s before) to replace a sound.

## Where is my data stored?

- Pet data is stored, small, inside SillyTavern's **extension settings**. Your chats are never changed.
- Pictures and sounds you upload go to SillyTavern's user files folder. Uploaded looks stay after saying goodbye to a pet, and their files are deleted when you delete the look in Settings.
- Requests go to the AI only when you press an AI button (just names and personalities). Otherwise no AI is used.
- Daily backups go to the same folder as `tavvy_backup_<date>.json` (last 7 kept).
- If the saved data was written by a newer Tavvy or looks wrong, Tavvy stops saving instead of overwriting it and tells you in the Settings window.

## License

[GNU AGPL v3](LICENSE)

The starter pet art (Mochi · Barley · Button) shows original characters made for this project.
