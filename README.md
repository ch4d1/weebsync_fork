# WeebSync

[![CI](https://github.com/BastianGanze/weebsync/actions/workflows/ci.yml/badge.svg)](https://github.com/BastianGanze/weebsync/actions/workflows/ci.yml)
[![Build](https://github.com/BastianGanze/weebsync/actions/workflows/build-and-publish.yml/badge.svg)](https://github.com/BastianGanze/weebsync/actions/workflows/build-and-publish.yml)
[![Release](https://github.com/BastianGanze/weebsync/actions/workflows/release.yml/badge.svg)](https://github.com/BastianGanze/weebsync/actions/workflows/release.yml)
[![GitHub Container Registry](https://img.shields.io/badge/ghcr.io-weebsync-blue)](https://github.com/BastianGanze/weebsync/pkgs/container/weebsync)

## Getting started

### Quick Start Options

#### Option 1: Native Binaries

Download the appropriate native binary for your system from the [latest release](https://github.com/BastianGanze/weebsync/releases/latest):

- **Linux**: `weebsync-linux-x64` or `weebsync-linux-arm64`
- **Windows**: `weebsync-win-x64.exe`
- **macOS**: `weebsync-macos-x64` (Intel) or `weebsync-macos-arm64` (Apple Silicon)

Then run:

```bash
# Linux
chmod +x weebsync-linux-*
./weebsync-linux-x64

# macOS
chmod +x weebsync-macos-*
./weebsync-macos-arm64

# Windows
weebsync-win-x64.exe
```

#### Option 2: Docker (recommended)

##### docker-compose

Create a `docker-compose.yml`:

```yaml
services:
  weebsync:
    image: ghcr.io/bastianganze/weebsync:latest
    container_name: weebsync
    ports:
      - 42380:42380
    volumes:
      - ./config:/app/config
      - ./plugins:/app/plugins
      - /path/to/media:/media
    restart: unless-stopped
```

Then run:

```bash
docker compose up -d
```

##### docker cli

```bash
docker run -d --name weebsync \
  -p 42380:42380 \
  -v ./config:/app/config \
  -v ./plugins:/app/plugins \
  -v /path/to/media:/media \
  --restart unless-stopped \
  ghcr.io/bastianganze/weebsync:latest
```

Available tags from GitHub Container Registry:

- `latest` - Latest stable release
- `v0.8.0` - Specific version
- `nightly` - Nightly build from master

Multi-architecture support: `linux/amd64`, `linux/arm64`

Once the executable is running, you can access the ui by opening a browser and going to <http://0.0.0.0:42380>.
(Or another port if you changed it.)

## Application configuration

The application will attempt to create a "config" folder in its executables' directory.
To overwrite where the configuration is being stored you can use the env variable `WEEB_SYNC_CONFIG_DIR` but it must be an absolute path!

Further application behaviour can be configured through environment variables:

### WEEB_SYNC_CONFIG_DIR

The application will attempt to create the directory and config file upon startup.
Set this do an absolute value e.g. `/home/user/weebsyncconfig` or `c:/users/user/AppData/local/weebsync`.
If you don't set this, a config dir will be created automatically at the executables' directory.

### WEEB_SYNC_PLUGIN_DIR

The application will attempt to load plugins from this directory.
Set this do an absolute value e.g. `/home/user/weebsyncconfig` or `c:/users/user/AppData/local/weebsync`.
If you don't set this, a plugin folder may be created next to the executable.

### WEEB_SYNC_SERVER_HTTP_PORT

default value is `42380`
Determines on what port the application will run.

### WEEB_SYNC_SERVER_HOST

default value is `0.0.0.0`
Determines on what host the application will bind to.

## Rename regex feature

In the sync maps you can setup a filename regex and a rename template.
The filename regex will be matched to every file in the origin folder and changes download behaviour: Only files matching will be downloaded:

### Regex

example:

```regexp
.*? E([0-9][0-9]|[0-9]|[0-9]\\.[1-9]|[0-9][0-9]\\.[0-9])v?(.)? (.*)?\.extension
```

This will match `Test E1 [metadata].extension` but also `Test E1v3 [metadata].extension`.

To build regex visually try <https://www.debuggex.com/>.

### Rename template

For the rename template you have some variables at your disposal, here is an example with the regex from before in mind:

```text
{{$syncName}} - {{renumber $1 13}} {{$3}}.extension
```

If Sync name in your config is `Something Something test` and the file to match is `Test E1 [metadata].extension` you will get:

```text
Something Something test - 1 [metadata].extension
```

### $syncName

The Sync name field of your sync map entry, just a handy shortcut so you can re-use your rename template.

#### $1 $2 $3

To understand this lets look at this picture:

![alt text](regexexample.png)

This is the regex from the earlier example visualized. As you can see there are groups (Group 1, Group 2, Group 3).
These groups are made available through $1 $2 and $3 respectively, you create a new group each time you put something in paranthesis.

### renumber

A function to add or subtract from a number you captured in your regex group. The regex group capture must be a number only, no other characters!

## Plugins

Create a `plugins` folder in the same folder you are running the application or adjust WEEB_SYNC_PLUGIN_DIR to store them wherever you want.
Each folder in the `plugins` folder is one plugin. The name of that folder doesn't matter but a `index.js` file needs to exist inside the folder.
To see how to write plugins, take a look at `plugins/plexanisync/index.js`.

## Run as Docker container

### Production

Make sure all volume paths point to correct, absolute and existing paths on your filesystem.

```bash
# Using docker-compose (recommended)
docker compose up -d

# Or build and run manually with media volumes
docker build -t weebsync .
docker run -d --name weebsync -p 42380:42380 \
  -v ./server/config:/app/config \
  -v ./plugins:/app/plugins \
  -v /path/to/your/media:/media \
  -v /path/to/downloads:/downloads \
  weebsync
```

**Media Volume Configuration:**

You can mount any directories where you want WeebSync to sync your media files. Common examples:

```bash
# Mount specific media directories
-v /home/user/anime:/media/anime
-v /home/user/movies:/media/movies
-v /mnt/nas/downloads:/downloads

# Mount entire drives (Linux/macOS)
-v /mnt/media-drive:/media
-v /Volumes/ExternalDrive:/external

# Mount network shares
-v /mnt/smb-share:/network-media
```

Configure your sync destinations in the WeebSync UI to use paths like `/media/anime`, `/downloads`, etc.

## Development

### Development Environment

The development environment uses separate containers for client and server with hot-reload capabilities.

```bash
# Start development environment
docker compose -f docker-compose.dev.yml up

# Or run in background
docker compose -f docker-compose.dev.yml up -d

# View logs
docker logs weebsync-client-dev  # Vue/Vite frontend logs
docker logs weebsync-server-dev  # Node.js backend logs
```

**Access Points:**

- Client (Vue/Vite): <http://localhost:8080> (with hot-reload)
- Server API: <http://localhost:42380> (with hot-reload)

**Benefits:**

- Independent debugging for client and server
- Hot-reload for both frontend and backend
- Separate container logs for easier debugging
- Proper container networking and isolation
