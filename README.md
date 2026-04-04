# VoiceBot — User Guide

VoiceBot automatically creates temporary voice channels for you and your friends.
Simply join a lobby channel and the bot will create a private room and move you in instantly.
When everyone leaves, the channel is cleaned up automatically.
Made to remove clutter.

---

## Getting Started

1. Find a channel to make "dynamic" (e.g. [+] New Channel)
2. Join it like any normal voice channel
3. The bot will instantly create a new channel and move you in
4. Use the new channel as any other.

That's it — no commands needed to use the basic functionality!

---

## Server Admin Commands

All commands below require the **Manage Server** permission.

### Initial Setup

Before the bot does anything, an admin needs to configure at least one lobby channel:

/vb setup #channel
Users who join this channel will automatically get their own voice room.

To disable the bot on your server:
/vb remove
---

### Managing Lobby Channels

You can have multiple lobby channels, each with different settings:
/vb addchannel #channel
Adds a lobby channel using the random name pool for created rooms.
/vb addchannel #channel amount 2
Adds a lobby channel where created rooms are limited to 2 users.
/vb addchannel #channel amount 2 name Duos
Adds a lobby channel with a 2 user limit and names all created rooms "Duos".
/vb removechannel #channel
Removes a lobby channel configuration.
/vb listchannels
Shows all configured lobby channels, their user limits and naming mode.

---

### Managing Room Names

The bot can pick random fun names for created rooms. You manage the pool with:
/vb addname Bowling Sex 🎳
Adds a name to the random pool.
/vb listnames
Shows all names currently in the pool, numbered.
/vb removename 3
Removes name number 3 from the pool.

The bot will never pick the same name twice in a row, cycling through all names before repeating.

---

### Name Templates

If you prefer dynamic names based on the user or room number instead of a random pool:
/vb setname {user}'s Room

Available placeholders:

| Placeholder | Result |
|---|---|
| `{user}` | The display name of the user who joined |
| `{number}` | An incrementing room number |

**Examples:**

| Template | Result |
|---|---|
| `{user}'s Room` | Scayn's Room |
| `Room #{number}` | Room #3 |
| `🔊 {user}` | 🔊 Scayn |

> Note: Templates are only used when no random name pool has been set up.

---

## Example Setup

Here's a recommended setup for a gaming server:
/vb addchannel #[+]General
/vb addchannel #[+]Duos amount 2 name Duos
/vb addchannel #[+]Trios amount 3 name Trios
/vb addchannel [+]Quads amount 4 name Quads
/vb addname Mercury Addicts
/vb addname {user} Channel {number}
