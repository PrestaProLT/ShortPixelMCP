#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import * as https from "node:https";

// ── Config ──────────────────────────────────────────────────────────────────

const API_KEY = process.env.SHORTPIXEL_API_KEY ?? "";
const API_BASE = "https://api.shortpixel.com/v2";
const PLUGIN_VERSION = "MCP10";

// ── Helpers ─────────────────────────────────────────────────────────────────

function requireApiKey(): string {
  if (!API_KEY) {
    throw new Error(
      "SHORTPIXEL_API_KEY environment variable is not set. " +
        "Get your key at https://shortpixel.com/free-sign-up"
    );
  }
  return API_KEY;
}

async function postJson(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const url = `${API_BASE}/${endpoint}`;
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function uploadFile(
  filePath: string,
  body: Record<string, string | number>
): Promise<unknown> {
  const fileName = path.basename(filePath);
  const fileData = fs.readFileSync(filePath);
  const boundary = `----MCPBoundary${Date.now()}`;

  // The ShortPixel API requires file_paths to map a field name to the local path,
  // and the multipart file field must use the same field name as the key.
  const fileFieldName = "file1";

  // Override file_paths to use the correct field name
  body.file_paths = JSON.stringify({ [fileFieldName]: filePath });

  // Build multipart form data
  const parts: Buffer[] = [];

  // Add form fields
  for (const [key, value] of Object.entries(body)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
      )
    );
  }

  // Add file — field name must match the key in file_paths
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    )
  );
  parts.push(fileData);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const payload = Buffer.concat(parts);
  const url = `${API_BASE}/post-reducer.php`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": payload.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (targetUrl: string) => {
      const getter = targetUrl.startsWith("https://") ? https.get : http.get;
      getter(targetUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location);
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
        file.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatResult(item: Record<string, unknown>): string {
  const status = item.Status as Record<string, unknown> | undefined;
  const code = Number(status?.Code);

  if (code === 1) {
    return `⏳ Image queued for processing. Poll again shortly.\nOriginal: ${item.OriginalURL}`;
  }

  if (code !== 2) {
    return `Error (${code}): ${status?.Message ?? "Unknown error"}`;
  }

  const origSize = item.OriginalSize as number;
  const lossySize = item.LossySize as number;
  const losslessSize = (item.LoselessSize ?? item.LosslessSize) as number;
  const savings = origSize > 0 ? ((1 - lossySize / origSize) * 100).toFixed(1) : "0";

  const lines: string[] = [
    `Original: ${item.OriginalURL}`,
    `Original size: ${formatBytes(origSize)}`,
    "",
    `Lossy: ${formatBytes(lossySize)} (${savings}% saved) → ${item.LossyURL}`,
    `Lossless: ${formatBytes(losslessSize)} → ${item.LosslessURL}`,
  ];

  if (item.WebPLossyURL && item.WebPLossyURL !== "NA") {
    lines.push(`WebP Lossy: ${formatBytes(item.WebPLossySize as number)} → ${item.WebPLossyURL}`);
    lines.push(`WebP Lossless: ${formatBytes((item.WebPLoselessSize ?? item.WebPLosslessSize) as number)} → ${item.WebPLosslessURL}`);
  }
  if (item.AVIFLossyURL && item.AVIFLossyURL !== "NA") {
    lines.push(`AVIF Lossy: ${formatBytes(item.AVIFLossySize as number)} → ${item.AVIFLossyURL}`);
    lines.push(`AVIF Lossless: ${formatBytes((item.AVIFLoselessSize ?? item.AVIFLosslessSize) as number)} → ${item.AVIFLosslessURL}`);
  }

  return lines.join("\n");
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "shortpixel-mcp",
  version: "1.0.0",
});

// ── Tool: optimize ──────────────────────────────────────────────────────────

server.tool(
  "optimize",
  "Optimize one or more images by URL. Supports lossy/glossy/lossless compression, " +
    "WebP/AVIF conversion, resize, and background removal. Returns download URLs for optimized images.",
  {
    urls: z.array(z.string().url()).min(1).max(100).describe("Image URLs to optimize (max 100)"),
    compression: z
      .enum(["lossy", "glossy", "lossless"])
      .default("lossy")
      .describe("Compression mode: lossy (smallest), glossy (near-perfect), lossless (identical)"),
    convert_to: z
      .enum(["none", "webp", "avif", "webp+avif"])
      .default("none")
      .describe("Also generate converted formats alongside the original"),
    resize: z
      .enum(["none", "outer", "inner", "smart_crop"])
      .default("none")
      .describe("Resize mode"),
    resize_width: z.number().int().positive().optional().describe("Resize target width in pixels"),
    resize_height: z.number().int().positive().optional().describe("Resize target height in pixels"),
    keep_exif: z.boolean().default(false).describe("Preserve EXIF metadata"),
    wait: z
      .number()
      .int()
      .min(0)
      .max(30)
      .default(20)
      .describe("Seconds to wait for result (0 = async, 1-30 = wait)"),
  },
  async (args) => {
    const key = requireApiKey();

    const lossyMap = { lossy: 1, glossy: 2, lossless: 0 };
    const resizeMap = { none: 0, outer: 1, inner: 3, smart_crop: 4 };
    const convertMap: Record<string, string> = {
      none: "",
      webp: "+webp",
      avif: "+avif",
      "webp+avif": "+webp|+avif",
    };

    const body: Record<string, unknown> = {
      key,
      plugin_version: PLUGIN_VERSION,
      lossy: lossyMap[args.compression],
      resize: resizeMap[args.resize],
      wait: args.wait,
      cmyk2rgb: 1,
      keep_exif: args.keep_exif ? 1 : 0,
      urllist: args.urls,
    };

    if (convertMap[args.convert_to]) {
      body.convertto = convertMap[args.convert_to];
    }

    if (args.resize !== "none") {
      if (!args.resize_width || !args.resize_height) {
        return {
          content: [{ type: "text", text: "Error: resize_width and resize_height are required when resize is enabled." }],
          isError: true,
        };
      }
      body.resize_width = args.resize_width;
      body.resize_height = args.resize_height;
    }

    const result = await postJson("reducer.php", body);
    const items = Array.isArray(result) ? result : [result];
    const text = items.map((item) => formatResult(item as Record<string, unknown>)).join("\n\n---\n\n");

    return { content: [{ type: "text", text }] };
  }
);

// ── Tool: optimize-file ─────────────────────────────────────────────────────

server.tool(
  "optimize-file",
  "Upload and optimize a local image file. Use this when the image is not publicly accessible via URL.",
  {
    file_path: z.string().describe("Absolute path to the local image file"),
    compression: z
      .enum(["lossy", "glossy", "lossless"])
      .default("lossy")
      .describe("Compression mode"),
    convert_to: z
      .enum(["none", "webp", "avif", "webp+avif"])
      .default("none")
      .describe("Also generate converted formats"),
    keep_exif: z.boolean().default(false).describe("Preserve EXIF metadata"),
    wait: z
      .number()
      .int()
      .min(0)
      .max(30)
      .default(30)
      .describe("Seconds to wait for result"),
  },
  async (args) => {
    const key = requireApiKey();

    if (!fs.existsSync(args.file_path)) {
      return {
        content: [{ type: "text", text: `Error: File not found: ${args.file_path}` }],
        isError: true,
      };
    }

    const lossyMap = { lossy: 1, glossy: 2, lossless: 0 };
    const convertMap: Record<string, string> = {
      none: "",
      webp: "+webp",
      avif: "+avif",
      "webp+avif": "+webp|+avif",
    };

    const fileName = path.basename(args.file_path);
    const body: Record<string, string | number> = {
      key,
      plugin_version: PLUGIN_VERSION,
      lossy: lossyMap[args.compression],
      wait: args.wait,
      cmyk2rgb: 1,
      keep_exif: args.keep_exif ? 1 : 0,
      file_paths: JSON.stringify({ [fileName]: args.file_path }),
    };

    const convertTo = convertMap[args.convert_to];
    if (convertTo) {
      body.convertto = convertTo;
    }

    const result = await uploadFile(args.file_path, body);
    const items = Array.isArray(result) ? result : [result];
    const text = items.map((item) => formatResult(item as Record<string, unknown>)).join("\n\n---\n\n");

    return { content: [{ type: "text", text }] };
  }
);

// ── Tool: download ──────────────────────────────────────────────────────────

server.tool(
  "download",
  "Download an optimized image from a ShortPixel result URL to a local file path.",
  {
    url: z.string().url().describe("The optimized image URL from ShortPixel (LossyURL, WebPLossyURL, etc.)"),
    dest_path: z.string().describe("Absolute local path to save the downloaded file"),
  },
  async (args) => {
    const dir = path.dirname(args.dest_path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      await downloadFile(args.url, args.dest_path);
      const stat = fs.statSync(args.dest_path);
      return {
        content: [
          {
            type: "text",
            text: `Downloaded to ${args.dest_path} (${formatBytes(stat.size)})`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Download failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: check-quota ───────────────────────────────────────────────────────

server.tool(
  "check-quota",
  "Check your ShortPixel API quota — how many image optimization credits you have remaining.",
  {},
  async () => {
    const key = requireApiKey();

    // ShortPixel uses a special call to reducer with an empty urllist to get quota info
    const result = (await postJson("reducer.php", {
      key,
      plugin_version: PLUGIN_VERSION,
      lossy: 1,
      urllist: [],
    })) as Record<string, unknown>;

    const status = result.Status as Record<string, unknown> | undefined;

    // The API returns quota info in the error response when urllist is empty
    if (status) {
      return {
        content: [
          {
            type: "text",
            text: `API Status: ${status.Message}\nCode: ${status.Code}\n\nIf you need quota details, visit https://shortpixel.com/dashboard`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool: batch-optimize ────────────────────────────────────────────────────

server.tool(
  "batch-optimize",
  "Optimize all images in a local directory. Uploads each file and returns optimized URLs. " +
    "Supports filtering by extension.",
  {
    directory: z.string().describe("Absolute path to directory containing images"),
    extensions: z
      .array(z.string())
      .default(["jpg", "jpeg", "png", "gif", "bmp", "tiff", "webp"])
      .describe("File extensions to include"),
    compression: z
      .enum(["lossy", "glossy", "lossless"])
      .default("lossy")
      .describe("Compression mode"),
    convert_to: z
      .enum(["none", "webp", "avif", "webp+avif"])
      .default("none")
      .describe("Also generate converted formats"),
    download_result: z
      .boolean()
      .default(false)
      .describe("Download optimized files back, replacing originals"),
  },
  async (args) => {
    const key = requireApiKey();

    if (!fs.existsSync(args.directory)) {
      return {
        content: [{ type: "text", text: `Error: Directory not found: ${args.directory}` }],
        isError: true,
      };
    }

    const files = fs.readdirSync(args.directory).filter((f) => {
      const ext = path.extname(f).slice(1).toLowerCase();
      return args.extensions.includes(ext);
    });

    if (files.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No image files found in ${args.directory} matching extensions: ${args.extensions.join(", ")}`,
          },
        ],
      };
    }

    const lossyMap = { lossy: 1, glossy: 2, lossless: 0 };
    const convertMap: Record<string, string> = {
      none: "",
      webp: "+webp",
      avif: "+avif",
      "webp+avif": "+webp|+avif",
    };

    const results: string[] = [];

    for (const file of files) {
      const filePath = path.join(args.directory, file);
      const fileName = path.basename(filePath);

      const body: Record<string, string | number> = {
        key,
        plugin_version: PLUGIN_VERSION,
        lossy: lossyMap[args.compression],
        wait: 30,
        cmyk2rgb: 1,
        keep_exif: 0,
        file_paths: JSON.stringify({ [fileName]: filePath }),
      };

      const convertTo = convertMap[args.convert_to];
      if (convertTo) {
        body.convertto = convertTo;
      }

      try {
        const result = await uploadFile(filePath, body);
        const items = Array.isArray(result) ? result : [result];
        const item = items[0] as Record<string, unknown>;
        const text = formatResult(item);

        // Download back if requested
        if (args.download_result) {
          const status = item.Status as Record<string, unknown> | undefined;
          if (Number(status?.Code) === 2 && item.LossyURL) {
            await downloadFile(item.LossyURL as string, filePath);
            results.push(`${file}: optimized and replaced\n${text}`);
          } else {
            results.push(`${file}: ${text}`);
          }
        } else {
          results.push(`${file}:\n${text}`);
        }
      } catch (err) {
        results.push(`${file}: Error - ${(err as Error).message}`);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Processed ${files.length} files from ${args.directory}\n\n${results.join("\n\n---\n\n")}`,
        },
      ],
    };
  }
);

// ── Tool: resize ───────────────────────────────────────────────────────────

server.tool(
  "resize",
  "Resize or crop an image by URL or local file. Supports outer fit, inner fit, and AI smart crop. " +
    "Downloads the resized result to a local path.",
  {
    source: z.string().describe("Image URL or absolute local file path"),
    width: z.number().int().positive().describe("Target width in pixels"),
    height: z.number().int().positive().describe("Target height in pixels"),
    mode: z
      .enum(["outer", "inner", "smart_crop"])
      .default("inner")
      .describe("Resize mode: outer (cover, may crop), inner (contain, fits within), smart_crop (AI-powered crop)"),
    compression: z
      .enum(["lossy", "glossy", "lossless"])
      .default("lossless")
      .describe("Compression mode"),
    dest_path: z.string().describe("Absolute local path to save the resized image"),
  },
  async (args) => {
    const key = requireApiKey();
    const lossyMap = { lossy: 1, glossy: 2, lossless: 0 };
    const resizeMap = { outer: 1, inner: 3, smart_crop: 4 };

    const isUrl = args.source.startsWith("http://") || args.source.startsWith("https://");
    let result: unknown;

    if (isUrl) {
      result = await postJson("reducer.php", {
        key,
        plugin_version: PLUGIN_VERSION,
        lossy: lossyMap[args.compression],
        resize: resizeMap[args.mode],
        resize_width: args.width,
        resize_height: args.height,
        wait: 30,
        cmyk2rgb: 1,
        keep_exif: 0,
        urllist: [args.source],
      });
    } else {
      if (!fs.existsSync(args.source)) {
        return {
          content: [{ type: "text", text: `Error: File not found: ${args.source}` }],
          isError: true,
        };
      }
      const fileName = path.basename(args.source);
      result = await uploadFile(args.source, {
        key,
        plugin_version: PLUGIN_VERSION,
        lossy: lossyMap[args.compression],
        resize: resizeMap[args.mode],
        resize_width: args.width,
        resize_height: args.height,
        wait: 30,
        cmyk2rgb: 1,
        keep_exif: 0,
        file_paths: JSON.stringify({ [fileName]: args.source }),
      });
    }

    const items = Array.isArray(result) ? result : [result];
    const item = items[0] as Record<string, unknown>;
    const status = item.Status as Record<string, unknown> | undefined;

    if (Number(status?.Code) !== 2) {
      return {
        content: [{ type: "text", text: formatResult(item) }],
        isError: Number(status?.Code) !== 1,
      };
    }

    // Download the lossy result (which has the resize applied)
    const downloadUrl = (item.LossyURL ?? item.LosslessURL) as string;
    const dir = path.dirname(args.dest_path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await downloadFile(downloadUrl, args.dest_path);
    const stat = fs.statSync(args.dest_path);

    return {
      content: [
        {
          type: "text",
          text: `Resized (${args.mode}) to ${args.width}x${args.height} → ${args.dest_path} (${formatBytes(stat.size)})\n\n${formatResult(item)}`,
        },
      ],
    };
  }
);

// ── Tool: compare ──────────────────────────────────────────────────────────

server.tool(
  "compare",
  "Compare an image before and after optimization. Shows original vs optimized sizes, savings percentage, " +
    "and all available format variants. Works with URLs and local files.",
  {
    source: z.string().describe("Image URL or absolute local file path"),
    compression: z
      .enum(["lossy", "glossy", "lossless"])
      .default("lossy")
      .describe("Compression mode to compare against"),
    convert_to: z
      .enum(["none", "webp", "avif", "webp+avif"])
      .default("webp+avif")
      .describe("Also compare converted formats"),
  },
  async (args) => {
    const key = requireApiKey();
    const lossyMap = { lossy: 1, glossy: 2, lossless: 0 };
    const convertMap: Record<string, string> = {
      none: "",
      webp: "+webp",
      avif: "+avif",
      "webp+avif": "+webp|+avif",
    };

    const isUrl = args.source.startsWith("http://") || args.source.startsWith("https://");
    let result: unknown;

    if (isUrl) {
      const body: Record<string, unknown> = {
        key,
        plugin_version: PLUGIN_VERSION,
        lossy: lossyMap[args.compression],
        resize: 0,
        wait: 30,
        cmyk2rgb: 1,
        keep_exif: 0,
        urllist: [args.source],
      };
      if (convertMap[args.convert_to]) {
        body.convertto = convertMap[args.convert_to];
      }
      result = await postJson("reducer.php", body);
    } else {
      if (!fs.existsSync(args.source)) {
        return {
          content: [{ type: "text", text: `Error: File not found: ${args.source}` }],
          isError: true,
        };
      }
      const fileName = path.basename(args.source);
      const body: Record<string, string | number> = {
        key,
        plugin_version: PLUGIN_VERSION,
        lossy: lossyMap[args.compression],
        wait: 30,
        cmyk2rgb: 1,
        keep_exif: 0,
        file_paths: JSON.stringify({ [fileName]: args.source }),
      };
      const convertTo = convertMap[args.convert_to];
      if (convertTo) {
        body.convertto = convertTo;
      }
      result = await uploadFile(args.source, body);
    }

    const items = Array.isArray(result) ? result : [result];
    const item = items[0] as Record<string, unknown>;
    const status = item.Status as Record<string, unknown> | undefined;

    if (Number(status?.Code) !== 2) {
      return {
        content: [{ type: "text", text: formatResult(item) }],
        isError: Number(status?.Code) !== 1,
      };
    }

    const origSize = item.OriginalSize as number;
    const lossySize = item.LossySize as number;
    const losslessSize = (item.LoselessSize ?? item.LosslessSize) as number;

    const lines: string[] = [
      `## Image Comparison Report`,
      ``,
      `**Source:** ${args.source}`,
      `**Compression mode:** ${args.compression}`,
      ``,
      `### Size Comparison`,
      ``,
      `| Format | Size | Savings | URL |`,
      `|--------|------|---------|-----|`,
      `| Original | ${formatBytes(origSize)} | — | ${item.OriginalURL} |`,
      `| ${args.compression} | ${formatBytes(lossySize)} | ${((1 - lossySize / origSize) * 100).toFixed(1)}% | ${item.LossyURL} |`,
      `| Lossless | ${formatBytes(losslessSize)} | ${((1 - losslessSize / origSize) * 100).toFixed(1)}% | ${item.LosslessURL} |`,
    ];

    if (item.WebPLossyURL && item.WebPLossyURL !== "NA") {
      const webpLossySize = item.WebPLossySize as number;
      const webpLosslessSize = (item.WebPLoselessSize ?? item.WebPLosslessSize) as number;
      lines.push(
        `| WebP Lossy | ${formatBytes(webpLossySize)} | ${((1 - webpLossySize / origSize) * 100).toFixed(1)}% | ${item.WebPLossyURL} |`
      );
      lines.push(
        `| WebP Lossless | ${formatBytes(webpLosslessSize)} | ${((1 - webpLosslessSize / origSize) * 100).toFixed(1)}% | ${item.WebPLosslessURL} |`
      );
    }

    if (item.AVIFLossyURL && item.AVIFLossyURL !== "NA") {
      const avifLossySize = item.AVIFLossySize as number;
      const avifLosslessSize = (item.AVIFLoselessSize ?? item.AVIFLosslessSize) as number;
      lines.push(
        `| AVIF Lossy | ${formatBytes(avifLossySize)} | ${((1 - avifLossySize / origSize) * 100).toFixed(1)}% | ${item.AVIFLossyURL} |`
      );
      lines.push(
        `| AVIF Lossless | ${formatBytes(avifLosslessSize)} | ${((1 - avifLosslessSize / origSize) * 100).toFixed(1)}% | ${item.AVIFLosslessURL} |`
      );
    }

    // Find the best option
    const candidates: { name: string; size: number }[] = [
      { name: `${args.compression}`, size: lossySize },
      { name: "Lossless", size: losslessSize },
    ];
    if (item.WebPLossySize && item.WebPLossySize !== "NA") candidates.push({ name: "WebP Lossy", size: item.WebPLossySize as number });
    if (item.AVIFLossySize && item.AVIFLossySize !== "NA") candidates.push({ name: "AVIF Lossy", size: item.AVIFLossySize as number });

    const best = candidates.reduce((a, b) => (a.size < b.size ? a : b));
    lines.push(``);
    lines.push(`### Recommendation`);
    lines.push(``);
    lines.push(`**Best option: ${best.name}** — ${formatBytes(best.size)} (${((1 - best.size / origSize) * 100).toFixed(1)}% smaller than original)`);

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ── Tool: optimize-and-save ─────────────────────────────────────────────────

server.tool(
  "optimize-and-save",
  "Optimize a single image (URL or local file) and save the optimized result to a local path. " +
    "Combines optimize + download in one step. If no dest_path is given, replaces the original file (local only).",
  {
    source: z.string().describe("Image URL or absolute local file path"),
    dest_path: z.string().optional().describe("Absolute local path to save the optimized image. If omitted and source is a local file, replaces the original."),
    compression: z
      .enum(["lossy", "glossy", "lossless"])
      .default("lossy")
      .describe("Compression mode"),
    convert_to: z
      .enum(["none", "webp", "avif"])
      .default("none")
      .describe("Convert to a different format (downloaded file will be in this format)"),
    keep_exif: z.boolean().default(false).describe("Preserve EXIF metadata"),
  },
  async (args) => {
    const key = requireApiKey();
    const lossyMap = { lossy: 1, glossy: 2, lossless: 0 };
    const convertMap: Record<string, string> = {
      none: "",
      webp: "+webp",
      avif: "+avif",
    };

    const isUrl = args.source.startsWith("http://") || args.source.startsWith("https://");

    if (!isUrl && !fs.existsSync(args.source)) {
      return {
        content: [{ type: "text", text: `Error: File not found: ${args.source}` }],
        isError: true,
      };
    }

    // Determine destination path
    const destPath = args.dest_path ?? (isUrl ? undefined : args.source);
    if (!destPath) {
      return {
        content: [{ type: "text", text: "Error: dest_path is required when source is a URL." }],
        isError: true,
      };
    }

    let result: unknown;

    if (isUrl) {
      const body: Record<string, unknown> = {
        key,
        plugin_version: PLUGIN_VERSION,
        lossy: lossyMap[args.compression],
        resize: 0,
        wait: 30,
        cmyk2rgb: 1,
        keep_exif: args.keep_exif ? 1 : 0,
        urllist: [args.source],
      };
      if (convertMap[args.convert_to]) {
        body.convertto = convertMap[args.convert_to];
      }
      result = await postJson("reducer.php", body);
    } else {
      const fileName = path.basename(args.source);
      const body: Record<string, string | number> = {
        key,
        plugin_version: PLUGIN_VERSION,
        lossy: lossyMap[args.compression],
        wait: 30,
        cmyk2rgb: 1,
        keep_exif: args.keep_exif ? 1 : 0,
        file_paths: JSON.stringify({ file1: args.source }),
      };
      const convertTo = convertMap[args.convert_to];
      if (convertTo) {
        body.convertto = convertTo;
      }
      result = await uploadFile(args.source, body);
    }

    const items = Array.isArray(result) ? result : [result];
    const item = items[0] as Record<string, unknown>;
    const status = item.Status as Record<string, unknown> | undefined;

    if (Number(status?.Code) !== 2) {
      return {
        content: [{ type: "text", text: formatResult(item) }],
        isError: Number(status?.Code) !== 1,
      };
    }

    // Pick the right URL based on convert_to
    let downloadUrl: string;
    let formatLabel: string;
    if (args.convert_to === "webp" && item.WebPLossyURL && item.WebPLossyURL !== "NA") {
      downloadUrl = (args.compression === "lossless" ? item.WebPLosslessURL : item.WebPLossyURL) as string;
      formatLabel = `WebP (${args.compression})`;
    } else if (args.convert_to === "avif" && item.AVIFLossyURL && item.AVIFLossyURL !== "NA") {
      downloadUrl = (args.compression === "lossless" ? item.AVIFLosslessURL : item.AVIFLossyURL) as string;
      formatLabel = `AVIF (${args.compression})`;
    } else {
      downloadUrl = (args.compression === "lossless" ? item.LosslessURL : item.LossyURL) as string;
      formatLabel = args.compression;
    }

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await downloadFile(downloadUrl, destPath);
    const stat = fs.statSync(destPath);
    const origSize = item.OriginalSize as number;
    const savings = origSize > 0 ? ((1 - stat.size / origSize) * 100).toFixed(1) : "0";

    return {
      content: [
        {
          type: "text",
          text: `Optimized and saved to ${destPath}\n\nFormat: ${formatLabel}\nOriginal: ${formatBytes(origSize)}\nOptimized: ${formatBytes(stat.size)} (${savings}% saved)`,
        },
      ],
    };
  }
);

// ── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
