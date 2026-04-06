# ShortPixel MCP Server

MCP server for optimizing images via the [ShortPixel API](https://shortpixel.com/api-docs). Works with Claude Code, Cursor, and any MCP-compatible client.

## Features

- **optimize** — Optimize images by URL (up to 100 at once) with lossy/glossy/lossless compression
- **optimize-file** — Upload and optimize local image files
- **optimize-and-save** — Optimize a single image (URL or local file) and save the result in one step
- **batch-optimize** — Optimize all images in a directory
- **resize** — Resize/crop images with outer fit, inner fit, or AI smart crop
- **compare** — Compare before/after optimization with a detailed report of all format variants
- **download** — Download optimized results to local filesystem
- **check-quota** — Check your remaining API credits
- WebP and AVIF conversion
- EXIF metadata preservation

## Setup

### 1. Get an API Key

Sign up at [shortpixel.com](https://shortpixel.com/free-sign-up-referrer/referrer/748277) — you get 100 free credits/month.

### 2. Clone & Build

```bash
git clone https://github.com/PrestaProLT/ShortPixelMCP.git
cd ShortPixelMCP
npm install
npm run build
```

### 3. Register in Claude Code (Recommended)

Use the CLI to register the server globally:

```bash
claude mcp add -s user \
  -e "SHORTPIXEL_API_KEY=your_api_key_here" \
  -- shortpixel node /absolute/path/to/ShortPixelMCP/build/index.js
```

Then restart Claude Code. Verify with:

```bash
claude mcp list
```

You should see `shortpixel: ✓ Connected`.

### Alternative: Manual Configuration

<details>
<summary>Claude Code — manual settings.json</summary>

Add to `~/.claude.json`:

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
</details>

<details>
<summary>Cursor</summary>

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
</details>

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

### resize

Resize or crop an image by URL or local file. Downloads the resized result directly.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| source | string | required | Image URL or absolute local file path |
| width | number | required | Target width in pixels |
| height | number | required | Target height in pixels |
| mode | outer/inner/smart_crop | inner | Resize mode |
| compression | lossy/glossy/lossless | lossless | Compression mode |
| dest_path | string | required | Absolute local path to save result |

### compare

Compare an image before and after optimization. Shows a table of all format variants with sizes and savings.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| source | string | required | Image URL or absolute local file path |
| compression | lossy/glossy/lossless | lossy | Compression mode to compare |
| convert_to | none/webp/avif/webp+avif | webp+avif | Also compare converted formats |

### optimize-and-save

Optimize a single image (URL or local file) and save the optimized result locally. If no `dest_path` is given and the source is a local file, replaces the original.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| source | string | required | Image URL or absolute local file path |
| dest_path | string | optional | Local path to save result (defaults to replacing original for local files) |
| compression | lossy/glossy/lossless | lossy | Compression mode |
| convert_to | none/webp/avif | none | Convert to a different format |
| keep_exif | boolean | false | Preserve EXIF metadata |

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
