# Tidyflux

<p align="center">
  A clean and beautiful web client developed based on Miniflux API
</p>

> 👋 **Preface**: I am a **complete novice who knows nothing about code**, this project was **completely written using Google Antigravity**. Special thanks to the powerful capabilities of AI, allowing imagination to no longer be limited by coding ability. Looking forward to AI helping more ordinary people realize their small ideas in the future! 🚀

[中文](README_ZH.md)

## Screenshots

### Desktop

![Desktop](docs/images/screenshot-desktop.png)

### Mobile

<div align="center">
  <img src="docs/images/screenshot-mobile-1.PNG" width="200" height="433">
  <img src="docs/images/screenshot-mobile-2.PNG" width="200" height="433">
  <img src="docs/images/screenshot-mobile-3.png" width="200" height="433">
</div>
<div align="center">
  <img src="docs/images/screenshot-mobile-4.PNG" width="200" height="433">
  <img src="docs/images/screenshot-mobile-5.PNG" width="200" height="433">
  <img src="docs/images/screenshot-mobile-6.PNG" width="200" height="433">
</div>

## Features

- 🎨 Modern three-column layout, supporting dark mode
- 📱 Support for mobile, tablet, and desktop
- 🌐 Bilingual interface (Chinese/English)
- 📥 Installable to desktop (PWA)
- ⌨️ Keyboard Shortcuts: Rich built-in shortcuts with customizable key bindings
- 💾 Save to Third-party Services: Save articles to Pocket, Instapaper, Wallabag, and other third-party services
- 🎧 Built-in podcast player, supporting background playback and progress control
- 🔄 Personalized settings and AI configuration cloud storage, automatic synchronization across multiple devices
- 🤖 **AI Enhanced Features**:
    - 🏷️ **Auto Title Translation**: Automatically translate feed titles to your target language, configurable per feed/category
    - 📝 **Auto Summarization**: Automatically generate AI summaries when opening articles, configurable per feed/category
    - 🌍 **Auto Full-Text Translation**: Automatically translate articles with bilingual side-by-side view, configurable per feed/category
    - 📅 **Smart Digest**: Support manual or scheduled generation of daily content digests, with Webhook push notifications (Slack, Discord, Telegram, etc.)
    - 💾 **Smart Cache**: All AI results (title translations, full-text translations, summaries) are cached in IndexedDB — zero token cost on repeat visits
    - ⚙️ **Custom AI Interface**: Support all OpenAI-compatible APIs

### Supported Operations

**feeds**: Add, Edit, Delete, Refresh, OPML Import/Export

**Articles**: Read, Search, Mark as Read/Unread, Star, Fetch Full Text, Save to Third-party Services

**Categories**: Create, Rename, Delete, Pin Categories

## Prerequisites

You need to install [Miniflux](https://github.com/miniflux/v2) first. This project is a web client for Miniflux.

## Quick Start

### I. Existing Miniflux, Deploy Tidyflux Independently

**Method 1: One-line Command Start**

```bash
docker run -d --name tidyflux --restart unless-stopped -p 8812:8812 -e TZ=Asia/Shanghai -v tidyflux_data:/app/server/data pehzerov/tidyflux:latest
```

After starting, visit `http://localhost:8812` and enter your Miniflux address, username, and password as prompted.

**Method 2: Docker Compose (Recommended)**

1. Download configuration file:

```bash
curl -O https://raw.githubusercontent.com/PehZeroV/tidyflux/main/docker-compose.yml
```

2. Edit `docker-compose.yml` to configure automatic login (optional):

```yaml
environment:
  - TZ=Asia/Shanghai
  - MINIFLUX_URL=https://Your Miniflux URL
  - MINIFLUX_API_KEY=Your Miniflux API Key  # Recommended
  # Or use username/password:
  # - MINIFLUX_USERNAME=Miniflux Username
  # - MINIFLUX_PASSWORD=Miniflux Password
```

3. Start service:

```bash
docker compose up -d
```

> 💡 **Tip**: If you use the scheduled digest generation feature, please set the correct timezone via the `TZ` environment variable (default is `Asia/Shanghai`).

**Default Account**:
- Address: `http://localhost:8812`
- Username: `admin`
- Password: `admin`
- *Recommended to change password after login*

### II. Fresh Deployment (Includes Miniflux + Tidyflux)

If you have not deployed Miniflux yet, you can deploy the full suite of services using the following steps.

1. Download full stack configuration file:

```bash
curl -o docker-compose.yml https://raw.githubusercontent.com/PehZeroV/tidyflux/main/docker-compose-with-miniflux.yml
```

> ⚠️ **Important Security Note**:
> Before starting, please be sure to edit `docker-compose.yml` and change `ADMIN_PASSWORD` (Miniflux password) and `MINIFLUX_PASSWORD` (TidyFlux connection password) to the **same strong password**.

2. Start all services:

```bash
docker compose up -d
```

**Service Information**:

- **Tidyflux (Reader)**: `http://localhost:8812`
  - Account: `admin`
  - Password: `admin` (Change after login)

- **Miniflux (Backend)**: `http://localhost:8080`
  - Account: `admin`
  - Password: The password you set in the `yml` file
