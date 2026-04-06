#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
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

  // Add file
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileName}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
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
      https.get(targetUrl, (res) => {
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
  const code = status?.Code as number | undefined;

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

  if (item.WebPLossyURL) {
    lines.push(`WebP Lossy: ${formatBytes(item.WebPLossySize as number)} → ${item.WebPLossyURL}`);
    lines.push(`WebP Lossless: ${formatBytes((item.WebPLoselessSize ?? item.WebPLosslessSize) as number)} → ${item.WebPLosslessURL}`);
  }
  if (item.AVIFLossyURL) {
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
          if (status?.Code === 2 && item.LossyURL) {
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

// ── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
