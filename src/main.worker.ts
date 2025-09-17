// deno-lint-ignore-file no-import-prefix
import { serveDir, serveFile } from "jsr:@std/http@1.0.16/file-server";
import { qrPng } from "jsr:@sigmasd/qrpng@0.1.3";
import { basename } from "jsr:@std/path@1/basename";
import { join } from "jsr:@std/path@1/join";
import { ensureDir } from "jsr:@std/fs@1.0.12/ensure-dir";

import emptyPage from "./ui/empty.html" with { type: "text" };
import errorPage from "./ui/error.html" with { type: "text" };
import uploadPage from "./ui/upload.html" with { type: "text" };
import stopPage from "./ui/stop.html" with { type: "text" };

function getLocalAddr() {
  return Deno.networkInterfaces().filter((int) =>
    int.name !== "lo" && int.family === "IPv4"
  ).at(0)?.address || "localhost";
}

if (import.meta.main) {
  let filePath: string | null = null;
  let textContent: string | null = null;
  let qrPath: string;
  let isSharing: boolean = true;
  let isReceiveMode: boolean = false;
  let downloadDir: string = join(Deno.env.get("HOME") || "/tmp", "Downloads");

  const startServer = () => {
    Deno.serve({
      port: 0,
      onListen: async (addr) => {
        const serverAddr = `http://${getLocalAddr()}:${addr.port}`;
        console.log("[worker] HTTP server running. Access it at:", serverAddr);
        await Deno.writeFile(
          qrPath,
          qrPng(new TextEncoder().encode(serverAddr)),
        );
        //@ts-ignore worker
        self.postMessage({ type: "start", url: serverAddr });
      },
    }, async (req): Promise<Response> => {
      // Disable caching
      const headers = new Headers({
        "Cache-Control":
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      });

      // If sharing is disabled, return a message
      if (!isSharing) {
        headers.set("Content-Type", "text/html");

        return new Response(stopPage, {
          status: 503,
          headers: headers,
        });
      }

      // Handle file upload in receive mode
      if (
        isReceiveMode && req.method === "POST" &&
        new URL(req.url).pathname === "/upload"
      ) {
        try {
          const formData = await req.formData();
          const files = formData.getAll("files") as File[];

          // Ensure download directory exists
          await ensureDir(downloadDir);

          for (const file of files) {
            if (file && file.size > 0) {
              // Use webkitRelativePath if available (for directory uploads)
              const fileName = file.name.includes("/")
                ? file.name
                : (file.webkitRelativePath || file.name);
              const filePath = join(downloadDir, fileName);

              // Ensure subdirectories exist for directory uploads
              const fileDir = filePath.substring(0, filePath.lastIndexOf("/"));
              if (fileDir !== downloadDir) {
                await ensureDir(fileDir);
              }

              const arrayBuffer = await file.arrayBuffer();
              await Deno.writeFile(filePath, new Uint8Array(arrayBuffer));
              console.log(`[worker] File saved: ${filePath}`);
            }
          }

          return new Response("Upload successful", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        } catch (error) {
          console.error("[worker] Upload error:", error);
          return new Response("Upload failed", {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          });
        }
      }

      // In receive mode, serve the upload page
      if (isReceiveMode) {
        headers.set("Content-Type", "text/html");
        return new Response(uploadPage, { headers });
      }

      if (!filePath && !textContent) {
        headers.set("Content-Type", "text/html");
        return new Response(emptyPage, {
          status: 404,
          headers: headers,
        });
      }

      if (textContent) {
        console.log("[worker] serving text content");
        return new Response(textContent, { headers });
      }

      if (filePath) {
        console.log("[worker] serving path:", filePath);
        try {
          const meta = await Deno.stat(filePath);
          let response: Response;
          let responseHeaders: Headers;
          if (meta.isFile) {
            response = await serveFile(req, filePath);
            // Clone headers from the original response
            responseHeaders = new Headers(response.headers);

            // Suggest original filename for downloads
            const filename = basename(filePath);
            const encodedFilename = encodeURIComponent(filename);
            headers.set(
              "content-disposition",
              `attachment; filename*=UTF-8''${encodedFilename}`,
            );
          } else {
            response = await serveDir(req, {
              fsRoot: filePath,
              showDirListing: true,
              showIndex: false,
            });
            // Clone headers from the original response
            responseHeaders = new Headers(response.headers);
          }

          // Update headers with the custom headers
          headers.forEach((value, key) => {
            responseHeaders.set(key, value);
          });

          // Return the new response with the updated headers
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          });
        } catch (error) {
          console.error("[worker] Error accessing file:", error);
          headers.set("Content-Type", "text/html");
          return new Response(
            errorPage.replace(
              "{{ERROR_MESSAGE}}",
              error instanceof Error ? error.message : String(error),
            ),
            { status: 404, headers },
          );
        }
      }

      // This should never happen, but just in case
      return new Response("Internal Server Error", { status: 500, headers });
    });
  };

  //@ts-ignore worker
  self.onmessage = (event) => {
    console.log("[worker] received msg:", event.data);
    switch (event.data.type) {
      case "file":
        filePath = event.data.path;
        textContent = null; // Reset text content when a file is shared
        isReceiveMode = false; // Switch to share mode when sharing a file
        break;
      case "text":
        textContent = event.data.content;
        filePath = null; // Reset file path when text is shared
        isReceiveMode = false; // Switch to share mode when sharing text
        break;
      case "qrPath":
        qrPath = event.data.path;
        startServer();
        break;
      case "start-sharing":
        console.log("[worker] Starting sharing");
        isSharing = true;
        break;
      case "stop-sharing":
        console.log("[worker] Stopping sharing");
        isSharing = false;
        break;
      case "set-receive-mode":
        console.log("[worker] Setting receive mode:", event.data.enabled);
        isReceiveMode = event.data.enabled;
        if (isReceiveMode) {
          filePath = null;
          textContent = null;
        }
        break;
      case "set-download-dir":
        console.log("[worker] Setting download directory:", event.data.path);
        downloadDir = event.data.path;
        break;
    }
  };
}
