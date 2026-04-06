# ShortPixel MCP Server

MCP server for optimizing images via the [ShortPixel API](https://shortpixel.com/api-docs). Works with Claude Code, Cursor, and any MCP-compatible client.

## Features

- **optimize** — Optimize images by URL (up to 100 at once) with lossy/glossy/lossless compression
- **optimize-file** — Upload and optimize local image files
- **batch-optimize** — Optimize all images in a directory
- **download** — Download optimized results to local filesystem
- **check-quota** — Check your remaining API credits
- WebP and AVIF conversion
- Resize and smart AI crop
- EXIF metadata preservation

## Setup

### 1. Get an API Key

Sign up at [shortpixel.com](https://shortpixel.com/free-sign-up-referrer/referrer/748277) — you get 100 free credits/month.

### 2. Install

```bash
cd ShortPixelMCP
npm install
npm run build
```

### 3. Configure in Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "shortpixel": {
      "command": "node",
      "args": ["/absolute/path/to/ShortPixelMCP/build/index.js"],
      "env": {
        "SHORTPIXEL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### 4. Configure in Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "shortpixel": {
      "command": "node",
      "args": ["/absolute/path/to/ShortPixelMCP/build/index.js"],
      "env": {
        "SHORTPIXEL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Tools

### optimize

Optimize one or more images by URL.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| urls | string[] | required | Image URLs (max 100) |
| compression | lossy/glossy/lossless | lossy | Compression mode |
| convert_to | none/webp/avif/webp+avif | none | Generate additional formats |
| resize | none/outer/inner/smart_crop | none | Resize mode |
| resize_width | number | — | Target width (required if resize set) |
| resize_height | number | — | Target height (required if resize set) |
| keep_exif | boolean | false | Preserve EXIF metadata |
| wait | number | 20 | Seconds to wait (0-30) |

### optimize-file

Upload and optimize a local image file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| file_path | string | required | Absolute path to image |
| compression | lossy/glossy/lossless | lossy | Compression mode |
| convert_to | none/webp/avif/webp+avif | none | Generate additional formats |
| keep_exif | boolean | false | Preserve EXIF metadata |
| wait | number | 30 | Seconds to wait (0-30) |

### batch-optimize

Optimize all images in a directory.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| directory | string | required | Absolute path to directory |
| extensions | string[] | jpg,jpeg,png,gif,bmp,tiff,webp | File extensions to include |
| compression | lossy/glossy/lossless | lossy | Compression mode |
| convert_to | none/webp/avif/webp+avif | none | Generate additional formats |
| download_result | boolean | false | Replace originals with optimized versions |

### download

Download an optimized image to local filesystem.

| Parameter | Type | Description |
|-----------|------|-------------|
| url | string | ShortPixel result URL |
| dest_path | string | Absolute local destination path |

### check-quota

Check remaining API credits. No parameters required.

## Compression Modes

- **lossy** — Best compression ratio, minor quality loss. Recommended for web.
- **glossy** — Near pixel-perfect, good compression. Best balance of quality and size.
- **lossless** — Identical to original, smaller file size. For when quality is critical.

## Support This Project

If you don't have a ShortPixel account yet, I'd appreciate it if you sign up through my referral link:

**[Sign up for ShortPixel (referral)](https://shortpixel.com/free-sign-up-referrer/referrer/748277)**

You get 100 free image credits per month, and it helps support the development of this MCP server. Thank you!

## License

MIT
